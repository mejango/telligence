import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { PostgresWorkerStore } from "../../control-worker/postgres.mjs";
import { readProviderCapacity } from "../../control-worker/capacity.mjs";
import { GatewayStore } from "../store.mjs";
import { microToUsd, signKey } from "../policy.mjs";
import { parseCanaryArgs, runCanary } from "../canary.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `canary_test_${randomBytes(8).toString("hex")}`;
const bootstrap = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl })
  : null;
const pool = databaseUrl
  ? new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
      max: 12,
    })
  : null;
const pepper = "test-only-canary-pepper-never-use-in-production";
const storeOptions = {
  keyPepper: pepper,
  capacityMaxAgeMs: 30000,
  safetyMarginMicroUsd: 1000n,
};
const addr = () => `0x${randomBytes(20).toString("hex")}`;
const blockHash = `0x${"ab".repeat(32)}`;

before(async () => {
  if (pool) {
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
  }
});
after(async () => {
  if (pool) {
    await pool.end();
    await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);
    await bootstrap.end();
  }
});

async function fixture(
  t,
  {
    debit = 2n,
    malformed = false,
    price = 1_000_000,
    projectLimit = 1_000_000,
  } = {},
) {
  const projectId = randomUUID();
  const key = signKey(pepper);
  const signer = addr();
  const vault = addr();
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd)
    VALUES($1,'1',$2,$3,$4,$5,'Canary','Canary safety fixture','fixture',1000000,$6)`,
    [
      projectId,
      BigInt(`0x${randomBytes(16).toString("hex")}`).toString(),
      addr(),
      vault,
      addr(),
      projectLimit,
    ],
  );
  await pool.query(
    "INSERT INTO provider_bindings(project_id,signer_address,encrypted_signer) VALUES($1,$2,'test-only-encrypted')",
    [projectId, signer],
  );
  await pool.query(
    "INSERT INTO api_keys(id,project_id,prefix,secret_hash,name,daily_limit_microusd) VALUES($1,$2,$3,$4,'Canary',1000000)",
    [key.id, projectId, key.prefix, key.hash],
  );
  const state = { paid: 0, free: 0, remaining: 1_000_000n, payload: null };
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") {
      state.free++;
      response.end(
        JSON.stringify({
          success: true,
          data: {
            walletAddress: vault,
            balanceUsd: "0",
            canConsume: true,
            diemBalanceUsd: microToUsd(state.remaining),
          },
        }),
      );
      return;
    }
    state.paid++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    state.payload = JSON.parse(Buffer.concat(chunks).toString());
    state.remaining -= debit;
    response.end(
      malformed
        ? "{"
        : JSON.stringify({
            choices: [{ message: { content: "OK" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.venice.ai");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.authorization, undefined);
    return fetch(
      `http://127.0.0.1:${server.address().port}${parsed.pathname}`,
      options,
    );
  };
  const workerStore = new PostgresWorkerStore(pool);
  const signerClient = {
    getHeader: async (project, resource) => {
      assert.equal(
        typeof project === "string" ? project : project.id,
        projectId,
      );
      assert.ok([0, 3].includes(resource));
      return {
        headerName: "SIGN-IN-WITH-X",
        headerValue: "TEST_ONLY_HEADER",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    },
  };
  const readCapacity = async (project) => ({
    ...(await readProviderCapacity({
      project,
      diem: {
        stakedDiem: 10n ** 18n,
        blockNumber: 1n,
        blockHash,
        verifiedAt: Date.now(),
      },
      fetchImpl,
      getAuthHeader: async () =>
        (await signerClient.getHeader(project, 3)).headerValue,
    })),
    signerGeneration: 1,
    signerAddress: signer,
    authenticationEnabled: true,
  });
  const options = {
    pool,
    storeOptions,
    projectId,
    model: "test-model",
    secret: key.secret,
    signerClient,
    readCapacity,
    saveCapacity: (id, snapshot) =>
      workerStore.updateProviderCapacity(id, snapshot),
    fetchImpl,
    prices: {
      validUntil: new Date(Date.now() + 3600000).toISOString(),
      models: {
        "test-model": {
          inputMicroUsdPerMillion: price,
          outputMicroUsdPerMillion: price,
          maxOutputTokens: 16,
          maxInputBytes: 1000,
          maxContextTokens: 1000,
        },
      },
    },
  };
  return { options, state, key };
}

