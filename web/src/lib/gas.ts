/**
 * Add explicit headroom to an RPC gas estimate. Juicebox terminal calls may
 * catch an out-of-gas internal fee payment, which can make the cheaper fallback
 * path look like a successful estimate. The wallet only pays for gas used.
 */
export function gasWithHeadroom(estimate: bigint): bigint {
  return estimate * 2n;
}
