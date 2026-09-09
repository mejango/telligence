import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from '../worker.mjs';
import { validateOperation } from '../operations.mjs';

const hash = `0x${'1'.repeat(64)}`;
const blockHash = `0x${'2'.repeat(64)}`;
const keeper = `0x${'3'.repeat(40)}`;
const project = { id: 'project', chain_id: 8453, status: 'active' };

function fixture(options = {}) {
  const calls = [];
  let leaseValid = true;
  const job = { id: 'job', project_id: project.id, operation: 'allocate', payload: { vvvAmount: '1', deadline: '2000000000' }, state: 'queued', fence: '1' };
  let intent;
  const store = {
    async claim() { calls.push('claim'); return { ...job }; },
    async assertLease() { if (!leaseValid) throw Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' }); },
    async getProject() { return project; },
    async getIntent() { return intent; },
    async withKeeperLease(_address, fn) { return fn({ token: 1 }); },
    async nextNonce(_address, pending) { return pending; },
    async saveIntent(_job, signed) { await this.assertLease(); calls.push('persist'); intent = signed; return intent; },
    async update(_job, change) { await this.assertLease(); calls.push(change.state); Object.assign(job, change); },
    async release() { calls.push('release'); },
    async markCapacityUnavailable() { calls.push('capacity_unavailable'); },
  };
  const chain = {
    keeperAddress: keeper,
    async validateProject() { calls.push('validate'); },
    async validateIntent() {},
    async preflight() { return {}; },
    async getPendingNonce() { return 7; },
    async prepare(_job, _project, nonce) { calls.push('sign'); return { hash, rawTransaction: '0x0102', nonce, keeperAddress: keeper }; },
    async getReceipt() { return null; },
    async getLatestNonce() { return 7; },
    async broadcast(raw) { assert.equal(raw, '0x0102'); assert.ok(intent, 'intent must be durable before send'); calls.push('broadcast'); return hash; },
    async getBlockHash() { return blockHash; },
    async getBlockNumber() { return 120n; },
    async getFinalizedBlockNumber() { return 120n; },
    async verifyEffect() { calls.push('effect'); return { verified: true }; },
  };
  const worker = new Worker({ store, chain, owner: 'test', executionEnabled: true, confirmations: 20, ...options });
  return { worker, chain, store, job, calls, get intent() { return intent; }, loseLease() { leaseValid = false; } };
}

test('disabled keeper claims no work and signs nothing', async () => {
  const f = fixture({ executionEnabled: false });
  assert.equal(await f.worker.tick(), false);
  assert.deepEqual(f.calls, []);
});

test('strict operations reject arbitrary selectors, destinations and malformed quantities', () => {
  assert.throws(() => validateOperation('execute', {}), /operation/);
  assert.throws(() => validateOperation('allocate', { vvvAmount: '1', deadline: '2000000000', recipient: keeper }), /fields/);
  for (const value of ['-1', '1.2', '1e18', '0', 1, `1${'0'.repeat(80)}`]) {
    assert.throws(() => validateOperation('allocate', { vvvAmount: value, deadline: '2000000000' }));
  }
  assert.deepEqual(validateOperation('begin_diem_unstake', {}), {});
});

test('persists signed intent before broadcasting', async () => {
  const f = fixture();
  await f.worker.tick();
  assert.ok(f.calls.indexOf('persist') < f.calls.indexOf('broadcast'));
  assert.equal(f.job.state, 'submitted');
  assert.equal(f.intent.hash, hash);
});

test('ambiguous RPC submission is recovered with exactly the same transaction after restart', async () => {
  const f = fixture();
  f.chain.broadcast = async () => { f.calls.push('ambiguous_send'); throw new Error('socket closed after send'); };
  await f.worker.tick();
  assert.equal(f.job.state, 'broadcast_unknown');
  const persisted = f.intent;
  f.chain.broadcast = async raw => { assert.equal(raw, persisted.rawTransaction); f.calls.push('resubmit'); return hash; };
  const restarted = new Worker({ store: f.store, chain: f.chain, executionEnabled: true, owner: 'after-restart' });
  await restarted.tick();
  assert.equal(f.calls.filter(v => v === 'sign').length, 1);
  assert.equal(f.intent, persisted);
  assert.equal(f.job.state, 'submitted');
});

test('expired fencing token cannot persist or broadcast a signed transaction', async () => {
  const f = fixture();
  f.chain.prepare = async () => { f.loseLease(); return { hash, rawTransaction: '0x0102', nonce: 7, keeperAddress: keeper }; };
  await f.worker.tick();
  assert.equal(f.intent, undefined);
  assert.equal(f.calls.includes('broadcast'), false);
});

test('consumed nonce without a receipt is quarantined instead of using a fresh nonce', async () => {
  const f = fixture();
  await f.worker.tick();
  f.chain.getLatestNonce = async () => 8;
  await f.worker.tick();
  assert.equal(f.job.state, 'quarantined');
  assert.equal(f.job.error_code, 'NONCE_CONSUMED_WITHOUT_RECEIPT');
  assert.equal(f.calls.filter(v => v === 'sign').length, 1);
  assert.equal(f.calls.filter(v => v === 'broadcast').length, 1);
});

test('finalization requires a canonical receipt, confirmation depth and verified effect', async () => {
  const f = fixture();
  await f.worker.tick();
  f.chain.getReceipt = async () => ({ transactionHash: hash, status: 'success', blockNumber: 100n, blockHash });
  f.chain.getBlockNumber = async () => 118n;
  await f.worker.tick();
  assert.equal(f.job.state, 'confirmed');
  assert.equal(f.calls.includes('effect'), false);
  f.chain.getBlockNumber = async () => 119n;
  f.chain.getFinalizedBlockNumber = async () => 99n;
  await f.worker.tick();
  assert.equal(f.job.state, 'confirmed');
  f.chain.getFinalizedBlockNumber = async () => 100n;
  await f.worker.tick();
  assert.equal(f.job.state, 'finalized');
  assert.equal(f.calls.includes('effect'), true);
});

test('successful receipt without expected contract effects is quarantined', async () => {
  const f = fixture();
  await f.worker.tick();
  f.chain.getReceipt = async () => ({ transactionHash: hash, status: 'success', blockNumber: 100n, blockHash });
  f.chain.verifyEffect = async () => ({ verified: false });
  await f.worker.tick();
  assert.equal(f.job.state, 'quarantined');
  assert.equal(f.job.error_code, 'EFFECT_NOT_VERIFIED');
});

test('reverted transaction is terminal, never retried with another nonce', async () => {
  const f = fixture();
  await f.worker.tick();
  f.chain.getReceipt = async () => ({ transactionHash: hash, status: 'reverted', blockNumber: 100n, blockHash });
  await f.worker.tick();
  assert.equal(f.job.state, 'failed');
  assert.equal(f.job.error_code, 'TRANSACTION_REVERTED');
});

test('orphaned receipt invalidates capacity and never reports success', async () => {
  const f = fixture();
  await f.worker.tick();
  f.chain.getReceipt = async () => ({ transactionHash: hash, status: 'success', blockNumber: 100n, blockHash });
  f.chain.getBlockHash = async () => `0x${'4'.repeat(64)}`;
  await f.worker.tick();
  assert.equal(f.job.state, 'broadcast_unknown');
  assert.equal(f.job.error_code, 'REORG');
  assert.equal(f.calls.includes('capacity_unavailable'), true);
});

test('untrusted deployment never signs or broadcasts', async () => {
  const f = fixture();
  f.chain.validateProject = async () => { throw Object.assign(new Error('bad runtime hash'), { code: 'MANIFEST_MISMATCH', permanent: true }); };
  await f.worker.tick();
  assert.equal(f.calls.includes('sign'), false);
  assert.equal(f.job.state, 'quarantined');
});

test('corrupted persisted transaction bytes are rejected before broadcast', async () => {
  const f = fixture();
  await f.worker.tick();
  f.chain.validateIntent = async () => { throw Object.assign(new Error('intent mismatch'), { code: 'INTENT_MISMATCH', permanent: true }); };
  await f.worker.tick();
  assert.equal(f.job.state, 'quarantined');
  assert.equal(f.calls.filter(value => value === 'broadcast').length, 1);
});

test('expired preflight with no signed intent ends safely and permits a fresh plan', async () => {
  const f = fixture();
  f.chain.preflight = async () => { throw Object.assign(new Error('expired'), { code: 'DEADLINE_EXPIRED', permanent: true }); };
  await f.worker.tick();
  assert.equal(f.job.state, 'failed');
  assert.equal(f.calls.includes('sign'), false);
  assert.equal(f.calls.includes('capacity_unavailable'), false);
});
