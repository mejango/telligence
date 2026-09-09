import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlRuntime } from '../runtime.mjs';

test('receipt audit reconciles all stored hashes at a height even when the first row matches', async () => {
  const canonical = `0x${'1'.repeat(64)}`;
  const orphan = `0x${'2'.repeat(64)}`;
  const calls = [];
  const runtime = new ControlRuntime({ store: {
    async finalizedReceipts() { return [
      { receipt_block: '100', receipt_block_hash: canonical },
      { receipt_block: '100', receipt_block_hash: orphan },
    ]; },
    async invalidateReorg(block, hash) { calls.push([block, hash]); return 1; },
    async recordCanonicalBlock() {},
  }, chain: { async getBlockHash() { return canonical; } } });
  await runtime.auditReceipts();
  assert.deepEqual(calls, [['100', canonical]]);
});