test("canary CLI requires explicit execution and rejects unknown options or missing bindings", () => {
  const id = randomUUID();
  assert.deepEqual(
    parseCanaryArgs([
      "--execute-canary",
      "--project",
      id,
      "--model",
      "test-model",
    ]),
    { projectId: id, model: "test-model" },
  );
  for (const args of [
    [],
    ["--project", id, "--model", "test-model"],
    ["--execute-canary", "--project", id],
    [
      "--execute-canary",
      "--project",
      id,
      "--model",
      "test-model",
      "--max-cost",
      "10",
    ],
  ])
    assert.throws(() => parseCanaryArgs(args));
});

test(
  "one capped production-transport canary activates only after settled DIEM debit; replay never pays again",
  { skip: !pool },
  async (t) => {
    const { options, state } = await fixture(t);
    const result = await runCanary(options);
    assert.equal(result.chargedMicrousd, "2");
    assert.equal(result.signerGeneration, 1);
    assert.equal(state.paid, 1);
    assert.equal(state.payload.max_completion_tokens, 16);
    assert.equal(state.payload.stream, false);
    assert.deepEqual(state.payload.messages, [
      { role: "user", content: "Reply with OK" },
    ]);
    assert.equal(JSON.stringify(result).includes("TEST_ONLY_HEADER"), false);
    assert.equal(JSON.stringify(result).includes("Reply with OK"), false);
    const {
      rows: [project],
    } = await pool.query(
      "SELECT p.status,b.canary_verified_at FROM projects p JOIN provider_bindings b ON b.project_id=p.id WHERE p.id=$1",
      [options.projectId],
    );
    assert.equal(project.status, "active");
    assert.ok(project.canary_verified_at);
    assert.deepEqual(await runCanary(options), result);
    assert.equal(state.paid, 1);
  },
);

test(
  "ambiguous paid response is durable uncertainty and cannot be retried or activate ordinary access",
  { skip: !pool },
  async (t) => {
    const { options, state, key } = await fixture(t, { malformed: true });
    await assert.rejects(
      runCanary(options),
      (error) => error.code === "CANARY_UNCERTAIN",
    );
    await assert.rejects(
      runCanary(options),
      (error) => error.code === "CANARY_INCOMPLETE",
    );
    assert.equal(state.paid, 1);
    const {
      rows: [run],
    } = await pool.query(
      "SELECT c.state,u.state AS reservation_state FROM canary_runs c JOIN usage_reservations u ON u.id=c.reservation_id WHERE c.project_id=$1",
      [options.projectId],
    );
    assert.equal(run.state, "uncertain");
    assert.equal(run.reservation_state, "uncertain");
    await assert.rejects(
      new GatewayStore(pool, storeOptions).reserve({
        secret: key.secret,
        maximumMicroUsd: 1n,
        model: "test-model",
      }),
    );
  },
);

test(
  "missing provider debit cannot activate, and cap or quota failure never makes a paid request",
  { skip: !pool },
  async (t) => {
    const missing = await fixture(t, { debit: 0n });
    await assert.rejects(
      runCanary(missing.options),
      (error) => error.code === "CANARY_UNCERTAIN",
    );
    assert.equal(missing.state.paid, 1);
    const expensive = await fixture(t, { price: 1_000_000_000 });
    await assert.rejects(
      runCanary(expensive.options),
      (error) => error.code === "CANARY_CAP_EXCEEDED",
    );
    assert.equal(expensive.state.paid, 0);
    const exhausted = await fixture(t, { projectLimit: 1 });
    await assert.rejects(
      runCanary(exhausted.options),
      (error) => error.code === "CANARY_UNCERTAIN",
    );
    assert.equal(exhausted.state.paid, 0);
  },
);

