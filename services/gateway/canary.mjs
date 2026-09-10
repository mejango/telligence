/**
 * Explicit, one-shot funded activation proof. Never run from gateway startup or a worker loop.
 *
 * CLI: node gateway/canary.mjs --execute-canary --project <uuid> --model <reviewed-model>
 * Required environment: DATABASE_URL, API_KEY_PEPPER, AUTH_SIGNER_URL,
 * AUTH_SIGNER_SERVICE_SECRET, BASE_RPC_URL, TELLIGENCE_MANIFEST_PATH,
 * MODEL_POLICY_JSON (or MODEL_PRICES_JSON), and TELLIGENCE_CANARY_API_KEY (a project-bound Telligence key).
 * The hard reservation ceiling is $0.01; it cannot be raised with an argument.
 * A prepared/submitted/uncertain durable run is never automatically retried.
 */
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { BaseChain } from "../control-worker/chain.mjs";
import { readProviderCapacity } from "../control-worker/capacity.mjs";
import { PostgresWorkerStore } from "../control-worker/postgres.mjs";
import { createSignerClient } from "../auth-signer/client.mjs";
import { GatewayStore, transaction } from "./store.mjs";
import { forwardInference } from "./inference.mjs";
import {
  validateInference,
  validatePrices,
  quoteReservation,
} from "./policy.mjs";
import { ModelCatalog } from "./catalog.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAP = 10_000n;
const error = (code) => Object.assign(new Error(code), { code });

export function parseCanaryArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 5 ||
    args[0] !== "--execute-canary" ||
    args[1] !== "--project" ||
    !UUID.test(args[2]) ||
    args[3] !== "--model" ||
    !/^[A-Za-z0-9][A-Za-z0-9/_.:-]{0,127}$/.test(args[4])
  )
    throw error("CANARY_EXPLICIT_ARGUMENTS_REQUIRED");
  return { projectId: args[2], model: args[4] };
}

// An in-process HTTP response adapter discards inference text while preserving the real
// transport's backpressure, disconnect and settlement behavior. No response text is logged.
class CanaryResponse extends Writable {
  constructor() {
    super();
    this.reservationId = null;
    this.headersSent = false;
  }
  setHeader(name, value) {
    if (name.toLowerCase() === "x-request-id") this.reservationId = value;
  }
  _write(_chunk, _encoding, done) {
    this.headersSent = true;
    done();
  }
}

function checkedSnapshot(
  snapshot,
  { project, provider, now = Date.now(), maxAgeMs },
) {
  const observed = Date.parse(snapshot?.observedAt);
  if (
    !snapshot ||
    snapshot.status !== "ready" ||
    !Number.isFinite(observed) ||
    observed > now ||
    now - observed > maxAgeMs ||
    snapshot.providerEpoch !== new Date(now).toISOString().slice(0, 10) ||
    snapshot.authenticationEnabled !== true ||
    snapshot.signerGeneration !== provider.signer_generation ||
    typeof snapshot.signerAddress !== "string" ||
    snapshot.signerAddress.toLowerCase() !==
      provider.signer_address.toLowerCase() ||
    !/^0x[0-9a-fA-F]{64}$/.test(snapshot.chainBlockHash) ||
    !/^[0-9]+$/.test(String(snapshot.chainBlock)) ||
    !/^[0-9]+$/.test(String(snapshot.dailyLimitMicrousd)) ||
    !/^[0-9]+$/.test(String(snapshot.remainingMicrousd)) ||
    project.chain_id !== 8453
  )
    throw error("CANARY_INVALID_CAPACITY");
  if (
    BigInt(snapshot.dailyLimitMicrousd) <= 0n ||
    BigInt(snapshot.remainingMicrousd) > BigInt(snapshot.dailyLimitMicrousd)
  )
    throw error("CANARY_INVALID_CAPACITY");
  return snapshot;
}

function evidenceSnapshot(snapshot) {
  return {
    providerEpoch: snapshot.providerEpoch,
    dailyLimitMicrousd: String(snapshot.dailyLimitMicrousd),
    remainingMicrousd: String(snapshot.remainingMicrousd),
    observedAt: snapshot.observedAt,
    chainBlock: String(snapshot.chainBlock),
    chainHash: snapshot.chainBlockHash,
  };
}

/**
 * Uses the production PostgreSQL ledger and exact production forwarding function.
 * Dependency injection is confined to external IO so tests can use a local provider.
 * readCapacity MUST combine BaseChain.readDiemEvidence with readProviderCapacity;
 * saveCapacity MUST preserve the worker's disabled/quarantine and freshness guards.
 */
