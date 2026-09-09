import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PostgresWorkerStore } from '../postgres.mjs';
import { WORKER_MIGRATION_SQL } from '../schema.mjs';
import { start } from '../server.mjs';

const connectionString = process.env.TEST_DATABASE_URL;
const address = () => `0x${randomBytes(20).toString('hex')}`;

test('PostgreSQL persists leases, fenced intents, nonce serialization, operation deduplication and reorg isolation', { skip: !connectionString }, async () => {
  const step = async (_name, fn) => fn();
  const schema = `worker_test_${randomBytes(8).toString('hex')}`;
  const bootstrap = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString, max: 12, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
  const store = new PostgresWorkerStore(pool);
  const projectId = randomUUID();
  const otherId = randomUUID();
  const keeper = address();
  const bind = async id => {
    await pool.query(`INSERT INTO projects(id,policy_version,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd)
      VALUES($1,'1',$2,$3,$4,$5,'Worker test','Worker safety fixture','fixture',1000000,1000000)`, [id, BigInt(`0x${randomBytes(16).toString('hex')}`).toString(), address(), address(), address()]);
    await pool.query("INSERT INTO provider_bindings(project_id,signer_address,encrypted_signer) VALUES($1,$2,'fixture-encrypted')", [id, address()]);
  };
  try {
    await pool.query(await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
    await pool.query(WORKER_MIGRATION_SQL);
    await bind(projectId); await bind(otherId);
    const proposal = { projectId, operationKey: 'durable-job', operation: 'begin_diem_unstake', payload: {} };
    await step('concurrent enqueue returns one stable job, different action under same identity fails', async () => {
      const jobs = await Promise.all(Array.from({ length: 12 }, () => store.enqueue(proposal)));
      assert.equal(new Set(jobs.map(job => job.id)).size, 1, JSON.stringify(jobs.map(job => ({id:job.id,projectId:job.project_id}))));
      await assert.rejects(store.enqueue({ ...proposal, operation: 'claim_vvv_return' }), error => error.code === 'OPERATION_KEY_CONFLICT');
    });
    let first;
    await step('only one worker obtains the project lease', async () => {
      const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => store.claim(`worker-${index}`)));
      const matching = claims.filter(job => job?.project_id === projectId);
      assert.equal(matching.length, 1);
      first = matching[0];
    });
    let second;
    await step('lease takeover increments fence and rejects writes from old owner', async () => {
      await pool.query("UPDATE worker_project_leases SET lease_until=clock_timestamp()-interval '1 second' WHERE project_id=$1", [projectId]);
      second = await store.claim('replacement-worker');
      assert.ok(BigInt(second.fence) > BigInt(first.fence));
      await assert.rejects(store.update(first, { state: 'finalized' }), error => error.code === 'LEASE_LOST');
      await store.release(first);
      await store.assertLease(second);
    });
    await step('signed intent survives connection release and is never allocated a replacement nonce', async () => {
      const signed = { keeperAddress: keeper, nonce: 5, hash: `0x${randomBytes(32).toString('hex')}`,
        rawTransaction: '0x0102', targetAddress: address(), calldata: '0x12345678', preconditions: { state: 1 } };
      await store.withKeeperLease(keeper, async client => {
        assert.equal(await store.nextNonce(keeper, 5, client), 5);
        await store.saveIntent(second, signed, client);
      });
      const restartedStore = new PostgresWorkerStore(pool);
      assert.equal((await restartedStore.getIntent(second.id)).hash, signed.hash);
      assert.equal(await restartedStore.nextNonce(keeper, 5), 6);
      const duplicate = await store.withKeeperLease(keeper, client => store.saveIntent(second, { ...signed, nonce: 6, hash: `0x${'9'.repeat(64)}` }, client));
      assert.equal(duplicate.hash, signed.hash);
    });
    await step('global keeper serialization covers separate project jobs', async () => {
      await store.enqueue({ ...proposal, projectId: otherId, operationKey: 'separate' });
      const other = await store.claim('other-worker');
      assert.equal(other.project_id, otherId);
      const tasks = [second, other].map(job => store.withKeeperLease(keeper, async client => {
        const nonce = await store.nextNonce(keeper, 5, client);
        // The first job already has an intent; use a state update in its lock while the second creates the next nonce.
        if (job.id === second.id) { await store.assertLease(job, client); return 5; }
        const saved = await store.saveIntent(job, { keeperAddress: keeper, nonce, hash: `0x${randomBytes(32).toString('hex')}`,
          rawTransaction: '0x0304', targetAddress: address(), calldata: '0x12345678', preconditions: {} }, client);
        return saved.nonce;
      }));
      assert.deepEqual((await Promise.all(tasks)).sort(), [5, 6]);
      await store.release(other);
    });
    await step('deep reorg quarantines affected work and clears only affected project capacity', async () => {
      const orphan = `0x${randomBytes(32).toString('hex')}`;
      await store.update(second, { state: 'finalized', receipt_block: '101', receipt_block_hash: orphan });
      await pool.query("UPDATE provider_bindings SET status='ready',observed_at=now() WHERE project_id=ANY($1::uuid[])", [[projectId, otherId]]);
      assert.equal(await store.invalidateReorg(101n, `0x${'a'.repeat(64)}`), 1);
      const rows = (await pool.query('SELECT project_id,status FROM provider_bindings WHERE project_id=ANY($1::uuid[])', [[projectId, otherId]])).rows;
      assert.equal(rows.find(row => row.project_id === projectId).status, 'pending');
      assert.equal(rows.find(row => row.project_id === otherId).status, 'ready');
      assert.equal((await pool.query('SELECT state FROM worker_jobs WHERE id=$1', [second.id])).rows[0].state, 'quarantined');
    });
    await step('concurrent planners cannot enqueue overlapping actions for one project', async () => {
      const id = randomUUID();
      await bind(id);
      let planned = 0;
      const plans = await Promise.all(Array.from({ length: 8 }, () => store.planProject({ id }, async () => {
        planned++;
        return { projectId: id, operationKey: `plan-${planned}`, operation: 'begin_diem_unstake', payload: {} };
      })));
      assert.equal(planned, 1);
      assert.equal(plans.filter(Boolean).length, 1);
    });
    await step('capacity refresh preserves canary evidence and prevents stale overwrite or crossed signer identity', async () => {
      const binding = (await pool.query('SELECT * FROM provider_bindings WHERE project_id=$1', [otherId])).rows[0];
      const evidence = { signerAddress: binding.signer_address, signerGeneration: 1, authenticationEnabled: true, vaultState: 0, stakedDiem: 10n ** 18n };
      assert.equal(await store.reconcileProjectState(otherId, evidence), true);
      assert.equal((await store.getProject(otherId)).status, 'accumulating');
      const snapshot = { status: 'ready', providerEpoch: '2026-09-09', dailyLimitMicrousd: '1000000', remainingMicrousd: '750000',
        observedAt: '2026-09-09T12:00:00.000Z', chainBlock: '100', chainBlockHash: `0x${'1'.repeat(64)}`,
        signerAddress: binding.signer_address, signerGeneration: 1, authenticationEnabled: true };
      await pool.query('UPDATE provider_bindings SET observed_at=NULL WHERE project_id=$1', [otherId]);
      assert.equal(await store.updateProviderCapacity(otherId, snapshot), true);
      assert.equal(await store.updateProviderCapacity(otherId, { ...snapshot, observedAt: '2026-09-09T11:59:59Z', remainingMicrousd: '999999' }), false);
      const after = (await pool.query('SELECT * FROM provider_bindings WHERE project_id=$1', [otherId])).rows[0];
      assert.equal(after.remaining_microusd, '750000');
      assert.equal(after.canary_verified_at, null);
      assert.equal(await store.reconcileProjectState(otherId, { ...evidence, signerAddress: address(), signerGeneration: 2 }), false);
      const invalid = (await pool.query('SELECT * FROM provider_bindings WHERE project_id=$1', [otherId])).rows[0];
      assert.equal(invalid.status, 'pending');
      assert.equal(invalid.signer_address, binding.signer_address);
      assert.equal(invalid.signer_generation, 1);
      assert.equal(await store.updateProviderCapacity(otherId, { ...snapshot, signerGeneration: 2 }), false);
    });
    await step('failed refreshes and closed projects do not starve projects beyond a scheduling page', async () => {
      const extras = [];
      for (let index = 0; index < 103; index++) { const id = randomUUID(); extras.push(id); await bind(id); }
      const firstKeeper = await store.listKeeperProjects();
      const secondKeeper = await store.listKeeperProjects();
      const firstCapacity = await store.listRefreshableProjects();
      const secondCapacity = await store.listRefreshableProjects();
      assert.ok(extras.every(id => [...firstKeeper, ...secondKeeper].some(project => project.id === id)));
      assert.ok(extras.every(id => [...firstCapacity, ...secondCapacity].some(project => project.id === id)));
    });
    await step('HTTP liveness remains truthful without a configured deployment', async () => {
      const service = await start({ databaseUrl: connectionString, port: 0, executionEnabled: false });
      try {
        const origin = `http://127.0.0.1:${service.server.address().port}`;
        assert.equal((await fetch(`${origin}/healthz`)).status, 200);
        const readiness = await fetch(`${origin}/readyz`);
        assert.equal(readiness.status, 503);
        assert.equal((await readiness.json()).status, 'awaiting_configuration');
      } finally { await service.close(); }
    });
  } finally {
    await pool.end();
    await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);
    await bootstrap.end();
  }
});
