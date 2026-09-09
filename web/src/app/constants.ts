import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from "@/lib/chains";
import type { JBChainId } from "@/lib/nana/types";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";

export const RESERVED_TOKEN_SPLIT_GROUP_ID = 1n;
/** JBSplits.FALLBACK_RULESET_ID — the default group `splitsOf` serves when a ruleset's group is empty. */
export const FALLBACK_RULESET_ID = 0n;
export const REVNET_CASHOUT_FEE_PERCENT = 0.025;

/**
 * Display order for chain lists. Production chains first, then their testnets, so every
 * list on the site orders the same way. Must cover EVERY supported chain: a partial map
 * makes the comparator return 0 for the missing ones, and their order then depends on
 * whatever the data source happened to emit.
 */
const chainSortOrder = new Map<JBChainId, number>([
  [mainnet.id, 0],
  [optimism.id, 1],
  [base.id, 2],
  [arbitrum.id, 3],
  [sepolia.id, 4],
  [optimismSepolia.id, 5],
  [baseSepolia.id, 6],
  [arbitrumSepolia.id, 7],
]);

/**
 * Sort key for a chain id. Unlisted chains sort after every known one, by chain id, so
 * ordering stays deterministic instead of collapsing to a 0-vs-0 comparison.
 */
export function chainSortIndex(chainId: number): number {
  return chainSortOrder.get(chainId as JBChainId) ?? 1_000_000 + chainId;
}

/**
 * Every chain the app supports, in display order.
 *
 * MEMBERSHIP is derived from the SDK's `JB_CHAINS` — never from a literal — so a chain
 * added there can only ever be appended, not silently dropped from a picker or
 * misclassified. `chainSortOrder` supplies ORDER only; an unlisted chain sorts last
 * rather than disappearing.
 */
export const SUPPORTED_CHAIN_IDS: readonly JBChainId[] = Object.values(JB_CHAINS)
  .map((metadata) => metadata.chain.id as JBChainId)
  .sort((a, b) => chainSortIndex(a) - chainSortIndex(b));

/**
 * Chain name for the UI. The SDK keeps the chain definition's own name so it
 * never drifts from wallets ("OP Mainnet", "Arbitrum One"); the site says the
 * short everyday names instead.
 */
const CHAIN_DISPLAY_NAMES: Partial<Record<number, string>> = {
  [optimism.id]: "Optimism",
  [arbitrum.id]: "Arbitrum",
  [optimismSepolia.id]: "Optimism Sepolia",
  [arbitrumSepolia.id]: "Arbitrum Sepolia",
};

export function chainDisplayName(chainId: number): string {
  return (
    CHAIN_DISPLAY_NAMES[chainId] ?? JB_CHAINS[chainId as JBChainId]?.name ?? `Chain ${chainId}`
  );
}

export function isSupportedChainId(chainId: number): chainId is JBChainId {
  return chainId in JB_CHAINS;
}

/**
 * Whether a chain is a testnet, read off the chain definition itself.
 *
 * Load-bearing beyond display: the testnet split routes Bendystraw to the right host, so
 * a chain missing from a hand-kept list produces a hard wrong-network read, not an empty
 * one — and suckers never bridge across the split.
 */
export function isTestnetChain(chainId: number): boolean {
  return Boolean(JB_CHAINS[chainId as JBChainId]?.chain.testnet);
}

export const MAINNET_CHAIN_IDS: readonly JBChainId[] = SUPPORTED_CHAIN_IDS.filter(
  (chainId) => !isTestnetChain(chainId),
);
export const TESTNET_CHAIN_IDS: readonly JBChainId[] = SUPPORTED_CHAIN_IDS.filter((chainId) =>
  isTestnetChain(chainId),
);

export const chainIdToLogo = {
  [sepolia.id]: "/assets/img/logo/mainnet.svg",
  [optimismSepolia.id]: "/assets/img/logo/optimism.svg",
  [baseSepolia.id]: "/assets/img/logo/base.svg",
  [arbitrumSepolia.id]: "/assets/img/logo/arbitrum.svg",
  [mainnet.id]: "/assets/img/logo/mainnet.svg",
  [optimism.id]: "/assets/img/logo/optimism.svg",
  [base.id]: "/assets/img/logo/base.svg",
  [arbitrum.id]: "/assets/img/logo/arbitrum.svg",
};

/** USDC is 6-decimal on every chain the SDK's `USDC_ADDRESSES` covers. */
export const USDC_DECIMALS = 6;