export async function runCanary({
  pool,
  storeOptions,
  projectId,
  model,
  secret,
  prices,
  signerClient,
  readCapacity,
  saveCapacity,
  fetchImpl = fetch,
}) {
  if (
    !UUID.test(projectId) ||
    typeof readCapacity !== "function" ||
    typeof saveCapacity !== "function"
  )
    throw error("CANARY_INVALID_CONFIGURATION");
  validatePrices(prices);
  const body = {
    model,
    messages: [{ role: "user", content: "Reply with OK" }],
    max_completion_tokens: 16,
    stream: false,
  };
  const payload = validateInference(body, prices.models);
  const quote = quoteReservation(payload, prices.models[model]);
  if (quote.maximumMicroUsd > CAP) throw error("CANARY_CAP_EXCEEDED");
  const ordinaryStore = new GatewayStore(pool, storeOptions);
  const key = await ordinaryStore.authenticate(secret);
  if (key.project_id !== projectId) throw error("CANARY_PROJECT_KEY_MISMATCH");
  const setup = await transaction(pool, async (client) => {
    const {
      rows: [project],
    } = await client.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [
      projectId,
    ]);
    const {
      rows: [provider],
    } = await client.query(
      "SELECT * FROM provider_bindings WHERE project_id=$1 FOR UPDATE",
      [projectId],
    );
    if (
      !project ||
      !provider ||
      !["accumulating", "active"].includes(project.status) ||
      provider.status === "disabled"
    )
      throw error("CANARY_PROJECT_UNAVAILABLE");
    const {
      rows: [existing],
    } = await client.query(
      "SELECT * FROM canary_runs WHERE project_id=$1 AND signer_generation=$2",
      [projectId, provider.signer_generation],
    );
    if (existing) {
      if (existing.state === "completed" && existing.evidence)
        return { completed: existing.evidence };
      throw error("CANARY_INCOMPLETE");
    }
    const id = randomUUID();
    await client.query(
      "INSERT INTO canary_runs(id,project_id,signer_generation,state) VALUES($1,$2,$3,'prepared')",
      [id, projectId, provider.signer_generation],
    );
    return { id, project, provider };
  });
  if (setup.completed) return setup.completed;

  const { id: runId, project, provider } = setup;
  const maxAgeMs = storeOptions.capacityMaxAgeMs ?? 30000;
  let phase = "capacity_before";
  try {
    const before = checkedSnapshot(await readCapacity(project), {
      project,
      provider,
      maxAgeMs,
    });
    if (BigInt(before.remainingMicrousd) < quote.maximumMicroUsd)
      throw error("CANARY_INVALID_CAPACITY");
    if (!(await saveCapacity(projectId, before)))
      throw error("CANARY_CAPACITY_REJECTED");
    const store = new GatewayStore(pool, {
      ...storeOptions,
      canaryRunId: runId,
    });
    const request = Readable.from([]);
    request.headers = {
      authorization: `Bearer ${secret}`,
      "idempotency-key": `canary:${runId}`,
    };
    const response = new CanaryResponse();
    phase = "inference";
    await forwardInference({
      request,
      response,
      body,
      store,
      prices,
      fetchImpl,
      authHeader: async (id, reservationId) =>
        (await signerClient.getHeader(id, 0, reservationId)).headerValue,
      requestTimeoutMs: 30000,
      maxResponseBytes: 65536,
    });
    const {
      rows: [reservation],
    } = await pool.query(
      "SELECT * FROM usage_reservations WHERE id=$1 AND project_id=$2",
      [response.reservationId, projectId],
    );
    if (
      !reservation ||
      reservation.state !== "settled" ||
      BigInt(reservation.charged_microusd) <= 0n ||
      BigInt(reservation.charged_microusd) > CAP
    )
      throw error("CANARY_UNCONFIRMED_USAGE");
    phase = "capacity_after";
    const after = checkedSnapshot(await readCapacity(project), {
      project,
      provider,
      maxAgeMs,
    });
    const charged = BigInt(reservation.charged_microusd);
    const measuredDebit =
      BigInt(before.remainingMicrousd) - BigInt(after.remainingMicrousd);
    if (
      before.providerEpoch !== after.providerEpoch ||
      before.dailyLimitMicrousd !== after.dailyLimitMicrousd ||
      Date.parse(after.observedAt) < reservation.settled_at.getTime() ||
      measuredDebit < charged
    )
      throw error("CANARY_UNCONFIRMED_DIEM_DEBIT");
    if (!(await saveCapacity(projectId, after)))
      throw error("CANARY_CAPACITY_REJECTED");
    const evidence = {
      runId,
      projectId,
      usageReservationId: reservation.id,
      signerGeneration: provider.signer_generation,
      chargedMicrousd: charged.toString(),
      maximumMicrousd: quote.maximumMicroUsd.toString(),
      measuredDiemDebitMicrousd: measuredDebit.toString(),
      before: evidenceSnapshot(before),
      after: evidenceSnapshot(after),
      chainHash: after.chainBlockHash,
    };
    phase = "activation";
    await transaction(pool, async (client) => {
      const {
        rows: [currentProject],
      } = await client.query(
        "SELECT status FROM projects WHERE id=$1 FOR UPDATE",
        [projectId],
      );
      const {
        rows: [current],
      } = await client.query(
        "SELECT * FROM provider_bindings WHERE project_id=$1 FOR UPDATE",
        [projectId],
      );
      const {
        rows: [run],
      } = await client.query(
        "SELECT * FROM canary_runs WHERE id=$1 FOR UPDATE",
        [runId],
      );
      if (
        !["accumulating", "active"].includes(currentProject?.status) ||
        current?.status !== "ready" ||
        current.signer_generation !== provider.signer_generation ||
        current.signer_address !== provider.signer_address ||
        run?.state !== "submitted" ||
        run.reservation_id !== reservation.id ||
        current.provider_epoch !== after.providerEpoch
      )
        throw error("CANARY_BINDING_CHANGED");
      await client.query(
        "UPDATE provider_bindings SET canary_verified_at=clock_timestamp() WHERE project_id=$1",
        [projectId],
      );
      await client.query(
        "UPDATE projects SET status='active' WHERE id=$1 AND status='accumulating'",
        [projectId],
      );
      await client.query(
        "UPDATE canary_runs SET state='completed',completed_at=clock_timestamp(),evidence=$2 WHERE id=$1",
        [runId, evidence],
      );
    });
    return evidence;
  } catch (failure) {
    // Even preflight failures remain durable: a later invocation cannot assume a
    // prior process died before submission and accidentally issue a second call.
    const safeCodes = new Set([
      "CANARY_INVALID_CAPACITY",
      "CANARY_CAPACITY_REJECTED",
      "CANARY_UNCONFIRMED_USAGE",
      "CANARY_UNCONFIRMED_DIEM_DEBIT",
      "CANARY_BINDING_CHANGED",
    ]);
    const evidence = {
      phase,
      failureCode: safeCodes.has(failure?.code)
        ? failure.code
        : "CANARY_UNCONFIRMED",
      signerGeneration: provider.signer_generation,
    };
    await pool
      .query(
        "UPDATE canary_runs SET state='uncertain',evidence=$2 WHERE id=$1 AND state IN ('prepared','submitted')",
        [runId, evidence],
      )
      .catch(() => {});
    throw error("CANARY_UNCERTAIN");
  }
}