test(
  "concurrent canary invocations issue at most one paid request",
  { skip: !pool },
  async (t) => {
    const { options, state } = await fixture(t);
    const result = await Promise.allSettled([
      runCanary(options),
      runCanary(options),
    ]);
    assert.equal(
      result.filter((value) => value.status === "fulfilled").length,
      1,
    );
    assert.equal(state.paid, 1);
  },
);

test(
  "stale or mismatched chain identity cannot sign a canary; post-request rotation cannot activate",
  { skip: !pool },
  async (t) => {
    for (const change of [
      { observedAt: "2000-01-01T00:00:00.000Z" },
      { signerGeneration: 2 },
      { authenticationEnabled: false },
    ]) {
      const { options, state } = await fixture(t);
      const read = options.readCapacity;
      await assert.rejects(
        runCanary({
          ...options,
          readCapacity: async (project) => ({
            ...(await read(project)),
            ...change,
          }),
        }),
        (error) => error.code === "CANARY_UNCERTAIN",
      );
      assert.equal(state.paid, 0);
    }
    const { options, state } = await fixture(t);
    const read = options.readCapacity;
    let observations = 0;
    await assert.rejects(
      runCanary({
        ...options,
        readCapacity: async (project) => ({
          ...(await read(project)),
          signerGeneration: ++observations === 1 ? 1 : 2,
        }),
      }),
      (error) => error.code === "CANARY_UNCERTAIN",
    );
    assert.equal(state.paid, 1);
    const {
      rows: [binding],
    } = await pool.query(
      "SELECT canary_verified_at FROM provider_bindings WHERE project_id=$1",
      [options.projectId],
    );
    assert.equal(binding.canary_verified_at, null);
  },
);

test(
  "uncertain canaries retain only a safe failure phase and never a request or credential",
  { skip: !pool },
  async (t) => {
    const { options } = await fixture(t, { debit: 0n });
    await assert.rejects(runCanary(options));
    const {
      rows: [run],
    } = await pool.query(
      "SELECT evidence FROM canary_runs WHERE project_id=$1",
      [options.projectId],
    );
    assert.equal(run.evidence.phase, "capacity_after");
    assert.equal(run.evidence.failureCode, "CANARY_UNCONFIRMED_DIEM_DEBIT");
    assert.equal(JSON.stringify(run.evidence).includes(options.secret), false);
    assert.equal(JSON.stringify(run.evidence).includes("Reply with OK"), false);
  },
);

test("the canary reads the production model policy once before any paid operation", async () => {
  const { loadCanaryPrices } = await import("../canary.mjs");
  const policy = {
    models: {
      "canary-model": {
        inputMicroUsdPerMillion: 1000000,
        outputMicroUsdPerMillion: 1000000,
        maxOutputTokens: 32,
        maxInputBytes: 1000,
        maxContextTokens: 4000,
      },
    },
  };
  const model = {
    id: "canary-model",
    type: "text",
    model_spec: {
      offline: false,
      availableContextTokens: 4000,
      maxCompletionTokens: 32,
      capabilities: { supportsReasoning: false },
      pricing: { input: { diem: 1 }, output: { diem: 1 } },
    },
  };
  let calls = 0;
  const prices = await loadCanaryPrices(
    { MODEL_POLICY_JSON: JSON.stringify(policy) },
    {
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, "https://api.venice.ai/api/v1/models?type=text");
        assert.equal(options.headers.authorization, undefined);
        return new Response(JSON.stringify({ data: [model] }));
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(prices.models, policy.models);
  await assert.rejects(() =>
    loadCanaryPrices({
      MODEL_POLICY_JSON: JSON.stringify(policy),
      MODEL_PRICES_JSON: "{}",
    }),
  );
  await assert.rejects(() =>
    loadCanaryPrices(
      { MODEL_POLICY_JSON: JSON.stringify(policy) },
      { fetchImpl: async () => new Response(JSON.stringify({ data: [] })) },
    ),
  );
});
