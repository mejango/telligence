import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { GatewayStore } from "../store.mjs";
import { signKey } from "../policy.mjs";

const url = process.env.TEST_DATABASE_URL;
// Recovery scans every reservation, so this suite owns a private schema.
const schema = `lifecycle_test_${randomUUID().replaceAll("-", "")}`;
const bootstrap = url ? new pg.Pool({ connectionString: url }) : null;
const pool = url ? new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 }) : null;
const pepper = "test-pepper-that-is-not-used-in-production";
const options = { keyPepper: pepper, capacityMaxAgeMs: 30000, capacityGraceMs: 180000, safetyMarginMicroUsd: 0n };
const ids = [];
const instances = [];
before(async () => {
  if (!pool) return;
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});
after(async () => {
  if (!pool) return;
  await pool.end();
  await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);
  await bootstrap.end();
});
const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
async function fixture({ limit = 100n, concurrency = 4, observedAgoMs = 0, epoch } = {}) {
  const id = randomUUID();
  ids.push(id);
  const key = signKey(pepper);
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,daily_limit_microusd,status,max_concurrency) VALUES($1,'1',$2,$3,$4,$5,'t','t','t',$6,'active',$7)`,
    [id, BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(), addr(), addr(), addr(), limit.toString(), concurrency],
  );
  await pool.query(
    `INSERT INTO provider_bindings(project_id,status,signer_address,encrypted_signer,provider_epoch,daily_limit_microusd,remaining_microusd,observed_at,canary_verified_at) VALUES($1,'ready',$2,'test-only',$3,$4,$4,clock_timestamp()-($5||' milliseconds')::interval,clock_timestamp())`,
    [id, addr(), epoch ?? new Date().toISOString().slice(0, 10), limit.toString(), String(observedAgoMs)],
  );
  await pool.query(
    `INSERT INTO api_keys(id,project_id,prefix,secret_hash,name,daily_limit_microusd) VALUES($1,$2,$3,$4,'t',$5)`,
    [key.id, id, key.prefix, key.hash, limit.toString()],
  );
  return { id, key };
}
function storeFor(instanceId = randomUUID()) {
  instances.push(instanceId);
  return new GatewayStore(pool, { ...options, instanceId });
}
async function states(projectId) {
  const { rows } = await pool.query("SELECT id,state,dispatched_at FROM usage_reservations WHERE project_id=$1 ORDER BY created_at", [projectId]);
  return rows;
}
async function audits(projectId) {
  const { rows } = await pool.query("SELECT kind,object_id FROM audit_events WHERE project_id=$1 ORDER BY id", [projectId]);
  return rows;
}

test("dispatch is a durable one-time marker owned by the reserving instance", { skip: !url }, async () => {
  const { key } = await fixture();
  const store = storeFor();
  const other = storeFor();
  await store.heartbeat();
  const reservation = await store.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  await assert.rejects(other.markDispatched(reservation.id), (e) => e.code === "reservation_not_owned");
  await store.markDispatched(reservation.id);
  await assert.rejects(store.markDispatched(reservation.id), (e) => e.code === "reservation_not_owned");
  const [row] = await states(reservation.projectId);
  assert.ok(row.dispatched_at);
  await store.finish(reservation.id, { state: "settled", chargedMicroUsd: 5n });
});

test("recovery releases only reservations proven undispatched and holds every other orphan as uncertain", { skip: !url }, async () => {
  const { id, key } = await fixture({ limit: 1000n, concurrency: 8 });
  const dead = storeFor();
  await dead.heartbeat();
  const undispatched = await dead.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  const dispatched = await dead.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  await dead.markDispatched(dispatched.id);
  await dead.stop();
  const live = storeFor();
  await live.heartbeat();
  const inflight = await live.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  // A row written before this lifecycle existed cannot prove it was never dispatched.
  const legacyId = randomUUID();
  await pool.query(
    "INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,maximum_microusd,model) VALUES($1,$2,$3,$4,10,'m')",
    [legacyId, id, key.id, new Date().toISOString().slice(0, 10)],
  );
  // A crashed instance never writes stopped_at; its stale heartbeat is the evidence.
  const crashed = storeFor();
  await crashed.heartbeat();
  const crashedRow = await crashed.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  await pool.query("UPDATE gateway_instances SET heartbeat_at=clock_timestamp()-interval '10 minutes' WHERE id=$1", [crashed.instanceId]);

  const result = await live.recoverOrphans({ staleAfterMs: 60000 });
  assert.deepEqual(result, { released: 2, uncertain: 2 });
  const byId = Object.fromEntries((await states(id)).map((r) => [r.id, r.state]));
  assert.equal(byId[undispatched.id], "released");
  assert.equal(byId[dispatched.id], "uncertain");
  assert.equal(byId[inflight.id], "reserved");
  assert.equal(byId[legacyId], "uncertain");
  assert.equal(byId[crashedRow.id], "released");
  const kinds = (await audits(id)).map((a) => a.kind).sort();
  assert.deepEqual(kinds, ["usage.recovered_uncertain", "usage.recovered_uncertain", "usage.recovered_undispatched", "usage.recovered_undispatched"]);
  // Repeating recovery is idempotent.
  assert.deepEqual(await live.recoverOrphans({ staleAfterMs: 60000 }), { released: 0, uncertain: 0 });
  await live.finish(inflight.id, { state: "released" });
});

test("recovered orphans free concurrency, released ones free budget, uncertain ones keep charging", { skip: !url }, async () => {
  const { id, key } = await fixture({ limit: 100n, concurrency: 4 });
  const dead = storeFor();
  await dead.heartbeat();
  for (let i = 0; i < 3; i++) await dead.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  const paid = await dead.reserve({ secret: key.secret, maximumMicroUsd: 40n, model: "m" });
  await dead.markDispatched(paid.id);
  await dead.stop();
  const live = storeFor();
  await live.heartbeat();
  await assert.rejects(live.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" }), (e) => e.code === "concurrency_limit");
  assert.deepEqual(await live.recoverOrphans({ staleAfterMs: 60000 }), { released: 3, uncertain: 1 });
  // 100 limit - 40 uncertain = 60 available; 70 must fail, 60 must pass.
  await assert.rejects(live.reserve({ secret: key.secret, maximumMicroUsd: 70n, model: "m" }), (e) => e.code === "budget_exhausted");
  const ok = await live.reserve({ secret: key.secret, maximumMicroUsd: 60n, model: "m" });
  await live.finish(ok.id, { state: "released" });
  assert.equal((await states(id)).filter((r) => r.state === "reserved").length, 0);
});

test("concurrent recovery transitions each orphan exactly once", { skip: !url }, async () => {
  const { id, key } = await fixture({ limit: 1000n, concurrency: 16 });
  const dead = storeFor();
  await dead.heartbeat();
  for (let i = 0; i < 6; i++) await dead.reserve({ secret: key.secret, maximumMicroUsd: 1n, model: "m" });
  await dead.stop();
  const a = storeFor(), b = storeFor();
  const results = await Promise.all([a.recoverOrphans({ staleAfterMs: 60000 }), b.recoverOrphans({ staleAfterMs: 60000 })]);
  assert.equal(results.reduce((n, r) => n + r.released + r.uncertain, 0), 6);
  assert.equal((await audits(id)).length, 6);
});

test("a duplicate idempotency key after recovery is still refused, and yesterday's orphans respect UTC rollover", { skip: !url }, async () => {
  const { id, key } = await fixture({ limit: 100n, concurrency: 8 });
  const dead = storeFor();
  await dead.heartbeat();
  const first = await dead.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m", idempotencyKey: "same" });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const released = await dead.reserve({ secret: key.secret, maximumMicroUsd: 60n, model: "m" });
  const held = await dead.reserve({ secret: key.secret, maximumMicroUsd: 30n, model: "m" });
  await dead.markDispatched(held.id);
  await pool.query("UPDATE usage_reservations SET provider_epoch=$2 WHERE id=ANY($1::uuid[])", [[released.id, held.id], yesterday]);
  await dead.stop();
  const live = storeFor();
  await live.heartbeat();
  assert.deepEqual(await live.recoverOrphans({ staleAfterMs: 60000 }), { released: 2, uncertain: 1 });
  await assert.rejects(live.reserve({ secret: key.secret, maximumMicroUsd: 1n, model: "m", idempotencyKey: "same" }), (e) => e.code === "duplicate_request");
  // Today: 100 - 30 (yesterday's uncertain still held) = 70. The released 60 from yesterday is gone.
  await assert.rejects(live.reserve({ secret: key.secret, maximumMicroUsd: 71n, model: "m" }), (e) => e.code === "budget_exhausted");
  const ok = await live.reserve({ secret: key.secret, maximumMicroUsd: 70n, model: "m" });
  await live.finish(ok.id, { state: "released" });
  assert.equal(first.id.length, 36);
  assert.equal((await states(id)).length, 4);
});

test("an aging observation admits requests within the grace window, never across epochs or beyond it", { skip: !url }, async () => {
  const fresh = storeFor();
  const aging = await fixture({ observedAgoMs: 100000 });
  const r = await fresh.reserve({ secret: aging.key.secret, maximumMicroUsd: 1n, model: "m" });
  await fresh.finish(r.id, { state: "released" });
  const [snapshot] = await fresh.projects(aging.id);
  assert.equal(snapshot.capacity.status, "ready");
  assert.equal(snapshot.capacity.freshness, "aging");
  const expired = await fixture({ observedAgoMs: 200000 });
  await assert.rejects(fresh.reserve({ secret: expired.key.secret, maximumMicroUsd: 1n, model: "m" }), (e) => e.code === "capacity_unavailable");
  assert.equal((await fresh.projects(expired.id))[0].capacity.status, "stale");
  const yesterday = await fixture({ observedAgoMs: 1000, epoch: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
  await assert.rejects(fresh.reserve({ secret: yesterday.key.secret, maximumMicroUsd: 1n, model: "m" }), (e) => e.code === "capacity_unavailable");
});

test("a ledger that contradicts the operator checkpoint refuses new reservations", { skip: !url }, async () => {
  const { key } = await fixture();
  const store = storeFor();
  const { rows: [{ n }] } = await pool.query("SELECT count(*) AS n FROM usage_reservations WHERE created_at<=clock_timestamp()");
  const now = new Date().toISOString();
  assert.equal(await store.verifyLedgerCheckpoint(`${now}:${Number(n) + 1}`), false);
  await assert.rejects(store.reserve({ secret: key.secret, maximumMicroUsd: 1n, model: "m" }), (e) => e.code === "ledger_untrusted");
  assert.equal(await store.verifyLedgerCheckpoint(`${now}:${n}`), true);
  const r = await store.reserve({ secret: key.secret, maximumMicroUsd: 1n, model: "m" });
  await store.finish(r.id, { state: "released" });
});
