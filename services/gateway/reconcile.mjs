/**
 * Operator-only reconciliation. This command never refunds a reservation or retries inference.
 *
 * node gateway/reconcile.mjs --inspect --reservation <uuid>
 * node gateway/reconcile.mjs --retain-maximum --reservation <uuid>
 *
 * Inspection requires DATABASE_URL. Mutation additionally requires the isolated
 * VENICE_RECONCILIATION_ADMIN_KEY; never install that credential in the gateway,
 * signer, browser or routine worker. Only a fixed, read-only DIEM billing endpoint
 * receives it. No key creation, provider writes or account bootstrap occurs here.
 *
 * Positive proof requires a provider-issued completion ID persisted by the actual
 * inference transport, matching DIEM output billing, model and admission time.
 * Legacy reservations without that ID remain held; absence from a ledger is never
 * evidence of a refund. Account provenance comes from the exact upstream request
 * ID, not a caller-supplied wallet assertion. The USDC x402 ledger is insufficient.
 *
 * Full maximum is charged in the original epoch. Reconciliation in a later epoch
 * also adds a linked full-maximum charge to the current epoch. Historical charges
 * remain intact, and current capacity is conservative. Repetition is idempotent.
 *
 * Provider schema: https://github.com/veniceai/skills/blob/main/skills/venice-billing/SKILL.md
 * /billing/usage-history documents DIEM, completion IDs, output SKUs and cursor pagination.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { transaction } from "./store.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ENDPOINT = "https://api.venice.ai/api/v1/billing/usage-history";
const fail = (code) => Object.assign(new Error(code), { code });
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function parseReconcileArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 3 ||
    !["--inspect", "--retain-maximum"].includes(args[0]) ||
    args[1] !== "--reservation" ||
    !UUID.test(args[2])
  )
    throw fail("RECONCILIATION_EXPLICIT_ARGUMENTS_REQUIRED");
  return {
    mode: args[0] === "--inspect" ? "inspect" : "retain",
    reservationId: args[2],
  };
}

export async function inspectReservation({ pool, reservationId }) {
  if (!UUID.test(reservationId)) throw fail("RECONCILIATION_INVALID_ID");
  const {
    rows: [row],
  } = await pool.query(
    `SELECT u.id,u.project_id,u.state,u.provider_epoch,u.maximum_microusd,u.charged_microusd,
    u.provider_request_id,u.model,u.created_at,r.evidence FROM usage_reservations u
    LEFT JOIN usage_reconciliations r ON r.reservation_id=u.id WHERE u.id=$1`,
    [reservationId],
  );
  if (!row) throw fail("RECONCILIATION_NOT_FOUND");
  return {
    reservationId: row.id,
    projectId: row.project_id,
    state: row.state,
    originalEpoch: row.provider_epoch,
    maximumMicrousd: row.maximum_microusd,
    chargedMicrousd: row.charged_microusd,
    providerRequestId: row.provider_request_id,
    canCorrelate:
      typeof row.provider_request_id === "string" &&
      PROVIDER_ID.test(row.provider_request_id),
    model: row.model,
    createdAt: row.created_at.toISOString(),
    reconciliation: row.evidence ?? null,
  };
}

function debitMicroUsd(amount) {
  let text =
    typeof amount === "number" && Number.isFinite(amount)
      ? String(amount)
      : amount;
  // JSON numeric amounts below 1e-6 stringify with an exponent. Expand the
  // decimal representation before integer rounding; never truncate a debit.
  const scientific =
    typeof text === "string" && /^-(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(text);
  if (scientific) {
    const exponent = Number(scientific[3]);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 20)
      throw fail("RECONCILIATION_INVALID_PROOF");
    const digits = scientific[1] + (scientific[2] ?? "");
    const point = scientific[1].length + exponent;
    text =
      point <= 0
        ? `-0.${"0".repeat(-point)}${digits}`
        : point >= digits.length
          ? `-${digits}${"0".repeat(point - digits.length)}`
          : `-${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  if (
    typeof text !== "string" ||
    !/^-(0|[1-9][0-9]{0,12})(\.[0-9]{1,20})?$/.test(text)
  )
    throw fail("RECONCILIATION_INVALID_PROOF");
  const [whole, fraction = ""] = text.slice(1).split(".");
  const truncated =
    BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  const rounded = truncated + (/[1-9]/.test(fraction.slice(6)) ? 1n : 0n);
  if (rounded <= 0n) throw fail("RECONCILIATION_INVALID_PROOF");
  return rounded;
}

async function boundedJson(response) {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json") ||
    !response.body
  ) {
    try {
      response.body?.cancel().catch(() => {});
    } catch {
      /* Already closed. */
    }
    throw fail("RECONCILIATION_PROVIDER_UNAVAILABLE");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw fail("RECONCILIATION_INVALID_PROOF");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw fail("RECONCILIATION_INVALID_PROOF");
  }
}

