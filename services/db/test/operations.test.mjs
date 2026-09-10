import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { migrate } from "../migrate.mjs";
import { ensureRoles, ROLES } from "../roles.mjs";
import { checkRestore, ledgerCheckpoint } from "../restore-check.mjs";
import { rotateEncryptedSigners } from "../../auth-signer/rotate-encryption-key.mjs";
import { encryptSignerKey, decryptSignerKey } from "../../auth-signer/crypto.mjs";
import { createPostgresSignerStore } from "../../auth-signer/server.mjs";
import { GatewayStore } from "../../gateway/store.mjs";
import { signKey } from "../../gateway/policy.mjs";
import { PostgresWorkerStore } from "../../control-worker/postgres.mjs";

const url = process.env.TEST_DATABASE_URL;
const owner = url ? new pg.Pool({ connectionString: url }) : null;
// Rotation and restore checks scan whole tables, so they get a private schema.
const schema = `operations_test_${randomUUID().replaceAll("-", "")}`;
const isolated = url ? new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 6 }) : null;
const pepper = "test-pepper-that-is-not-used-in-production";
const passwords = Object.fromEntries(ROLES.map((role) => [role, randomBytes(24).toString("hex")]));
const pools = {};
const ids = [];
const addr = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;

before(async () => {
  if (!owner) return;
  await owner.query(`CREATE SCHEMA ${schema}`);
  await migrate(isolated);
  await migrate(owner);
  await ensureRoles(owner, passwords);
  await ensureRoles(owner, passwords); // idempotent
  const base = new URL(url);
  for (const role of ROLES) {
    const connection = new URL(url);
    connection.username = role;
    connection.password = passwords[role];
    pools[role] = new pg.Pool({ connectionString: connection.toString(), max: 3 });
  }
  assert.ok(base);
});
after(async () => {
  if (!owner) return;
  for (const pool of Object.values(pools)) await pool.end();
  for (const id of ids) {
    await owner.query("DELETE FROM audit_events WHERE project_id=$1", [id]);
    await owner.query("DELETE FROM worker_capacity_evidence WHERE project_id=$1", [id]);
    await owner.query("DELETE FROM worker_project_checks WHERE project_id=$1", [id]);
    await owner.query("DELETE FROM usage_reservations WHERE project_id=$1", [id]);
    await owner.query("DELETE FROM api_keys WHERE project_id=$1", [id]);
    await owner.query("DELETE FROM provider_bindings WHERE project_id=$1", [id]);
    await owner.query("DELETE FROM projects WHERE id=$1", [id]);
  }
  await isolated.end();
  await owner.query(`DROP SCHEMA ${schema} CASCADE`);
  await owner.end();
});

async function project({ key = signKey(pepper), encryptionKey, privateKey, pool = owner } = {}) {
  const id = randomUUID();
  if (pool === owner) ids.push(id);
  const signer = privateKey ? privateKeyToAccount(privateKey).address.toLowerCase() : addr();
  await pool.query(
    `INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,daily_limit_microusd,status,max_concurrency) VALUES($1,'1',$2,$3,$4,$5,'t','t','t',1000,'active',4)`,
    [id, BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(), addr(), addr(), addr()],
  );
  await pool.query(
    `INSERT INTO provider_bindings(project_id,status,signer_address,encrypted_signer,provider_epoch,daily_limit_microusd,remaining_microusd,observed_at,canary_verified_at) VALUES($1,'ready',$2,$3,$4,1000,1000,clock_timestamp(),clock_timestamp())`,
    [id, signer, privateKey ? encryptSignerKey(privateKey, encryptionKey, signer) : "test-only", new Date().toISOString().slice(0, 10)],
  );
  await pool.query(
    `INSERT INTO api_keys(id,project_id,prefix,secret_hash,name,daily_limit_microusd) VALUES($1,$2,$3,$4,'t',1000)`,
    [key.id, id, key.prefix, key.hash],
  );
  return { id, key, signer };
}
const denied = (promise, label) => assert.rejects(promise, (e) => e.code === "42501", `expected permission denied: ${label}`);

