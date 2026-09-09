import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { GatewayStore } from "../store.mjs";
import { createHandler } from "../app.mjs";
const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
const account = privateKeyToAccount(`0x${"12".repeat(32)}`);
const origin = "http://localhost:3000";
let server, baseUrl, projectId, config;
before(async () => {
  if (!pool) return;
  await migrate(pool);
  const store = new GatewayStore(pool, {
    keyPepper: "test-pepper-at-least-thirty-two-bytes",
    safetyMarginMicroUsd: 0n,
  });
  config = {
    allowedOrigins: [origin],
    keyPepper: store.keyPepper,
    secureCookies: false,
    catalog: null,
    apiBaseUrl: "https://api.test/api/v1",
  };
  server = createServer(
    createHandler({
      store,
      config,
      registry: {
        client: null,
        config: async () => ({ ready: false, chainId: 8453 }),
        verifyProject: async () => ({
          policyHash: "test",
          policyVersion: "2",
          signerGeneration: 1,
          authenticationEnabled: true,
        }),
      },
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  projectId = randomUUID();
  const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd) VALUES($1,'1',$2,$3,$4,$5,'auth test','auth test','auth test',10000000,10000000)`,
    [
      projectId,
      BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(),
      addr(),
      addr(),
      account.address.toLowerCase(),
    ],
  );
});
after(async () => {
  if (pool) {
    await new Promise((r) => server.close(r));
    await pool.query("DELETE FROM audit_events WHERE project_id=$1", [
      projectId,
    ]);
    await pool.query("DELETE FROM api_keys WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM projects WHERE id=$1", [projectId]);
    await pool.query("DELETE FROM creator_sessions WHERE address=$1", [
      account.address.toLowerCase(),
    ]);
    await pool.query("DELETE FROM auth_challenges WHERE address=$1", [
      account.address.toLowerCase(),
    ]);
    await pool.end();
  }
});
async function json(path, method = "GET", body, headers = {}) {
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
test(
  "creator sign-in verifies wallet signature, consumes challenge exactly once and enforces CSRF + project ownership",
  { skip: !url },
  async () => {
    const c = await json("/v1/auth/challenge", "POST", {
      address: account.address,
    });
    assert.equal(c.status, 200);
    assert.match(c.body.message, /Chain ID: 8453/);
    const signature = await account.signMessage({ message: c.body.message });
    const login = await json("/v1/auth/verify", "POST", {
      challengeId: c.body.challengeId,
      signature,
    });
    assert.equal(login.status, 200);
    assert.equal(
      (
        await json("/v1/auth/verify", "POST", {
          challengeId: c.body.challengeId,
          signature,
        })
      ).status,
      401,
    );
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { cookie, "x-csrf-token": login.body.csrfToken };
    assert.equal(
      (
        await json(
          `/v1/projects/${projectId}/authentication/sync`,
          "POST",
          {},
          { cookie },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await json(
          `/v1/projects/${projectId}/signer`,
          "POST",
          { preparationId: randomUUID() },
          { cookie },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await json(
          `/v1/projects/${projectId}/authentication/sync`,
          "POST",
          { unexpected: true },
          headers,
        )
      ).status,
      400,
    );

    const session = await json("/v1/auth/session", "GET", null, { cookie });
    assert.equal(session.body.csrfToken, login.body.csrfToken);
    assert.equal(
      (
        await json(
          `/v1/projects/${projectId}/keys`,
          "POST",
          { name: "test", dailyLimitUsd: "1" },
          { cookie },
        )
      ).status,
      401,
    );
    const key = await json(
      `/v1/projects/${projectId}/keys`,
      "POST",
      { name: "test", dailyLimitUsd: "1" },
      headers,
    );
    assert.equal(key.status, 201);
    assert.match(key.body.secret, /^tlg_/);
    const list = await json(`/v1/projects/${projectId}/keys`, "GET", null, {
      cookie,
    });
    assert.equal(list.status, 200);
    assert.equal(JSON.stringify(list.body).includes(key.body.secret), false);
    const revoke = await json(
      `/v1/projects/${projectId}/keys/${key.body.key.id}`,
      "DELETE",
      null,
      headers,
    );
    assert.equal(revoke.status, 200);
    const missing = await json(
      `/v1/projects/${randomUUID()}/keys`,
      "GET",
      null,
      { cookie },
    );
    assert.equal(missing.status, 404);
  },
);
test(
  "hostile origin, malformed bodies and absent deployment never return fake ready",
  { skip: !url },
  async () => {
    assert.equal(
      (
        await json(
          "/v1/auth/challenge",
          "POST",
          { address: account.address },
          { origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await json("/v1/auth/challenge", "POST", { address: "not-an-address" }))
        .status,
      400,
    );
    const config = await json("/v1/config");
    assert.equal(config.body.ready, false);
    assert.equal(
      (
        await json("/api/v1/chat/completions", "POST", {
          model: "unconfigured",
        })
      ).status,
      503,
    );
  },
);

test(
  "a confirmed launch recovers expired preparation and a lost registration response is idempotent",
  { skip: !url },
  async () => {
    const c = await json("/v1/auth/challenge", "POST", {
      address: account.address,
    });
    const signature = await account.signMessage({ message: c.body.message });
    const login = await json("/v1/auth/verify", "POST", {
      challengeId: c.body.challengeId,
      signature,
    });
    const headers = {
      cookie: login.headers.get("set-cookie").split(";")[0],
      "x-csrf-token": login.body.csrfToken,
    };
    const preparationId = randomUUID();
    const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
    await pool.query(
      "INSERT INTO signer_preparations(id,creator_address,encrypted_signer,signer_address,expires_at) VALUES($1,$2,'test-fixture',$3,now()-interval '1 hour')",
      [preparationId, account.address.toLowerCase(), addr()],
    );
    const body = {
      preparationId,
      revnetId: BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(),
      wrapperAddress: addr(),
      vaultAddress: addr(),
      name: "recovered",
      purpose: "recovered",
      workload: "text",
      targetDailyCreditUsd: "1",
      policyVersion: "999",
    };
    let registeredId;
    try {
      const first = await json("/v1/projects", "POST", body, headers);
      assert.equal(first.status, 201);
      registeredId = first.body.project.id;
      assert.equal(first.body.project.policyVersion, "2");
      assert.equal(
        (
          await pool.query("SELECT policy_version FROM projects WHERE id=$1", [
            registeredId,
          ])
        ).rows[0].policy_version,
        "2",
      );
      // Historical snapshots retain their original version on registration retries.
      await pool.query("UPDATE projects SET policy_version='1' WHERE id=$1", [
        registeredId,
      ]);
      const repeated = await json(
        "/v1/projects",
        "POST",
        { ...body, name: "cannot overwrite" },
        headers,
      );
      assert.equal(repeated.status, 200);
      assert.equal(repeated.body.project.id, registeredId);
      assert.equal(repeated.body.project.name, "recovered");
      assert.equal(repeated.body.project.policyVersion, "1");
      assert.equal(
        (
          await json(
            "/v1/projects",
            "POST",
            { ...body, vaultAddress: addr() },
            headers,
          )
        ).status,
        409,
      );
    } finally {
      await pool.query("DELETE FROM signer_preparations WHERE id=$1", [
        preparationId,
      ]);
      if (registeredId) {
        await pool.query("DELETE FROM provider_bindings WHERE project_id=$1", [
          registeredId,
        ]);
        await pool.query("DELETE FROM audit_events WHERE project_id=$1", [
          registeredId,
        ]);
        await pool.query("DELETE FROM projects WHERE id=$1", [registeredId]);
      }
    }
  },
);

test(
  "a rejected refreshed catalog cannot fall back to a previously configured price list",
  { skip: !url },
  async () => {
    config.catalog = {
      validUntil: new Date(Date.now() + 60000).toISOString(),
      models: {
        old: {
          inputMicroUsdPerMillion: 1,
          outputMicroUsdPerMillion: 1,
          maxOutputTokens: 32,
          maxInputBytes: 1000,
          maxContextTokens: 4000,
        },
      },
    };
    config.getCatalog = () => null;
    try {
      assert.equal(
        (await json("/api/v1/chat/completions", "POST", { model: "old" }))
          .status,
        503,
      );
    } finally {
      config.catalog = null;
      delete config.getCatalog;
    }
  },
);
