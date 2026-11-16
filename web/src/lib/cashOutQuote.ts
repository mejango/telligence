import {
  classifyCashOutExecutionError,
  cashOutPoolBufferBps as sdkCashOutPoolBufferBps,
  type CashOutRoute,
} from "@bananapus/nana-sdk-core/v6";

/** Pool fee/impact buffer already included by the hook's live preview. */
export function cashOutPoolBufferBps(route: CashOutRoute | undefined): number | null {
  const buffer = sdkCashOutPoolBufferBps(route);
  return buffer === null ? null : Number(buffer);
}

export function cashOutExecutionErrorMessage(error: unknown): string | null {
  const classified = classifyCashOutExecutionError(error);
  if (classified?.code === "BUYBACK_SLIPPAGE_EXCEEDED") {
    return "The buyback pool moved below your protected minimum. Refresh the quote or choose a larger max slippage, then try again.";
  }
  if (classified?.code === "TERMINAL_UNDER_MIN") {
    return "The project cash-out fell below your protected minimum. Refresh the quote and try again.";
  }
  return null;
}

/**
 * Whether the minimum the call would carry is below the minimum the review
 * shows. An unread reviewed minimum counts as dropped: its row cannot be true.
 */
export function cashOutMinimumDropped(reviewed: bigint | undefined, fresh: bigint): boolean {
  return reviewed === undefined || fresh < reviewed;
}

/** Keep a remembered multi-chain choice from diverging from the chains which are still cash-outable. */
export function resolveCashOutChainId(
  availableChainIds: readonly number[],
  selectedChainId: string | undefined,
): string | undefined {
  if (availableChainIds.length === 1) return availableChainIds[0].toString();
  if (selectedChainId && availableChainIds.some((chainId) => chainId === Number(selectedChainId))) {
    return selectedChainId;
  }
  return undefined;
}