test("each service role can run its own code paths and nothing else", { skip: !url }, async () => {
  const { id, key, signer } = await project();
  // Gateway: reservation lifecycle through the real store.
  const gateway = new GatewayStore(pools.telligence_gateway, { keyPepper: pepper, safetyMarginMicroUsd: 0n });
  const reservation = await gateway.reserve({ secret: key.secret, maximumMicroUsd: 10n, model: "m" });
  await gateway.markDispatched(reservation.id);
  await gateway.finish(reservation.id, { state: "settled", chargedMicroUsd: 5n });
  await denied(pools.telligence_gateway.query("SELECT * FROM worker_tx_intents"), "SELECT * FROM worker_tx_intents");
  await denied(pools.telligence_gateway.query("DELETE FROM usage_reservations WHERE id=$1", [reservation.id]), "DELETE FROM usage_reservations WHERE id=$1");
  await denied(pools.telligence_gateway.query("UPDATE signer_preparations SET encrypted_signer='x' WHERE id=$1", [randomUUID()]), "UPDATE signer_preparations SET encrypted_signer='x' WHERE id=$1");
  // Signer: bindings and reservation state through the real store, nothing about keys or sessions.
  const signerStore = createPostgresSignerStore(pools.telligence_signer);
  assert.equal((await signerStore.loadSignerBinding(id)).signer_address, signer);
  assert.equal((await signerStore.loadReservation(id, reservation.id)).state, "settled");
  await denied(pools.telligence_signer.query("SELECT secret_hash FROM api_keys"), "SELECT secret_hash FROM api_keys");
  await denied(pools.telligence_signer.query("SELECT * FROM creator_sessions"), "SELECT * FROM creator_sessions");
  await denied(pools.telligence_signer.query("SELECT maximum_microusd FROM usage_reservations"), "SELECT maximum_microusd FROM usage_reservations");
  await denied(pools.telligence_signer.query("UPDATE provider_bindings SET status='disabled' WHERE project_id=$1", [id]), "UPDATE provider_bindings SET status='disabled' WHERE project_id=$1");
  await denied(pools.telligence_signer.query("INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,maximum_microusd,model) VALUES($1,$2,$3,'2026-01-01',1,'m')", [randomUUID(), id, key.id]), "INSERT INTO usage_reservations(id,project_id,key_id,provider_epoch,maximum_microusd,model) VALUES($1,$2,$3,'2026-01-01',1,'m')");
  // Worker: capacity observation and reconciliation through the real store, never key material.
  const worker = new PostgresWorkerStore(pools.telligence_worker);
  const evidence = { signerAddress: signer, signerGeneration: 1, authenticationEnabled: true, vaultState: 0, stakedDiem: 10n ** 18n };
  assert.equal(await worker.reconcileProjectState(id, evidence), true);
  await worker.markCapacityUnavailable(id);
  assert.equal(await worker.updateProviderCapacity(id, { status: "ready", providerEpoch: new Date().toISOString().slice(0, 10), dailyLimitMicrousd: "1000", remainingMicrousd: "900", observedAt: new Date().toISOString(), chainBlock: "1", chainBlockHash: `0x${"1".repeat(64)}`, ...evidence }), true);
  assert.equal((await worker.getProject(id)).id, id);
  await denied(pools.telligence_worker.query("SELECT encrypted_signer FROM provider_bindings WHERE project_id=$1", [id]), "SELECT encrypted_signer FROM provider_bindings WHERE project_id=$1");
  await denied(pools.telligence_worker.query("SELECT * FROM api_keys"), "SELECT * FROM api_keys");
  await denied(pools.telligence_worker.query("SELECT * FROM usage_reservations"), "SELECT * FROM usage_reservations");
  await denied(pools.telligence_worker.query("UPDATE projects SET creator_address=$2 WHERE id=$1", [id, addr()]), "UPDATE projects SET creator_address=$2 WHERE id=$1");
  await denied(pools.telligence_worker.query("UPDATE provider_bindings SET signer_address=$2 WHERE project_id=$1", [id, addr()]), "UPDATE provider_bindings SET signer_address=$2 WHERE project_id=$1");
  await denied(pools.telligence_worker.query("DELETE FROM worker_jobs"), "DELETE FROM worker_jobs");
  for (const [role, pool] of Object.entries(pools)) await denied(pool.query("CREATE TABLE should_not_exist(id int)"), `${role} CREATE TABLE`);
});

