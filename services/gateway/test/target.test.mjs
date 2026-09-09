import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { migrate } from "../../db/migrate.mjs";
import { GatewayStore } from "../store.mjs";
import { createHandler } from "../app.mjs";

const url = process.env.TEST_DATABASE_URL;
const schema = `target_${randomUUID().replaceAll("-", "")}`;
const admin = url ? new pg.Pool({ connectionString: url }) : null;
const pool = url
  ? new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  : null;
const account = privateKeyToAccount(`0x${"73".repeat(32)}`);
const origin = "http://localhost:3000";
const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
let server, baseUrl, headers, store;

before(async () => {
  if (!pool) return;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  store = new GatewayStore(pool, {
    keyPepper: "optional-target-test-pepper-not-a-production-secret",
    capacityMaxAgeMs: 60000,
    safetyMarginMicroUsd: 0n,
  });
  server = createServer(
    createHandler({
      store,
      config: {
        allowedOrigins: [origin],
        keyPepper: store.keyPepper,
        secureCookies: false,
        catalog: null,
      },
      registry: {
        client: null,
        verifyProject: async () => ({
          signerGeneration: 1,
          policyVersion: "2",
        }),
      },
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const challenge = await request("/v1/auth/challenge", "POST", {
    address: account.address,
  });
  const login = await request("/v1/auth/verify", "POST", {
    challengeId: challenge.body.challengeId,
    signature: await account.signMessage({ message: challenge.body.message }),
  });
  assert.equal(login.status, 200);
  headers = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": login.body.csrfToken,
  };
});

after(async () => {
  if (!pool) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function request(path, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin,
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

async function preparation(target = {}) {
  const preparationId = randomUUID();
  await pool.query(
    "INSERT INTO signer_preparations(id,creator_address,encrypted_signer,signer_address,expires_at) VALUES($1,$2,'test-only',$3,now()+interval '1 hour')",
    [preparationId, account.address.toLowerCase(), addr()],
  );
  return {
    preparationId,
    revnetId: BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(),
    wrapperAddress: addr(),
    vaultAddress: addr(),
    name: "A useful project",
    purpose: "Describe the work before estimating its usage.",
    workload: "text",
    ...target,
  };
}

async function register(target = {}) {
  const body = await preparation(target);
  const response = await request("/v1/projects", "POST", body);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { body, project: response.body.project };
}

for (const [name, field, expected] of [
  ["omitted", {}, null],
  ["explicitly null", { targetDailyCreditUsd: null }, null],
  ["a positive decimal", { targetDailyCreditUsd: "0.000001" }, "0.000001"],
]) {
  test(
    `registration accepts ${name} target as metadata without setting a spending cap`,
    { skip: !url },
    async () => {
      const { body, project } = await register(field);
      assert.equal(project.targetDailyCreditUsd, expected);
      assert.equal(project.capacity.dailyCreditUsd, "0.000000");
      assert.equal(project.capacity.status, "provisioning");
      const {
        rows: [row],
      } = await pool.query(
        "SELECT target_daily_microusd,daily_limit_microusd FROM projects WHERE id=$1",
        [project.id],
      );
      assert.equal(row.target_daily_microusd, expected === null ? null : "1");
      assert.equal(row.daily_limit_microusd, null);
      const detail = await request(`/v1/projects/${project.id}`);
      assert.equal(detail.body.project.targetDailyCreditUsd, expected);
      const listing = await request("/v1/projects");
      assert.equal(
        listing.body.projects.find((p) => p.id === project.id)
          .targetDailyCreditUsd,
        expected,
      );
      const repeated = await request("/v1/projects", "POST", {
        ...body,
        targetDailyCreditUsd: "99",
      });
      assert.equal(repeated.status, 200);
      assert.equal(repeated.body.project.targetDailyCreditUsd, expected);
    },
  );
}

test(
  "malformed, zero and noncanonical targets are rejected without claiming a preparation",
  { skip: !url },
  async () => {
    const body = await preparation();
    for (const value of [
      "",
      " ",
      "0",
      "0.000000",
      "-1",
      "01",
      "1e2",
      "1.0000001",
      "1000000000",
      " 1",
      "1 ",
      1,
      0,
      false,
      {},
      [],
    ]) {
      const response = await request("/v1/projects", "POST", {
        ...body,
        targetDailyCreditUsd: value,
      });
      assert.equal(response.status, 400, JSON.stringify(value));
      assert.equal(
        response.body.error.code,
        "invalid_amount",
        JSON.stringify(value),
      );
    }
    const {
      rows: [row],
    } = await pool.query(
      "SELECT claimed_project_id FROM signer_preparations WHERE id=$1",
      [body.preparationId],
    );
    assert.equal(row.claimed_project_id, null);
  },
);

async function activate(projectId, capacity = "100") {
  await pool.query("UPDATE projects SET status='active' WHERE id=$1", [
    projectId,
  ]);
  await pool.query(
    "UPDATE provider_bindings SET status='ready',provider_epoch=$2,daily_limit_microusd=$3,remaining_microusd=$3,observed_at=clock_timestamp(),canary_verified_at=clock_timestamp() WHERE project_id=$1",
    [projectId, new Date().toISOString().slice(0, 10), capacity],
  );
}
async function key(projectId, dailyLimitUsd = "0.000100") {
  const response = await request(`/v1/projects/${projectId}/keys`, "POST", {
    name: "test",
    dailyLimitUsd,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.secret;
}
const reserve = (secret, amount) =>
  store.reserve({ secret, maximumMicroUsd: amount, model: "test" });

test(
  "a target does not cap inference; keys still share verified remaining capacity and reservations",
  { skip: !url },
  async () => {
    const { project } = await register({ targetDailyCreditUsd: "0.000001" });
    await activate(project.id);
    const keys = await Promise.all([key(project.id), key(project.id)]);
    const result = await Promise.allSettled(
      keys.map((secret) => reserve(secret, 60n)),
    );
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      result.find((r) => r.status === "rejected").reason.code,
      "budget_exhausted",
    );
    const admitted = result.find((r) => r.status === "fulfilled").value;
    await store.finish(admitted.id, { state: "uncertain" });
    await pool.query(
      "UPDATE provider_bindings SET observed_at=clock_timestamp() WHERE project_id=$1",
      [project.id],
    );
    await assert.rejects(
      () => reserve(keys[1], 41n),
      (e) => e.code === "budget_exhausted",
    );
    const {
      rows: [row],
    } = await pool.query(
      "SELECT sum(maximum_microusd) AS maximum FROM usage_reservations WHERE project_id=$1",
      [project.id],
    );
    assert.equal(row.maximum, "60");
  },
);

test(
  "an unset project cap retains key limits, provider daily limit and readiness gates",
  { skip: !url },
  async () => {
    const { project } = await register();
    const limitedKey = await key(project.id, "0.000040");
    await assert.rejects(
      () => reserve(limitedKey, 1n),
      (e) => e.code === "capacity_unavailable",
    );
    await activate(project.id);
    await assert.rejects(
      () => reserve(limitedKey, 41n),
      (e) => e.code === "budget_exhausted",
    );
    const largeKey = await key(project.id, "0.000200");
    const first = await reserve(largeKey, 60n);
    await store.finish(first.id, { state: "settled", chargedMicroUsd: 60n });
    // A later snapshot cannot lift the project's observed daily allowance.
    await pool.query(
      "UPDATE provider_bindings SET observed_at=clock_timestamp() WHERE project_id=$1",
      [project.id],
    );
    await assert.rejects(
      () => reserve(largeKey, 41n),
      (e) => e.code === "budget_exhausted",
    );
  },
);

test(
  "migration preserves legacy target and enforced cap while allowing independently absent metadata",
  { skip: !url },
  async () => {
    const legacySchema = `legacy_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${legacySchema}`);
    const legacy = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${legacySchema}`,
    });
    try {
      await migrate(legacy);
      await legacy.query(
        "ALTER TABLE projects ALTER COLUMN target_daily_microusd SET NOT NULL, ALTER COLUMN daily_limit_microusd SET NOT NULL, ALTER COLUMN policy_version SET DEFAULT '1'",
      );
      const id = randomUUID();
      await legacy.query(
        "INSERT INTO projects(id,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd) VALUES($1,1,$2,$3,$4,'legacy','legacy','text',700,500)",
        [id, addr(), addr(), account.address.toLowerCase()],
      );
      await migrate(legacy);
      await migrate(legacy);
      const {
        rows: [row],
      } = await legacy.query(
        "SELECT target_daily_microusd,daily_limit_microusd,policy_version FROM projects WHERE id=$1",
        [id],
      );
      assert.deepEqual(row, {
        target_daily_microusd: "700",
        daily_limit_microusd: "500",
        policy_version: "1",
      });
      await assert.rejects(
        () =>
          legacy.query(
            "INSERT INTO projects(id,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload) VALUES($1,2,$2,$3,$4,'missing version','missing version','text')",
            [randomUUID(), addr(), addr(), account.address.toLowerCase()],
          ),
        (e) => e.code === "23502" && e.column === "policy_version",
      );
      await legacy.query(
        "UPDATE projects SET target_daily_microusd=NULL WHERE id=$1",
        [id],
      );
      assert.equal(
        (
          await legacy.query(
            "SELECT daily_limit_microusd FROM projects WHERE id=$1",
            [id],
          )
        ).rows[0].daily_limit_microusd,
        "500",
      );
      await assert.rejects(
        () =>
          legacy.query(
            "UPDATE projects SET target_daily_microusd=0 WHERE id=$1",
            [id],
          ),
        (e) => e.code === "23514",
      );
      await assert.rejects(
        () =>
          legacy.query(
            "UPDATE projects SET daily_limit_microusd=0 WHERE id=$1",
            [id],
          ),
        (e) => e.code === "23514",
      );
      await legacy.query(
        "UPDATE projects SET daily_limit_microusd=NULL WHERE id=$1",
        [id],
      );
    } finally {
      await legacy.end();
      await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`);
    }
  },
);

test(
  "existing explicit project caps still constrain key creation and combined usage",
  { skip: !url },
  async () => {
    const { project } = await register();
    await activate(project.id);
    await pool.query(
      "UPDATE projects SET daily_limit_microusd=50 WHERE id=$1",
      [project.id],
    );
    const rejected = await request(`/v1/projects/${project.id}/keys`, "POST", {
      name: "too large",
      dailyLimitUsd: "0.000051",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error.code, "invalid_limit");
    const first = await key(project.id, "0.000050");
    const second = await key(project.id, "0.000050");
    await reserve(first, 30n);
    await assert.rejects(
      () => reserve(second, 21n),
      (e) => e.code === "budget_exhausted",
    );
  },
);

test(
  "an already migrated schema can restart while project reservations hold their normal write lock",
  { skip: !url },
  async () => {
    const reservation = await pool.connect();
    const restarting = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema} -c lock_timeout=250ms`,
    });
    try {
      await reservation.query("BEGIN");
      await reservation.query("LOCK TABLE projects IN ROW EXCLUSIVE MODE");
      await migrate(restarting);
    } finally {
      await reservation.query("ROLLBACK");
      reservation.release();
      await restarting.end();
    }
  },
);