export async function loadCanaryPrices(env, { fetchImpl = fetch } = {}) {
  if (Boolean(env.MODEL_POLICY_JSON) === Boolean(env.MODEL_PRICES_JSON))
    throw error("CANARY_INVALID_PRICING_CONFIGURATION");
  if (env.MODEL_POLICY_JSON) {
    const catalog = new ModelCatalog({
      policy: JSON.parse(env.MODEL_POLICY_JSON),
      fetchImpl,
    });
    await catalog.refresh();
    const prices = catalog.current();
    if (!prices) throw error("CANARY_PRICING_UNAVAILABLE");
    return prices;
  }
  return validatePrices(JSON.parse(env.MODEL_PRICES_JSON));
}

async function main(args, env) {
  const { projectId, model } = parseCanaryArgs(args);
  for (const name of [
    "DATABASE_URL",
    "API_KEY_PEPPER",
    "AUTH_SIGNER_URL",
    "AUTH_SIGNER_SERVICE_SECRET",
    "BASE_RPC_URL",
    "TELLIGENCE_MANIFEST_PATH",
    "TELLIGENCE_CANARY_API_KEY",
  ])
    if (!env[name]) throw error("CANARY_MISSING_CONFIGURATION");
  if (Buffer.byteLength(env.API_KEY_PEPPER) < 32)
    throw error("CANARY_INVALID_CONFIGURATION");
  const prices = await loadCanaryPrices(env);
  const manifest = JSON.parse(
    await readFile(env.TELLIGENCE_MANIFEST_PATH, "utf8"),
  );
  const chain = new BaseChain({ manifest, rpcUrl: env.BASE_RPC_URL });
  const signerClient = createSignerClient({
    url: env.AUTH_SIGNER_URL,
    secret: env.AUTH_SIGNER_SERVICE_SECRET,
  });
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  try {
    const worker = new PostgresWorkerStore(pool);
    const evidence = await runCanary({
      pool,
      projectId,
      model,
      secret: env.TELLIGENCE_CANARY_API_KEY,
      storeOptions: {
        keyPepper: env.API_KEY_PEPPER,
        capacityMaxAgeMs: 30000,
        safetyMarginMicroUsd: 1000n,
      },
      prices,
      signerClient,
      readCapacity: async (project) => {
        const diem = await chain.readDiemEvidence(project);
        const snapshot = await readProviderCapacity({
          project,
          diem,
          getAuthHeader: async (p) =>
            (await signerClient.getHeader(p, 3)).headerValue,
        });
        return {
          ...snapshot,
          signerAddress: diem.signerAddress,
          signerGeneration: diem.signerGeneration,
          authenticationEnabled: diem.authenticationEnabled,
        };
      },
      saveCapacity: (id, snapshot) =>
        worker.updateProviderCapacity(id, snapshot),
    });
    process.stdout.write(
      `${JSON.stringify({ event: "canary.completed", evidence })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2), process.env).catch((failure) => {
    const code =
      typeof failure.code === "string" && /^CANARY_[A-Z_]+$/.test(failure.code)
        ? failure.code
        : "CANARY_FAILED";
    process.stderr.write(
      `${JSON.stringify({ event: "canary.incomplete", code, message: "No inference retry was attempted. Inspect the durable canary record before further action." })}\n`,
    );
    process.exitCode = 1;
  });
}
