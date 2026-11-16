"use client";

import { chainDisplayName } from "@/app/constants";
import {
  requireSafeExecutionSuccess,
  safeTransactionRunsCalls as runsCalls,
  safeExecutionResult,
} from "@/lib/safe-service-config";
import { type Address, type Hex } from "viem";

/** The origin every Safe proposal from this app names. */
export const SAFE_PROPOSAL_ORIGIN = "revnet.money";

/** Why a queued transaction that pays its executor a gas refund is never executed here. */
export const REFUND_REFUSAL = "This transaction pays a gas refund, so it can't be executed here.";

/** A call a Safe proposal was reviewed to run; its value in wei, as a decimal string in the journal. */
export type ReviewedSafeCall = { to: Address; value: bigint | string; data: Hex };

/** What a Safe proposal was reviewed to run: one call, or a batch of calls run in order. */
export type ReviewedSafeProposal = {
  safe: Address;
  calls: readonly ReviewedSafeCall[];
  batch: boolean;
  /** The safeTxGas the proposal was made with, in decimal, when it is not zero. */
  safeTxGas?: string;
  /** The write-hold namespace of the user's intent, when the proposal is held by it. */
  holdNamespace?: string;
  /** The namespaces the build before SDK 2.38's builders held it by. REMOVE with legacy-intents.ts. */
  legacyNamespaces?: string[];
};

/**
 * Whether the Safe transaction `tx` runs exactly the reviewed `calls`: the one call itself as a
 * CALL, or, for a batch, a MultiSendCallOnly delegatecall of every call in order.
 */
export function safeTransactionRunsCalls(
  tx: { to: Address; value: bigint; data: Hex; operation: number },
  calls: readonly ReviewedSafeCall[],
  batch: boolean,
): boolean {
  return runsCalls(tx, calls, batch);
}

/** What a Safe queue shows on a chain where Safe hosts no transaction service. */
export function queueUnavailableMessage(chainId: number): string {
  return `Safe queue isn't available on ${chainDisplayName(chainId)}.`;
}

/**
 * Throws unless `receipt` proves the Safe transaction `safeTxHash` ran on `safe` and succeeded
 * ({@link requireSafeExecutionSuccess}) without paying a refund. Every transaction this app
 * executes or relays is zero-refund, so a refund in its own event means something else ran.
 */
export function requireRefundFreeSafeExecution(
  receipt: Parameters<typeof safeExecutionResult>[0],
  safe: Address,
  safeTxHash: Hex,
): void {
  requireSafeExecutionSuccess(receipt, safe, safeTxHash);
  const result = safeExecutionResult(receipt, safe, safeTxHash);
  if (result.status === "success" && result.payment !== 0n) {
    throw new Error("The Safe paid a gas refund for this transaction.");
  }
}
