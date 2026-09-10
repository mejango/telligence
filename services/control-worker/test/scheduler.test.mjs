import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runLoop } from '../scheduler.mjs';
import { ControlRuntime } from '../runtime.mjs';

test('a stalled maintenance loop never delays the capacity loop', async () => {
  const abort = new AbortController();
  const events = [];
  let capacityRuns = 0;
  const capacity = runLoop({ name: 'capacity', everyMs: 20, signal: abort.signal, log: (e) => events.push(e), run: async () => { capacityRuns++; } });
  const maintenance = runLoop({ name: 'maintenance', everyMs: 20, signal: abort.signal, log: (e) => events.push(e), run: () => new Promise(() => {}) });
  await delay(250);
  assert.ok(capacityRuns >= 5, `capacity ran ${capacityRuns} times while maintenance hung`);
  assert.ok(capacity.lastSuccess > 0);
  assert.equal(maintenance.lastSuccess, 0);
  abort.abort();
  await capacity.done;
});

test('loop failures are logged with safe codes and do not stop the loop', async () => {
  const abort = new AbortController();
  const events = [];
  let runs = 0;
  const loop = runLoop({ name: 'capacity', everyMs: 5, signal: abort.signal, log: (e) => events.push(e), run: async () => { if (runs++ === 0) throw Object.assign(new Error('boom secret'), { code: 'PROVIDER_UNAVAILABLE' }); } });
  await delay(80);
  abort.abort();
  await loop.done;
  assert.ok(runs >= 3);
  assert.deepEqual(events[0], { event: 'capacity_loop_failed', code: 'PROVIDER_UNAVAILABLE' });
  assert.ok(loop.lastSuccess > 0);
});

function runtimeFixture({ projects, latencyMs, hang = new Set(), concurrency, deadlineMs }) {
  const marked = [];
  const updated = [];
  const store = {
    async listRefreshableProjects() { return projects; },
    async reconcileProjectState() { return true; },
    async updateProviderCapacity(id) { updated.push(id); return true; },
    async markCapacityUnavailable(id) { marked.push(id); },
  };
  const chain = {
    async readDiemEvidence(project) {
      if (hang.has(project.id)) return new Promise(() => {});
      await delay(latencyMs);
      return { blockNumber: 1n, blockHash: `0x${'1'.repeat(64)}`, signerAddress: '0x1', signerGeneration: 1, authenticationEnabled: true, stakedDiem: 10n ** 18n, verifiedAt: Date.now() };
    },
    async getBlockHash() { return `0x${'1'.repeat(64)}`; },
  };
  const signer = { async getHeader() { return { headerName: 'SIGN-IN-WITH-X', headerValue: 'x' }; } };
  const runtime = new ControlRuntime({ store, chain, signer, concurrency, refreshDeadlineMs: deadlineMs,
    readCapacity: async () => { await delay(latencyMs); return { status: 'ready' }; } });
  return { runtime, marked, updated };
}

test('capacity refresh is bounded by concurrency, not by project count', async () => {
  const projects = Array.from({ length: 48 }, (_, i) => ({ id: `p${i}`, chain_id: 8453, vault_address: `0x${'a'.repeat(40)}` }));
  const f = runtimeFixture({ projects, latencyMs: 30, concurrency: 8 });
  const started = Date.now();
  await f.runtime.refreshCapacity();
  const elapsed = Date.now() - started;
  // Sequential would take 48 * 60ms = 2880ms; eight wide takes about 360ms.
  assert.ok(elapsed < 1000, `refresh took ${elapsed}ms`);
  assert.equal(f.updated.length, 48);
  assert.deepEqual(f.marked, []);
});

test('a hanging chain or provider read is time-boxed and only its project is marked unavailable', async () => {
  const projects = [{ id: 'hang', chain_id: 8453 }, ...Array.from({ length: 5 }, (_, i) => ({ id: `ok${i}`, chain_id: 8453 }))];
  const f = runtimeFixture({ projects, latencyMs: 5, hang: new Set(['hang']), concurrency: 8, deadlineMs: 100 });
  const started = Date.now();
  await f.runtime.refreshCapacity();
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(f.marked, ['hang']);
  assert.equal(f.updated.length, 5);
});
