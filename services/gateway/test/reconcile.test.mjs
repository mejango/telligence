import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { GatewayStore } from "../store.mjs";
import {
  inspectReservation,
  parseReconcileArgs,
  reconcileReservation,
  retainUnprovenReservation,
} from "../reconcile.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `reconcile_test_${randomBytes(8).toString("hex")}`;
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
const addr = () => `0x${randomBytes(20).toString("hex")}`;
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

async function fixture({
  ageMs = 86400000,
  providerId = `chatcmpl-${randomUUID()}`,
  amount = "-0.000040",
  maximum = 100n,
} = {}) {
  const projectId = randomUUID(),
    keyId = randomUUID(),
    reservationId = randomUUID();
  const createdAt = new Date(Date.now() - ageMs);
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd,status)
    VALUES($1,'1',$2,$3,$4,$5,'Reconcile','Proof fixture','test',1000000,1000000,'active')`,
    [
      projectId,
      BigInt(`0x${randomBytes(16).toString("hex")}`).toString(),
      addr(),
      addr(),
      addr(),
    ],
  );
  await pool.query(
    "INSERT INTO provider_bindings(project_id,signer_address,encrypted_signer,status) VALUES($1,$2,'test-only','ready')",
    [projectId, addr()],
  );
  await pool.query(
    "INSERT INTO api_keys(id,project_id,prefix,secret_hash,name,daily_limit_microusd) VALUES($1,$2,'test',$3,'Test',1000000)",
    [keyId, projectId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,maximum_microusd,model,state,created_at,provider_request_id)
    VALUES($1,$2,$3,$4,$5,'model-a','uncertain',$6,$7)`,
    [
      reservationId,
      projectId,
      keyId,
      createdAt.toISOString().slice(0, 10),
      maximum.toString(),
      createdAt,
      providerId,
    ],
  );
  let calls = 0;
  const row = {
    timestamp: new Date(createdAt.getTime() + 1000).toISOString(),
    sku: "model-a-llm-output-mtoken",
    amount,
    currency: "DIEM",
    inferenceDetails: {
      requestId: providerId,
      promptTokens: 4,
      completionTokens: 3,
      inferenceExecutionTime: 950,
    },
  };
  const fetchImpl = async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.venice.ai");
    assert.equal(parsed.pathname, "/api/v1/billing/usage-history");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer TEST_ONLY_ADMIN");
    return Response.json({ data: [row], nextCursor: null });
  };
  return {
    projectId,
    keyId,
    reservationId,
    createdAt,
    providerId,
    row,
    calls: () => calls,
    options: { pool, reservationId, adminKey: "TEST_ONLY_ADMIN", fetchImpl },
  };
}

test("reconciliation CLI offers inspection or explicit maximum retention, never refunds or retries", () => {
  const id = randomUUID();
  assert.deepEqual(parseReconcileArgs(["--inspect", "--reservation", id]), {
    mode: "inspect",
    reservationId: id,
  });
  assert.deepEqual(
    parseReconcileArgs(["--retain-maximum", "--reservation", id]),
    { mode: "retain", reservationId: id },
  );
  assert.deepEqual(
    parseReconcileArgs(["--retain-unproven", "--reservation", id]),
    { mode: "retain-unproven", reservationId: id },
  );
  for (const args of [
    [],
    ["--refund", "--reservation", id],
    ["--retain-maximum", "--reservation", id, "--force"],
  ])
    assert.throws(() => parseReconcileArgs(args));
});

test(
  "positive DIEM proof retains the original maximum and a current-epoch maximum exactly once",
  { skip: !pool },
  async () => {
    const f = await fixture();
    const result = await reconcileReservation(f.options);
    assert.equal(result.retainedMicrousd, "100");
    assert.equal(result.providerChargedMicrousd, "40");
    assert.equal(result.originalEpoch, f.createdAt.toISOString().slice(0, 10));
    const { rows } = await pool.query(
      "SELECT * FROM usage_reservations WHERE project_id=$1 ORDER BY created_at",
      [f.projectId],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].provider_epoch, result.originalEpoch);
    assert.equal(rows[0].charged_microusd, "100");
    assert.equal(rows[0].state, "settled");
    assert.equal(rows[1].provider_epoch, new Date().toISOString().slice(0, 10));
    assert.equal(rows[1].charged_microusd, "100");
    assert.equal(rows[1].key_id, f.keyId);
    assert.deepEqual(await reconcileReservation(f.options), result);
    assert.equal(f.calls(), 1);
    assert.equal(JSON.stringify(result).includes("TEST_ONLY_ADMIN"), false);
  },
);

