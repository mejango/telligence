const RELAYR_MAINNETS = new Set<number>([1, 10, 8453, 42161]);
const RELAYR_TESTNETS = new Set<number>([11155111, 11155420, 84532, 421614]);

export function isRelayrSupportedChain(chainId: number): boolean {
  return RELAYR_MAINNETS.has(chainId) || RELAYR_TESTNETS.has(chainId);
}

/** Destination calls and their funding must stay in the same network family. */
export function areRelayrChainsCompatible(chainIds: readonly number[]): boolean {
  return (
    chainIds.length > 0 &&
    (chainIds.every((chainId) => RELAYR_MAINNETS.has(chainId)) ||
      chainIds.every((chainId) => RELAYR_TESTNETS.has(chainId)))
  );
}
