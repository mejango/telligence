/**
 * Slippage floor for `minReturnedTokens`.
 *
 * - `slippageBps` is basis points (100 = 1%, 500 = 5%).
 * - A verified zero quote stays zero (zero-issuance projects).
 * - A positive quote never floors to zero (that would disable protection).
 */
export function minReturnedTokens(quoted: bigint, slippageBps: bigint = 500n): bigint {
  if (quoted <= 0n) return 0n;
  const min = (quoted * (10_000n - slippageBps)) / 10_000n;
  return min === 0n ? 1n : min;
}