test(
  "inspection and missing provider identities cannot manufacture release evidence",
  { skip: !pool },
  async () => {
    const f = await fixture({ providerId: null });
    const inspected = await inspectReservation({
      pool,
      reservationId: f.reservationId,
    });
    assert.equal(inspected.state, "uncertain");
    assert.equal(inspected.canCorrelate, false);
    await assert.rejects(
      reconcileReservation(f.options),
      (error) => error.code === "RECONCILIATION_MISSING_IDENTITY",
    );
    assert.equal(f.calls(), 0);
    assert.equal(
      (await inspectReservation({ pool, reservationId: f.reservationId }))
        .state,
      "uncertain",
    );
  },
);

test(
  "USD, missing, mismatched and incomplete provider records leave the full reservation outstanding",
  { skip: !pool },
  async () => {
    for (const change of [
      { currency: "USD" },
      { sku: "another-model-llm-output-mtoken" },
      { inferenceDetails: { requestId: "chatcmpl-unrelated" } },
      { amount: "0.000040" },
      { timestamp: "2000-01-01T00:00:00.000Z" },
      { sku: "model-a-llm-input-mtoken" },
    ]) {
      const f = await fixture();
      await assert.rejects(
        reconcileReservation({
          ...f.options,
          fetchImpl: async () =>
            Response.json({
              data: [{ ...f.row, ...change }],
              nextCursor: null,
            }),
        }),
      );
      assert.equal(
        (await inspectReservation({ pool, reservationId: f.reservationId }))
          .state,
        "uncertain",
      );
    }
  },
);

test(
  "provider charge above the admitted maximum suspends the project without clearing uncertainty",
  { skip: !pool },
  async () => {
    const f = await fixture({ amount: "-0.001" });
    await assert.rejects(
      reconcileReservation(f.options),
      (error) => error.code === "RECONCILIATION_BOUND_VIOLATION",
    );
    const {
      rows: [row],
    } = await pool.query(
      "SELECT p.status,b.status AS provider_status,u.state FROM projects p JOIN provider_bindings b ON b.project_id=p.id JOIN usage_reservations u ON u.project_id=p.id WHERE u.id=$1",
      [f.reservationId],
    );
    assert.equal(row.status, "suspended");
    assert.equal(row.provider_status, "pending");
    assert.equal(row.state, "uncertain");
  },
);

test(
  "provider request identities are immutable and cannot be reused by another project reservation",
  { skip: !pool },
  async () => {
    const f = await fixture({ providerId: null });
    const store = new GatewayStore(pool, { keyPepper: "test-only" });
    await store.noteProviderRequestId(f.reservationId, "chatcmpl-original");
    await store.noteProviderRequestId(f.reservationId, "chatcmpl-original");
    await assert.rejects(
      store.noteProviderRequestId(f.reservationId, "chatcmpl-rebound"),
    );
    await assert.rejects(
      store.noteProviderRequestId(
        f.reservationId,
        "chatcmpl-injected\nprivate",
      ),
    );
    const second = randomUUID();
    await pool.query(
      "INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,maximum_microusd,model,state) VALUES($1,$2,$3,'2000-01-01',100,'model-a','uncertain')",
      [second, f.projectId, f.keyId],
    );
    await assert.rejects(
      store.noteProviderRequestId(second, "chatcmpl-original"),
    );
  },
);

test(
  "bounded cursor pagination is complete before proof is accepted and concurrent retention is idempotent",
  { skip: !pool },
  async () => {
    const f = await fixture();
    let requests = 0;
    const options = {
      ...f.options,
      fetchImpl: async (url) => {
        requests++;
        const params = new URL(url).searchParams;
        if (!params.has("cursor")) {
          assert.equal(params.get("currency"), "DIEM");
          return Response.json({ data: [], nextCursor: "opaque-cursor-1" });
        }
        assert.equal([...params.keys()].join(), "cursor");
        return Response.json({ data: [f.row], nextCursor: null });
      },
    };
    const [a, b] = await Promise.all([
      reconcileReservation(options),
      reconcileReservation(options),
    ]);
    assert.deepEqual(a, b);
    assert.ok(requests >= 2);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM usage_reconciliations WHERE project_id=$1",
          [f.projectId],
        )
      ).rows[0].count,
      "1",
    );
  },
);