test("encryption key rotation re-encrypts only rows the new key cannot read and refuses undecryptable ones", { skip: !url }, async () => {
  const previousKey = randomBytes(32).toString("base64");
  const currentKey = randomBytes(32).toString("base64");
  const owner = isolated;
  const old = await project({ encryptionKey: previousKey, privateKey: `0x${"11".repeat(32)}`, pool: owner });
  const fresh = await project({ encryptionKey: currentKey, privateKey: `0x${"22".repeat(32)}`, pool: owner });
  const check = await rotateEncryptedSigners({ pool: owner, currentKey, previousKey, write: false });
  assert.equal(check.rotated, 1);
  assert.ok(check.current >= 1);
  let stored = (await owner.query("SELECT encrypted_signer FROM provider_bindings WHERE project_id=$1", [old.id])).rows[0].encrypted_signer;
  assert.throws(() => decryptSignerKey(stored, currentKey, old.signer), "check mode must not write");
  assert.equal(decryptSignerKey(stored, currentKey, old.signer, previousKey), `0x${"11".repeat(32)}`, "the signer can still read with the previous key");
  const rotated = await rotateEncryptedSigners({ pool: owner, currentKey, previousKey, write: true });
  assert.equal(rotated.rotated, 1);
  stored = (await owner.query("SELECT encrypted_signer FROM provider_bindings WHERE project_id=$1", [old.id])).rows[0].encrypted_signer;
  assert.equal(decryptSignerKey(stored, currentKey, old.signer), `0x${"11".repeat(32)}`);
  assert.equal(decryptSignerKey((await owner.query("SELECT encrypted_signer FROM provider_bindings WHERE project_id=$1", [fresh.id])).rows[0].encrypted_signer, currentKey, fresh.signer), `0x${"22".repeat(32)}`);
  assert.equal((await rotateEncryptedSigners({ pool: owner, currentKey, previousKey, write: true })).rotated, 0);
  // A row neither key can read aborts the whole rotation without partial writes.
  const lost = await project({ encryptionKey: randomBytes(32).toString("base64"), privateKey: `0x${"33".repeat(32)}`, pool: owner });
  const stale = await project({ encryptionKey: previousKey, privateKey: `0x${"44".repeat(32)}`, pool: owner });
  await assert.rejects(rotateEncryptedSigners({ pool: owner, currentKey, previousKey, write: true }), (e) => e.code === "ROTATION_INCOMPLETE" && e.report.undecryptable === 1);
  const staleRow = (await owner.query("SELECT encrypted_signer FROM provider_bindings WHERE project_id=$1", [stale.id])).rows[0].encrypted_signer;
  assert.throws(() => decryptSignerKey(staleRow, currentKey, stale.signer));
  await owner.query("DELETE FROM provider_bindings WHERE project_id=$1", [lost.id]);
});

test("restore check reports outstanding liabilities, checkpoint drift and unverifiable keeper intents", { skip: !url }, async () => {
  const owner = isolated;
  const { id, key } = await project({ pool: owner });
  const before = await ledgerCheckpoint(owner);
  assert.match(before, /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z:\d+$/);
  const gateway = new GatewayStore(owner, { keyPepper: pepper, safetyMarginMicroUsd: 0n });
  const r = await gateway.reserve({ secret: key.secret, maximumMicroUsd: 7n, model: "m" });
  const report = await checkRestore({ pool: owner, checkpoint: before });
  assert.equal(report.ledger.checkpointOk, true);
  assert.ok(report.problems.includes("RESERVED_ROWS_AWAIT_GATEWAY_RECOVERY"));
  await gateway.finish(r.id, { state: "uncertain" });
  const time = before.slice(0, before.lastIndexOf(":")), count = before.slice(before.lastIndexOf(":") + 1);
  const drifted = await checkRestore({ pool: owner, checkpoint: `${time}:${Number(count) + 5}` });
  assert.equal(drifted.ledger.checkpointOk, false);
  assert.ok(drifted.problems.includes("LEDGER_BEHIND_CHECKPOINT"));
  assert.ok(drifted.ledger.uncertainWithoutIdentity >= 1);
  // Keeper intent whose nonce the chain consumed without a receipt must be surfaced.
  const worker = new PostgresWorkerStore(owner);
  const job = await worker.enqueue({ projectId: id, operationKey: `restore-${id}`, operation: "return_liquid_vvv", payload: {} });
  const claimed = await worker.claim("restore-test");
  assert.equal(claimed.id, job.id);
  await worker.withKeeperLease(`0x${"a".repeat(40)}`, async (client) => worker.saveIntent(claimed, { keeperAddress: `0x${"a".repeat(40)}`, nonce: 3, hash: `0x${randomBytes(32).toString("hex")}`, rawTransaction: "0x01", targetAddress: `0x${"b".repeat(40)}`, calldata: "0x00", preconditions: {} }, client));
  await worker.release(claimed);
  const unverified = await checkRestore({ pool: owner });
  assert.ok(unverified.problems.includes("KEEPER_INTENTS_UNVERIFIED_WITHOUT_RPC"));
  const consumed = await checkRestore({ pool: owner, rpc: { getReceipt: async () => null, getLatestNonce: async () => 4 } });
  assert.ok(consumed.problems.some((p) => p === `INTENT_NONCE_CONSUMED_WITHOUT_RECEIPT:${job.id}`));
  const pending = await checkRestore({ pool: owner, rpc: { getReceipt: async () => null, getLatestNonce: async () => 3 } });
  assert.equal(pending.problems.some((p) => p.startsWith("INTENT_NONCE_CONSUMED")), false);
  await owner.query("DELETE FROM worker_tx_intents WHERE job_id=$1", [job.id]);
  await owner.query("DELETE FROM worker_jobs WHERE id=$1", [job.id]);
  await owner.query("DELETE FROM worker_project_leases WHERE project_id=$1", [id]);
});
