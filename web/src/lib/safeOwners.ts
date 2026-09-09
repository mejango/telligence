import { isAddress, type Address } from "viem";

/**
 * Safe Transaction Service chain prefixes — the same mapping
 * useReviewedWriteContract's watchSafeProposal uses to poll proposals.
 */
export const SAFE_TX_SERVICE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};

/** Mainnet chains the Safe Transaction Service covers for this app. */
const SAFE_MAINNET_CHAIN_IDS = [1, 10, 8453, 42161] as const;

export function safeOwnersUrl(chainId: number, owner: string): string | null {
  const prefix = SAFE_TX_SERVICE_PREFIX[chainId];
  if (!prefix || !isAddress(owner)) return null;
  return `https://api.safe.global/tx-service/${prefix}/api/v1/owners/${owner}/safes/`;
}

export type OwnedSafe = { chainId: number; safe: Address };

/**
 * All Safes the address is an owner of, per chain, via the Safe Transaction
 * Service. Chains without a service prefix or with a failing service resolve
 * to no Safes rather than an error.
 */
export async function fetchSafesOwnedBy(
  owner: string,
  chainIds: readonly number[] = SAFE_MAINNET_CHAIN_IDS,
  fetcher: typeof fetch = fetch,
): Promise<OwnedSafe[]> {
  const perChain = await Promise.all(
    chainIds.map(async (chainId): Promise<OwnedSafe[]> => {
      const url = safeOwnersUrl(chainId, owner);
      if (!url) return [];
      try {
        const response = await fetcher(url, { headers: { accept: "application/json" } });
        if (!response.ok) return [];
        const body = (await response.json()) as { safes?: unknown };
        if (!Array.isArray(body.safes)) return [];
        return body.safes
          .filter((safe): safe is string => typeof safe === "string" && isAddress(safe))
          .map((safe) => ({ chainId, safe: safe as Address }));
      } catch {
        return [];
      }
    }),
  );
  return perChain.flat();
}