test(
  "sub-microdollar numeric DIEM charges round conservatively without losing positive proof",
  { skip: !pool },
  async () => {
    const f = await fixture({ amount: -4e-8 });
    assert.equal(
      (await reconcileReservation(f.options)).providerChargedMicrousd,
      "1",
    );
  },
);

test(
  "missing admin credentials and repeated cursor pages never clear a reservation",
  { skip: !pool },
  async () => {
    const f = await fixture();
    await assert.rejects(
      reconcileReservation({ ...f.options, adminKey: undefined }),
      (error) => error.code === "RECONCILIATION_ADMIN_KEY_REQUIRED",
    );
    assert.equal(f.calls(), 0);
    await assert.rejects(
      reconcileReservation({
        ...f.options,
        fetchImpl: async () =>
          Response.json({ data: [], nextCursor: "repeated" }),
      }),
      (error) => error.code === "RECONCILIATION_INVALID_CURSOR",
    );
    assert.equal(
      (await inspectReservation({ pool, reservationId: f.reservationId }))
        .state,
      "uncertain",
    );
  },
);

test(
  "rejected provider responses are canceled without exposing provider bodies or changing capacity",
  { skip: !pool },
  async () => {
    const f = await fixture();
    let canceled = false;
    await assert.rejects(
      reconcileReservation({
        ...f.options,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                canceled = true;
              },
            }),
            { status: 401 },
          ),
      }),
    );
    assert.equal(canceled, true);
    assert.equal(
      (await inspectReservation({ pool, reservationId: f.reservationId }))
        .state,
      "uncertain",
    );
  },
);

test(
  "an uncertain orphan without provider identity can only be retained at full maximum, in both epochs, once",
  { skip: !pool },
  async () => {
    const f = await fixture({ providerId: null });
    await pool.query("UPDATE usage_reservations SET dispatched_at=created_at WHERE id=$1", [f.reservationId]);
    const inspected = await inspectReservation({ pool, reservationId: f.reservationId });
    assert.equal(inspected.canCorrelate, false);
    assert.ok(inspected.dispatchedAt);
    const evidence = await retainUnprovenReservation({ pool, reservationId: f.reservationId });
    assert.equal(evidence.source, "operator-attestation");
    assert.equal(evidence.retainedMicrousd, "100");
    assert.equal(evidence.originalEpoch, f.createdAt.toISOString().slice(0, 10));
    const { rows } = await pool.query(
      "SELECT * FROM usage_reservations WHERE project_id=$1 ORDER BY created_at",
      [f.projectId],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => [r.state, r.charged_microusd]), [["settled", "100"], ["settled", "100"]]);
    assert.equal(rows[1].provider_epoch, new Date().toISOString().slice(0, 10));
    assert.deepEqual(await retainUnprovenReservation({ pool, reservationId: f.reservationId }), evidence);
    assert.equal(rows.length, (await pool.query("SELECT 1 FROM usage_reservations WHERE project_id=$1", [f.projectId])).rowCount);
    const audits = await pool.query("SELECT kind FROM audit_events WHERE project_id=$1", [f.projectId]);
    assert.deepEqual(audits.rows.map((r) => r.kind), ["usage.retained_unproven"]);
  },
);

test(
  "unproven retention refuses live, final and correlatable reservations",
  { skip: !pool },
  async () => {
    const live = await fixture({ providerId: null });
    await pool.query("UPDATE usage_reservations SET state='reserved' WHERE id=$1", [live.reservationId]);
    await assert.rejects(retainUnprovenReservation({ pool, reservationId: live.reservationId }), (e) => e.code === "RECONCILIATION_STILL_RESERVED");
    const final = await fixture({ providerId: null });
    await pool.query("UPDATE usage_reservations SET state='released' WHERE id=$1", [final.reservationId]);
    await assert.rejects(retainUnprovenReservation({ pool, reservationId: final.reservationId }), (e) => e.code === "RECONCILIATION_ALREADY_FINAL");
    const provable = await fixture();
    await assert.rejects(retainUnprovenReservation({ pool, reservationId: provable.reservationId }), (e) => e.code === "RECONCILIATION_PROOF_AVAILABLE");
    for (const id of [live.reservationId, final.reservationId, provable.reservationId]) {
      const { rows } = await pool.query("SELECT charged_microusd FROM usage_reservations WHERE id=$1", [id]);
      assert.equal(rows[0].charged_microusd, null);
    }
  },
);