async function readDiemProof({ reservation, adminKey, fetchImpl, now }) {
  if (typeof adminKey !== "string" || !adminKey || /\s/.test(adminKey))
    throw fail("RECONCILIATION_ADMIN_KEY_REQUIRED");
  const createdAt = reservation.created_at.getTime();
  // Bound provider history traversal and clock tolerance. Older uncorrelatable
  // requests remain held rather than being cleared through an override.
  if (
    !Number.isFinite(now) ||
    createdAt > now ||
    now - createdAt > 90 * 86400000
  )
    throw fail("RECONCILIATION_PROOF_WINDOW_UNAVAILABLE");
  const first = new URL(ENDPOINT);
  first.searchParams.set("currency", "DIEM");
  first.searchParams.set(
    "startTimestamp",
    new Date(createdAt - 60000).toISOString(),
  );
  first.searchParams.set("endTimestamp", new Date(now + 1).toISOString());
  first.searchParams.set("pageSize", "1000");
  let url = first.toString();
  const seenCursors = new Set(),
    seenRows = new Set(),
    matching = [];
  for (let page = 0; page < 10; page++) {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${adminKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    const data = await boundedJson(response);
    if (
      !Array.isArray(data?.data) ||
      data.data.length > 1000 ||
      !(data.nextCursor === null || typeof data.nextCursor === "string")
    )
      throw fail("RECONCILIATION_INVALID_PROOF");
    for (const row of data.data) {
      if (row?.inferenceDetails?.requestId !== reservation.provider_request_id)
        continue;
      const details = row.inferenceDetails;
      const time = Date.parse(row.timestamp);
      const sku = row.sku;
      if (
        row.currency !== "DIEM" ||
        ![
          `${reservation.model}-llm-input-mtoken`,
          `${reservation.model}-llm-output-mtoken`,
        ].includes(sku) ||
        !Number.isFinite(time) ||
        time < createdAt - 60000 ||
        time > now ||
        ![
          details.promptTokens,
          details.completionTokens,
          details.inferenceExecutionTime,
        ].every((value) => Number.isSafeInteger(value) && value >= 0)
      )
        throw fail("RECONCILIATION_INVALID_PROOF");
      const item = {
        timestamp: new Date(time).toISOString(),
        sku,
        currency: "DIEM",
        chargedMicrousd: debitMicroUsd(row.amount).toString(),
        requestId: reservation.provider_request_id,
        promptTokens: details.promptTokens,
        completionTokens: details.completionTokens,
        inferenceExecutionTime: details.inferenceExecutionTime,
      };
      const identity = hash(item);
      if (seenRows.has(identity)) throw fail("RECONCILIATION_DUPLICATE_PROOF");
      seenRows.add(identity);
      matching.push(item);
    }
    if (data.nextCursor === null) {
      if (
        matching.filter(
          (row) => row.sku === `${reservation.model}-llm-output-mtoken`,
        ).length !== 1 ||
        matching.filter(
          (row) => row.sku === `${reservation.model}-llm-input-mtoken`,
        ).length > 1
      )
        throw fail("RECONCILIATION_MISSING_PROOF");
      return {
        source: ENDPOINT,
        currency: "DIEM",
        providerRequestId: reservation.provider_request_id,
        model: reservation.model,
        observedAt: new Date(now).toISOString(),
        providerChargedMicrousd: matching
          .reduce((sum, item) => sum + BigInt(item.chargedMicrousd), 0n)
          .toString(),
        proofHash: hash(matching),
        billing: matching,
      };
    }
    if (
      !data.nextCursor ||
      data.nextCursor.length > 4096 ||
      seenCursors.has(data.nextCursor)
    )
      throw fail("RECONCILIATION_INVALID_CURSOR");
    seenCursors.add(data.nextCursor);
    const next = new URL(ENDPOINT);
    next.searchParams.set("cursor", data.nextCursor);
    url = next.toString();
  }
  throw fail("RECONCILIATION_PROOF_LIMIT");
}

export async function reconcileReservation({
  pool,
  reservationId,
  adminKey,
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!UUID.test(reservationId)) throw fail("RECONCILIATION_INVALID_ID");
  const {
    rows: [reservation],
  } = await pool.query("SELECT * FROM usage_reservations WHERE id=$1", [
    reservationId,
  ]);
  if (!reservation) throw fail("RECONCILIATION_NOT_FOUND");
  const {
    rows: [existing],
  } = await pool.query(
    "SELECT evidence FROM usage_reconciliations WHERE reservation_id=$1",
    [reservationId],
  );
  if (existing) return existing.evidence;
  if (!["uncertain", "reserved"].includes(reservation.state))
    throw fail("RECONCILIATION_ALREADY_FINAL");
  if (
    !reservation.provider_request_id ||
    !PROVIDER_ID.test(reservation.provider_request_id)
  )
    throw fail("RECONCILIATION_MISSING_IDENTITY");
  const proof = await readDiemProof({
    reservation,
    adminKey,
    fetchImpl,
    now: now(),
  });
  const result = await transaction(pool, async (client) => {
    const {
      rows: [project],
    } = await client.query(
      "SELECT *,clock_timestamp() AS db_now FROM projects WHERE id=$1 FOR UPDATE",
      [reservation.project_id],
    );
    const {
      rows: [current],
    } = await client.query(
      "SELECT * FROM usage_reservations WHERE id=$1 FOR UPDATE",
      [reservationId],
    );
    const {
      rows: [already],
    } = await client.query(
      "SELECT evidence FROM usage_reconciliations WHERE reservation_id=$1",
      [reservationId],
    );
    if (already) return { evidence: already.evidence };
    if (
      !project ||
      !["reserved", "uncertain"].includes(current.state) ||
      current.provider_request_id !== proof.providerRequestId ||
      current.model !== proof.model ||
      current.project_id !== reservation.project_id ||
      current.key_id !== reservation.key_id
    )
      throw fail("RECONCILIATION_BINDING_CHANGED");
    if (
      BigInt(proof.providerChargedMicrousd) > BigInt(current.maximum_microusd)
    ) {
      await client.query("UPDATE projects SET status='suspended' WHERE id=$1", [
        project.id,
      ]);
      await client.query(
        "UPDATE provider_bindings SET status=CASE WHEN status='disabled' THEN 'disabled' ELSE 'pending' END,canary_verified_at=NULL,observed_at=NULL WHERE project_id=$1",
        [project.id],
      );
      await client.query(
        "INSERT INTO audit_events(project_id,kind,object_id) VALUES($1,'usage.reconciliation_bound_violation',$2)",
        [project.id, reservationId],
      );
      return { boundViolation: true };
    }
    const epoch = project.db_now.toISOString().slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(current.provider_epoch) ||
      current.provider_epoch > epoch
    )
      throw fail("RECONCILIATION_INVALID_EPOCH");
    let retentionId = null;
    if (current.provider_epoch !== epoch) {
      retentionId = randomUUID();
      await client.query(
        `INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,idempotency_hash,maximum_microusd,charged_microusd,model,state,settled_at)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,'settled',clock_timestamp())`,
        [
          retentionId,
          project.id,
          current.key_id,
          epoch,
          hash(`reconciliation:${reservationId}`),
          current.maximum_microusd,
          current.model,
        ],
      );
    }
    await client.query(
      "UPDATE usage_reservations SET state='settled',charged_microusd=maximum_microusd,settled_at=clock_timestamp() WHERE id=$1",
      [reservationId],
    );
    const evidence = {
      ...proof,
      reservationId,
      projectId: project.id,
      retainedMicrousd: current.maximum_microusd,
      originalEpoch: current.provider_epoch,
      retainedEpoch: epoch,
      retentionReservationId: retentionId,
    };
    await client.query(
      `INSERT INTO usage_reconciliations(reservation_id,project_id,provider_request_id,retention_reservation_id,evidence)
      VALUES($1,$2,$3,$4,$5)`,
      [
        reservationId,
        project.id,
        current.provider_request_id,
        retentionId,
        evidence,
      ],
    );
    await client.query(
      "INSERT INTO audit_events(project_id,kind,object_id) VALUES($1,'usage.retained_maximum',$2)",
      [project.id, reservationId],
    );
    return { evidence };
  });
  if (result.boundViolation) throw fail("RECONCILIATION_BOUND_VIOLATION");
  return result.evidence;
}

async function main(args, env) {
  const { mode, reservationId } = parseReconcileArgs(args);
  if (!env.DATABASE_URL) throw fail("RECONCILIATION_DATABASE_REQUIRED");
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  try {
    const result =
      mode === "inspect"
        ? await inspectReservation({ pool, reservationId })
        : await reconcileReservation({
            pool,
            reservationId,
            adminKey: env.VENICE_RECONCILIATION_ADMIN_KEY,
          });
    process.stdout.write(
      `${JSON.stringify({ event: mode === "inspect" ? "reconciliation.inspected" : "reconciliation.retained", result })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2), process.env).catch((failure) => {
    const code =
      typeof failure?.code === "string" &&
      /^RECONCILIATION_[A-Z_]+$/.test(failure.code)
        ? failure.code
        : "RECONCILIATION_FAILED";
    process.stderr.write(
      `${JSON.stringify({ event: "reconciliation.incomplete", code, message: "No refund or inference retry was performed. Outstanding capacity remains held unless positive proof was committed." })}\n`,
    );
    process.exitCode = 1;
  });
