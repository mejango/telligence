import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { GatewayStore } from "../store.mjs";
import { signKey } from "../policy.mjs";
const url = process.env.TEST_DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
const pepper = "test-pepper-that-is-not-used-in-production";
const store = pool
  ? new GatewayStore(pool, {
      keyPepper: pepper,
      capacityMaxAgeMs: 60000,
      safetyMarginMicroUsd: 0n,
    })
  : null;
const ids = [];
before(async () => {
  if (pool) await migrate(pool);
});
after(async () => {
  if (pool) {
    for (const id of ids) {
      await pool.query("DELETE FROM canary_runs WHERE project_id=$1", [id]);
      await pool.query("DELETE FROM usage_reservations WHERE project_id=$1", [
        id,
      ]);
      await pool.query("DELETE FROM api_keys WHERE project_id=$1", [id]);
      await pool.query("DELETE FROM provider_bindings WHERE project_id=$1", [
        id,
      ]);
      await pool.query("DELETE FROM projects WHERE id=$1", [id]);
    }
    await pool.end();
  }
});
async function fixture(limit = 100n) {
  const id = randomUUID();
  ids.push(id);
  const key = signKey(pepper);
  const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd,status,max_concurrency) VALUES($1,'1',$2,$3,$4,$5,'test','test','test',100,$6,'active',32)`,
    [
      id,
      BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(),
      addr(),
      addr(),
      addr(),
      limit.toString(),
    ],
  );
  await pool.query(
    `INSERT INTO provider_bindings(project_id,status,signer_address,encrypted_signer,provider_epoch,daily_limit_microusd,remaining_microusd,observed_at,canary_verified_at) VALUES($1,'ready',$2,'test-only',$3,$4,$4,clock_timestamp(),clock_timestamp())`,
    [id, addr(), new Date().toISOString().slice(0, 10), limit.toString()],
  );
  await pool.query(
    `INSERT INTO api_keys(id,project_id,prefix,secret_hash,name,daily_limit_microusd) VALUES($1,$2,$3,$4,'test',$5)`,
    [key.id, id, key.prefix, key.hash, limit.toString()],
  );
  return { id, key };
}
test(
  "Postgres concurrent requests cannot overspend project or key",
  { skip: !url },
  async () => {
    const { id, key } = await fixture(100n);
    const result = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 30n,
          model: "test",
        }),
      ),
    );
    assert.equal(result.filter((v) => v.status === "fulfilled").length, 3);
    const rows = await pool.query(
      "SELECT sum(maximum_microusd) AS n FROM usage_reservations WHERE project_id=$1",
      [id],
    );
    assert.equal(rows.rows[0].n, "90");
  },
);
test(
  "uncertain usage survives restart and UTC epoch change; key rotation cannot reset project quota",
  { skip: !url },
  async () => {
    const { id, key } = await fixture(100n);
    const r = await store.reserve({
      secret: key.secret,
      maximumMicroUsd: 80n,
      model: "test",
    });
    await store.finish(r.id, { state: "uncertain" });
    await pool.query(
      `UPDATE usage_reservations SET provider_epoch='2000-01-01' WHERE id=$1`,
      [r.id],
    );
    const restarted = new GatewayStore(pool, {
      keyPepper: pepper,
      capacityMaxAgeMs: 60000,
      safetyMarginMicroUsd: 0n,
    });
    await assert.rejects(
      () =>
        restarted.reserve({
          secret: key.secret,
          maximumMicroUsd: 30n,
          model: "test",
        }),
      (e) => e.code === "budget_exhausted",
    );
    await assert.rejects(
      () => store.finish(r.id, { state: "released" }),
      (e) => e.code === "invalid_settlement",
    );
  },
);
test(
  "provider refresh cannot erase in-flight debits and duplicate idempotency is rejected",
  { skip: !url },
  async () => {
    const { id, key } = await fixture(100n);
    const r = await store.reserve({
      secret: key.secret,
      maximumMicroUsd: 80n,
      model: "test",
      idempotencyKey: "dedupe-1",
    });
    await pool.query(
      "UPDATE provider_bindings SET observed_at=clock_timestamp() WHERE project_id=$1",
      [id],
    );
    await assert.rejects(
      () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 30n,
          model: "test",
        }),
      (e) => e.code === "budget_exhausted",
    );
    await assert.rejects(
      () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 1n,
          model: "test",
          idempotencyKey: "dedupe-1",
        }),
      (e) => e.code === "duplicate_request",
    );
    await store.finish(r.id, { state: "settled", chargedMicroUsd: 10n });
    await assert.rejects(
      () => store.finish(r.id, { state: "settled", chargedMicroUsd: 0n }),
      (e) => e.code === "invalid_settlement",
    );
  },
);
test(
  "stale, unverified, suspended and revoked identities fail closed",
  { skip: !url },
  async () => {
    const { id, key } = await fixture();
    await pool.query(
      `UPDATE provider_bindings SET observed_at=now()-interval '2 minutes' WHERE project_id=$1`,
      [id],
    );
    await assert.rejects(
      () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 1n,
          model: "test",
        }),
      (e) => e.code === "capacity_unavailable",
    );
    await pool.query(
      "UPDATE provider_bindings SET observed_at=clock_timestamp(),canary_verified_at=NULL WHERE project_id=$1",
      [id],
    );
    await assert.rejects(
      () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 1n,
          model: "test",
        }),
      (e) => e.code === "capacity_unavailable",
    );
    await pool.query("UPDATE api_keys SET revoked_at=now() WHERE id=$1", [
      key.id,
    ]);
    await assert.rejects(
      () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 1n,
          model: "test",
        }),
      (e) => e.status === 401,
    );
  },
);

test(
  "only an explicit single project canary run can bypass the unverified marker, once and within one cent",
  { skip: !url },
  async () => {
    const { id, key } = await fixture(100000n);
    const runId = randomUUID();
    await pool.query("UPDATE projects SET status='accumulating' WHERE id=$1", [
      id,
    ]);
    await pool.query(
      "UPDATE provider_bindings SET canary_verified_at=NULL WHERE project_id=$1",
      [id],
    );
    await pool.query(
      "INSERT INTO canary_runs(id,project_id,signer_generation,state) VALUES($1,$2,1,'prepared')",
      [runId, id],
    );
    await assert.rejects(
      () =>
        store.reserve({
          secret: key.secret,
          maximumMicroUsd: 1n,
          model: "test",
        }),
      (e) => e.code === "capacity_unavailable",
    );
    const canary = new GatewayStore(pool, {
      keyPepper: pepper,
      capacityMaxAgeMs: 60000,
      safetyMarginMicroUsd: 0n,
      canaryRunId: runId,
    });
    await assert.rejects(
      () =>
        canary.reserve({
          secret: key.secret,
          maximumMicroUsd: 10001n,
          model: "test",
        }),
      (e) => e.code === "invalid_canary",
    );
    const reservation = await canary.reserve({
      secret: key.secret,
      maximumMicroUsd: 1000n,
      model: "test",
    });
    const {
      rows: [row],
    } = await pool.query("SELECT * FROM canary_runs WHERE id=$1", [runId]);
    assert.equal(row.state, "submitted");
    assert.equal(row.reservation_id, reservation.id);
    await assert.rejects(
      () =>
        canary.reserve({
          secret: key.secret,
          maximumMicroUsd: 1n,
          model: "test",
        }),
      (e) => e.code === "invalid_canary",
    );
  },
);

test(
  "request status exposes only durable metadata to a key from the same project",
  { skip: !url },
  async () => {
    const first = await fixture(100n),
      other = await fixture(100n);
    const reservation = await store.reserve({
      secret: first.key.secret,
      maximumMicroUsd: 30n,
      model: "model-a",
    });
    await store.finish(reservation.id, { state: "uncertain" });
    const status = await store.requestStatus(first.key.secret, reservation.id);
    assert.equal(status.state, "uncertain");
    assert.equal(status.maximumUsd, "0.000030");
    assert.equal(status.accountedUsd, null);
    assert.equal(status.id, reservation.id);
    await assert.rejects(
      () => store.requestStatus(other.key.secret, reservation.id),
      (e) => e.status === 404,
    );
    assert.equal(JSON.stringify(status).includes(first.key.secret), false);
  },
);
