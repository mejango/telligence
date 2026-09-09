import {
  classifyCashOutExecutionError,
  cashOutPoolBufferBps as sdkCashOutPoolBufferBps,
  type CashOutRoute,
} from "@bananapus/nana-sdk-core/v6";

const MAX_CASH_OUT_TAX_RATE = 10_000n;

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

export type CashOutQuoteInput = {
  surplus: bigint;
  cashOutCount: bigint;
  totalSupply: bigint;
  cashOutTaxRate: bigint;
};

/** Exact integer ordering used by nana-core-v6 JBCashOuts.cashOutFrom. */
export function contractCashOutQuote({
  surplus,
  cashOutCount,
  totalSupply,
  cashOutTaxRate,
}: CashOutQuoteInput): bigint {
  if (
    surplus < 0n ||
    cashOutCount < 0n ||
    totalSupply < 0n ||
    cashOutTaxRate < 0n ||
    cashOutTaxRate > MAX_CASH_OUT_TAX_RATE
  ) {
    throw new RangeError("cash-out inputs are outside contract bounds");
  }
  if (cashOutCount === 0n || totalSupply === 0n || surplus === 0n) return 0n;
  if (cashOutTaxRate === MAX_CASH_OUT_TAX_RATE) return 0n;
  if (cashOutCount >= totalSupply) return surplus;

  const base = (surplus * cashOutCount) / totalSupply;
  if (cashOutTaxRate === 0n) return base;

  const numerator =
    MAX_CASH_OUT_TAX_RATE - cashOutTaxRate + (cashOutTaxRate * cashOutCount) / totalSupply;
  return (base * numerator) / MAX_CASH_OUT_TAX_RATE;
}

/**
 * Choose the largest decimal token unit no greater than the outstanding supply.
 * A quote for this exact unit is displayed as-is; nonlinear cash-out quotes must
 * never be extrapolated to one token by multiplying by an arbitrary factor.
 */
export function cashOutDisplayUnit(totalSupply: bigint, tokenDecimals: number): bigint | null {
  if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new RangeError("token decimals are outside supported bounds");
  }
  if (totalSupply <= 0n) return null;

  let unit = 10n ** BigInt(tokenDecimals);
  while (unit > totalSupply && unit > 1n) unit /= 10n;
  return unit;
}

export function exitFloorQuote(input: {
  mintedSupply: bigint;
  pendingReservedTokens: bigint;
  surplus: bigint;
  cashOutTaxRate: bigint;
  tokenDecimals: number;
}): { cashOutCount: bigint; reclaimAmount: bigint } | null {
  const totalSupply = input.mintedSupply + input.pendingReservedTokens;
  const cashOutCount = cashOutDisplayUnit(totalSupply, input.tokenDecimals);
  if (cashOutCount === null) return null;

  return {
    cashOutCount,
    reclaimAmount: contractCashOutQuote({
      surplus: input.surplus,
      cashOutCount,
      totalSupply,
      cashOutTaxRate: input.cashOutTaxRate,
    }),
  };
}
