import { fault } from './errors.mjs';

export function microUsd(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,20})?$/.test(text)) {
    throw fault('INVALID_PROVIDER_BALANCE', 'Invalid provider balance');
  }
  const [integer, fraction = ''] = text.split('.');
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

/** Only the documented, free balance endpoint can produce a capacity observation. */
export async function readProviderCapacity({ project, diem, getAuthHeader, fetchImpl = fetch, now = Date.now, maxAgeMs = 120_000 }) {
  const startedAt = now();
  if (project.chain_id !== 8453 || !/^0x[0-9a-fA-F]{40}$/.test(project.vault_address)) throw fault('INVALID_PROJECT');
  if (!Number.isSafeInteger(diem.verifiedAt) || diem.verifiedAt > startedAt || startedAt - diem.verifiedAt > maxAgeMs) {
    throw fault('STALE_CHAIN_EVIDENCE', 'Onchain capacity evidence is stale');
  }
  if (typeof diem.stakedDiem !== 'bigint' || diem.stakedDiem < 0n || !/^0x[0-9a-fA-F]{64}$/.test(diem.blockHash)) {
    throw fault('INVALID_CHAIN_EVIDENCE');
  }
  const uri = `https://api.venice.ai/api/v1/x402/balance/${project.vault_address}`;
  const header = await getAuthHeader(project, uri);
  if (typeof header !== 'string' || !header || header.length > 24_000 || /[\r\n]/.test(header)) throw fault('INVALID_PROVIDER_AUTH');
  let response;
  try {
    response = await fetchImpl(uri, { method: 'GET', headers: { Accept: 'application/json', 'SIGN-IN-WITH-X': header }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { throw fault('PROVIDER_UNAVAILABLE'); }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw fault('PROVIDER_UNAVAILABLE');
  }
  // Bound the body even when the server omits Content-Length.
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 16_384) throw fault('INVALID_PROVIDER_BALANCE');
    chunks.push(chunk);
  }
  let envelope;
  try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fault('INVALID_PROVIDER_BALANCE'); }
  const body = envelope?.data;
  if (envelope?.success !== true || !body || typeof body !== 'object' || typeof body.canConsume !== 'boolean') throw fault('INVALID_PROVIDER_BALANCE');
  if (typeof body.walletAddress !== 'string' || body.walletAddress.toLowerCase() !== project.vault_address.toLowerCase()) throw fault('PROVIDER_IDENTITY_MISMATCH');
  microUsd(body.balanceUsd); // Validate before checking exact zero, including fractions below one micro-dollar.
  if (!/^0(?:\.0+)?$/.test(String(body.balanceUsd))) throw fault('USD_FALLBACK_PRESENT');
  const remaining = microUsd(body.diemBalanceUsd);
  const daily = diem.stakedDiem / 10n ** 12n;
  if (remaining > daily || (body.canConsume && diem.stakedDiem < 10n ** 17n)) throw fault('CAPACITY_CONTRADICTION');
  const finishedAt = now();
  const epoch = new Date(startedAt).toISOString().slice(0, 10);
  if (new Date(finishedAt).toISOString().slice(0, 10) !== epoch) throw fault('PROVIDER_EPOCH_CHANGED', 'Provider epoch changed during refresh');
  if (finishedAt < startedAt || finishedAt - startedAt > maxAgeMs) throw fault('STALE_PROVIDER_EVIDENCE');
  return {
    providerEpoch: epoch,
    dailyLimitMicrousd: daily.toString(),
    remainingMicrousd: body.canConsume ? remaining.toString() : '0',
    observedAt: new Date(startedAt).toISOString(),
    status: 'ready',
    chainBlock: diem.blockNumber.toString(),
    chainBlockHash: diem.blockHash,
  };
}
