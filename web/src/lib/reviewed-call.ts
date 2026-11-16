import { legacyCallNamespace } from "@/lib/legacy-intents";
import { ReviewRefusal } from "@/lib/review-refusal";
import { legacyOf } from "@/lib/write-hold";
import {
  TransactionReviewCancelledError,
  type ReviewedCall,
  type ReviewedResult,
} from "@bananapus/nana-sdk-core/review";
import type { ReviewedRunFailed } from "@bananapus/nana-sdk-core/review/react";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
export { reviewClosed } from "@/lib/review-refusal";

/** A contract write, as the SDK's builders return it. */
export type WriteRequest = {
  chainId: number;
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type ReviewedCallOptions = Pick<
  ReviewedCall,
  | "dependsOnPrior"
  | "simulationBlockNumber"
  | "gas"
  | "label"
  | "contractName"
  | "adoptIgnoringArgs"
> & {
  /**
   * The user action the write is, from one of the SDK's builders (payIntent, loanIntent,
   * bridgeIntent...), or writeIntentKey for one they don't cover. A retry of it is held by its
   * first attempt, whatever calldata the retry stamps again.
   */
  intent?: string;
  /** The namespaces the build before SDK 2.38's builders held it by (legacy-intents.ts). */
  legacyIntents?: readonly string[];
};

/**
 * One reviewed step from a contract write: its exact bytes, decoded for the review, held by its
 * intent. A write no SDK builder names keeps the namespace it had, and an intent also answers for
 * the exact-call holds an earlier build left. REMOVE `legacyIntents` with legacy-intents.ts.
 */
export function reviewedCall(
  request: WriteRequest,
  options: ReviewedCallOptions = {},
): ReviewedCall {
  const { intent: named, legacyIntents = [], ...step } = options;
  const args = request.args ?? [];
  const data = encodeFunctionData({
    abi: request.abi as Abi,
    functionName: request.functionName,
    args: args as unknown[],
  });
  const value = request.value ?? 0n;
  const previous = [
    ...legacyIntents,
    // An approval only sets an allowance, so no old key holds it.
    request.functionName === "approve" ? undefined : legacyCallNamespace({ ...request, args }),
  ].filter((name): name is string => !!name);
  const intent = named ?? previous[0];
  const legacy = previous.filter((name) => name !== intent);
  return {
    chainId: request.chainId,
    to: request.address,
    data,
    value,
    abi: request.abi as Abi,
    functionName: request.functionName,
    args,
    label: request.functionName,
    ...step,
    ...(intent ? { intent, legacy: legacyOf({ to: request.address, data, value }, legacy) } : {}),
  };
}

export { ReviewRefusal };

export type ReviewedRunResult = ReviewedResult | ReviewedRunFailed | null;

/** The line a failed run shows: a site's own refusal as it is, else core's. */
export function failedLine(result: ReviewedRunFailed): string {
  return result.failure instanceof ReviewRefusal ? result.failure.message : result.error;
}

/** The line a flow shows for a step that went to its Safe as a proposal. */
export const SAFE_PROPOSAL_PENDING_LINE =
  "This proposal is waiting in your Safe. Finish it there first.";

/** A step went to a Safe as a proposal: the action continues once the Safe executes it. */
export class SafeProposalPendingError extends Error {
  readonly name = "SafeProposalPendingError";
  constructor(readonly hash: Hex) {
    super(SAFE_PROPOSAL_PENDING_LINE);
  }
}

export function isSafeProposalPendingError(error: unknown): error is SafeProposalPendingError {
  return error instanceof SafeProposalPendingError;
}

/** A run that failed, thrown with the line it shows. */
class ReviewedRunError extends Error {
  readonly name = "ReviewedRunError";
  constructor(
    line: string,
    readonly failure: unknown,
  ) {
    super(line);
  }
}

/**
 * A run's end, for a flow that goes on only once every step executed: its hashes and receipts.
 * A Safe proposal throws SafeProposalPendingError, a failure its line (ReviewedRunError), and a
 * cancel TransactionReviewCancelledError.
 */
export function requireDone(result: ReviewedRunResult) {
  if (!result) throw new TransactionReviewCancelledError();
  if (result.status === "failed") throw new ReviewedRunError(failedLine(result), result.failure);
  if (result.status === "proposed") throw new SafeProposalPendingError(result.safeTxHash);
  return result;
}

/** A run's end for a flow that also ends on a Safe proposal: a failure or a cancel throws. */
export function requireProposedOrDone(result: ReviewedRunResult) {
  if (!result) throw new TransactionReviewCancelledError();
  if (result.status === "failed") throw new ReviewedRunError(failedLine(result), result.failure);
  return result;
}

/** The status line a flow shows for that step. */
export const SAFE_PROPOSAL_UNCONFIRMED_LINE =
  "Check this proposal in your Safe before sending it again.";

/** A reviewed plan's account is no longer the connected one. */
export const ACCOUNT_CHANGED = "The connected account changed. Review again.";

/**
 * The step a run's failure is the mined revert of, or undefined. Matched by name: core's error
 * class loads with its send engine. REPLACE with ReviewedCallRevertedError from SDK local.8.
 */
export function revertedStep(failure: unknown): number | undefined {
  const reverted = failure as { name?: string; step?: number } | null;
  return reverted?.name === "ReviewedCallRevertedError" ? reverted.step : undefined;
}
