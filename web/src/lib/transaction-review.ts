"use client";

import { chainDisplayName } from "@/app/constants";
import type { ChainPayment } from "@/lib/nana/types";
import { explorerBaseUrl } from "@/lib/utils";
import {
  buildTransactionDebugPrompt as buildDebugPrompt,
  buildTransactionReviewPrompt as buildReviewPrompt,
  fundingChainLabel,
  requireFundingChainSelection,
  type FundingChainOption,
  type ReviewModel,
  type TransactionReviewRequest,
} from "@bananapus/nana-sdk-core/review";

export {
  fundingChainLabel,
  registerFundingChainSelectionHandler,
  requireFundingChainSelection,
  TransactionReviewCancelledError,
  transactionReviewJson,
  type FundingChainOption,
  type TransactionReviewCall,
  type TransactionReviewRequest,
} from "@bananapus/nana-sdk-core/review";

const display = {
  chainName: chainDisplayName,
  explorerOrigin: (chainId: number) => explorerBaseUrl(chainId) ?? null,
};

export function buildTransactionDebugPrompt(calls: { chainId: number; txHash: string }[]): string {
  return buildDebugPrompt(calls, display);
}

export function buildTransactionReviewPrompt(
  request: TransactionReviewRequest | ReviewModel,
): string {
  return buildReviewPrompt(request, display);
}

/** One choice per quoted chain, labelled with its fee. The first quote on a chain wins. */
export function relayrPaymentOptions(payments: readonly ChainPayment[]): FundingChainOption[] {
  const chains = new Set<number>();
  return payments.flatMap((payment) => {
    if (chains.has(payment.chain)) return [];
    chains.add(payment.chain);
    return [
      {
        chainId: payment.chain,
        label: fundingChainLabel(chainDisplayName(payment.chain), BigInt(payment.amount)),
      },
    ];
  });
}

/** The quote on the preferred chain, else a lone quote, else none. */
export function preselectedRelayrPayment(
  payments: readonly ChainPayment[],
  preferredChainId?: number,
): ChainPayment | null {
  return (
    payments.find((payment) => payment.chain === preferredChainId) ??
    (new Set(payments.map((payment) => payment.chain)).size === 1 ? payments[0] : null)
  );
}

export async function chooseRelayrPayment(
  payments: readonly ChainPayment[],
  preferredChainId?: number,
): Promise<ChainPayment> {
  if (!payments.length) throw new Error("No payment option is available.");
  const chosen = await requireFundingChainSelection(
    relayrPaymentOptions(payments),
    preferredChainId,
  );
  return payments.find((payment) => payment.chain === chosen)!;
}
