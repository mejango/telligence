import test from 'node:test';
import assert from 'node:assert/strict';
import { readProviderCapacity, microUsd } from '../capacity.mjs';

const vault = `0x${'1'.repeat(40)}`;
const project = { id: 'project', vault_address: vault, chain_id: 8453 };
const now = Date.parse('2026-09-09T12:00:00Z');
const diem = { stakedDiem: 2n * 10n ** 18n, verifiedAt: now, blockNumber: 100n, blockHash: `0x${'2'.repeat(64)}` };

test('decimal amounts floor without float multiplication or rounding credits up', () => {
  assert.equal(microUsd('1.123456789'), 1123456n);
  assert.equal(microUsd(0.1), 100000n);
  for (const value of ['-1', 'NaN', '1e6', '', null, 1e30]) assert.throws(() => microUsd(value));
});

function options(response = { canConsume: true, balanceUsd: '0', diemBalanceUsd: '1.25' }) {
  const calls = [];
  return { calls, project, diem, now: () => now, getAuthHeader: async () => 'private-auth', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, data: { walletAddress: vault, ...response } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } };
}

test('uses only authenticated free balance route, never inference or payment, and DIEM allowance', async () => {
  const f = options();
  const snapshot = await readProviderCapacity(f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `https://api.venice.ai/api/v1/x402/balance/${vault}`);
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.deepEqual(Object.keys(f.calls[0].init.headers).sort(), ['Accept', 'SIGN-IN-WITH-X']);
  assert.equal(snapshot.dailyLimitMicrousd, '2000000');
  assert.equal(snapshot.remainingMicrousd, '1250000');
  assert.equal(snapshot.providerEpoch, '2026-09-09');
});

test('USD fallback, absent DIEM, identity substitution and contradictory allowance fail closed', async () => {
  for (const response of [
    { canConsume: true, balanceUsd: '1', diemBalanceUsd: '1' },
    { canConsume: true, balanceUsd: '0.0000001', diemBalanceUsd: '1' },
    { canConsume: true, balanceUsd: '0' },
    { canConsume: true, balanceUsd: '0', diemBalanceUsd: '2.1' },
    { canConsume: true, balanceUsd: '0', diemBalanceUsd: '1', walletAddress: `0x${'3'.repeat(40)}` },
  ]) await assert.rejects(readProviderCapacity(options(response)));
});

test('stale onchain evidence and refresh crossing UTC epoch never enable credit', async () => {
  await assert.rejects(readProviderCapacity({ ...options(), diem: { ...diem, verifiedAt: now - 120_001 } }), /stale/);
  let call = 0;
  await assert.rejects(readProviderCapacity({ ...options(), now: () => call++ === 0 ? now : now + 86_400_000 }), /epoch/);
});

test('HTTP errors redact provider body and do not retry', async () => {
  const f = options();
  f.fetchImpl = async () => { f.calls.push('called'); return new Response('private-provider-response', { status: 401 }); };
  await assert.rejects(readProviderCapacity(f), error => error.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('private'));
  assert.equal(f.calls.length, 1);
});

test('provider envelope must report success and identify this wallet', async () => {
  for (const response of [
    { success: false, data: { walletAddress: vault, balanceUsd: '0', diemBalanceUsd: '1', canConsume: true } },
    { success: true, data: { balanceUsd: '0', diemBalanceUsd: '1', canConsume: true } },
    { balanceUsd: '0', diemBalanceUsd: '1', canConsume: true, walletAddress: vault },
  ]) {
    const f = options();
    f.fetchImpl = async () => new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    await assert.rejects(readProviderCapacity(f));
  }
});
