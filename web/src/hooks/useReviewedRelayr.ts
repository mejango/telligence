"use client";

import { ReviewRefusal } from "@/lib/review-refusal";

import { activityJournal } from "@/lib/activity-journal";
import { mapConcurrentChecks } from "@/lib/concurrent-checks";
import { formatShortDateTime } from "@/lib/date";
import { fence, type TabLocks } from "@/lib/fence";
import { confirmRelayrDiscard } from "@/lib/flow-choice";
import {
  batchCallScope,
  releaseBatchRound,
  type BatchRound,
  type MultichainBatch,
} from "@/lib/multichain-batch";
import {
  requireRawPayerCall,
  verifyActionReceipt,
  verifyCallPreconditions,
  type CallPrecondition,
  type ExpectedPayerDeployment,
  type ExpectedSafeExecution,
  type RejectedReceiptEvent,
} from "@/lib/multichain-guards";
import type {
  ChainPayment,
  JBChainId,
  RelayrGetBundleResponse,
  RelayrPostBundleResponse,
} from "@/lib/nana/types";
import {
  requireRawPendingRouterCall,
  simulatePendingRouterCall,
  type RouterPendingReceiptGuard,
} from "@/lib/pending-router-calls";
import { verifyMetadataSource, type MetadataSourceGuard } from "@/lib/project-metadata-write";
import {
  relayrSavedQuote,
  relayrSessionRequests,
  relayrRecoveryScopeKey as scopeKey,
  sentPayments,
} from "@/lib/relayr-activity";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import { relayrPaymentReview } from "@/lib/relayr-payment-review";
import { loadEngine, reviewedSendDeps, reviewedWalletAdapter } from "@/lib/reviewed-send-deps";
import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { isSafeConnection } from "@/lib/safe-connector";
import {
  safeRelayrActivity,
  safeRelayrController,
  safeRelayrExecution,
  safeRelayrQuote,
  safeRelayrSession,
} from "@/lib/safe-relayr";
import {
  dismissTransactionActivity,
  recordTransactionActivity,
  refreshTransactionActivities,
  requireTransactionActivityPersistence,
  transactionActivitySnapshot,
  updateTransactionActivity,
  type RelayrExpectedTransaction,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import type { TransactionReviewCall } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { savedAttempts } from "@/lib/write-hold";
import { erc2771ForwarderAbi, jbContractAddress, type JBVersion } from "@bananapus/nana-sdk-core";
import {
  assertLocksHeld,
  browserLocks,
  gasWithHeadroom,
  keepOutcome,
  LockLostError,
  relayrDiscardLine,
  ReviewedCallRevertedError,
  relayrHeldMessage as sharedHeldMessage,
  WalletNotInvokedError,
  writeIntentKey,
  type LockHandle,
  type ReviewedForwardRequest,
  type ReviewedPlan,
  type ReviewedPlanAction,
  type SavedAttempt,
  type SavedAttemptCheck,
  type SavedAttemptRetired,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import {
  bindRelayrQuote,
  isRelayrDiscardReason,
  MAX_RELAYR_SENT_PAYMENTS,
  proveSavedRelayrPayment,
  RELAYR_API,
  RELAYR_PAYMENT_CODE_HASH,
  RELAYR_PAYMENT_GAS,
  RELAYR_REQUEST_RUN_MARGIN_SECONDS,
  relayrBundleRequest,
  relayrDeadlinePassed,
  relayrDestinationHash,
  relayrForwarderDeadline,
  relayrForwardRequest,
  relayrPaymentAttemptOutcome,
  relayrPaymentDetails,
  RelayrPaymentNotSentError,
  RelayrProofError,
  relayrQuotedOptions,
  relayrRequestsDead,
  relayrRequestStates,
  relayrRequestsVerdict,
  relayrRetryOption,
  relayrSessionOutcome,
  relayrStateIsFailed,
  relayrStateIsSuccess,
  relayrWalletPaymentError,
  requireRelayrBundleUnpaid,
  requireRelayrRetry,
  revertedRelayrQuote,
  TRUSTED_FORWARDER_ABI,
  type RelayrBundle,
  type RelayrDiscardReason,
  type RelayrEntry,
  type RelayrRequestsVerdict,
  type RelayrTransactionRecord,
} from "@bananapus/nana-sdk-core/review/relayr";
import {
  SafeRelayrRecoveryError,
  safeRelayrReservationKey,
  type SafeRelayrProgress,
  type SafeRelayrRecovery,
  type SafeRelayrResult,
  type SafeRelayrStatus,
  type SafeRelayrView,
} from "@bananapus/nana-sdk-core/review/safe-relayr";
import type { ExpectedPayoutReceipt, ExpectedReservedReceipt } from "@bananapus/nana-sdk-core/v6";
import { useCallback, useEffect, useState } from "react";
import {
  encodeFunctionData,
  isHash,
  keccak256,
  maxUint256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

export type ReviewedRelayrRequest = {
  chainId: JBChainId;
  version?: JBVersion;
  /** Groups a non-idempotent workflow whose retries may change calldata. */
  recoveryScope?: string;
  metadataSource?: MetadataSourceGuard;
  /** "safe-exec" runs a fully signed Safe execTransaction; validated by the shared Safe lifecycle. */
  relayrMode?: "raw" | "forwarded" | "safe-exec";
  expectedSafeExecution?: ExpectedSafeExecution;
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ExpectedReservedReceipt;
  expectedPayout?: ExpectedPayoutReceipt;
  expectedRouterPending?: RouterPendingReceiptGuard;
  data: {
    from: Address;
    to: Address;
    value: bigint;
    gas: bigint;
    data: Hex;
  };
  review?: {
    abi?: Abi;
    functionName?: string;
    args?: readonly unknown[];
    label?: string;
    contractName?: string;
    calls?: readonly TransactionReviewCall[];
  };
};

/**
 * One request as a plan shows it: a raw call Relayr runs from its own account, any other from
 * the signer, decoded with the request's own review fields.
 */
export function relayrPlanCall(
  request: ReviewedRelayrRequest,
  account: Address,
  /** A forward request's signed gas: the plan binds it. */
  gas?: bigint,
): ReviewedPlanAction["calls"][number] {
  return {
    chainId: request.chainId,
    ...(gas === undefined ? {} : { gas }),
    from: request.relayrMode === "raw" ? "relayr" : account,
    to: request.data.to,
    data: request.data.data,
    value: request.data.value,
    ...(request.review?.abi ? { abi: request.review.abi } : {}),
    ...(request.review?.functionName ? { functionName: request.review.functionName } : {}),
    ...(request.review?.args ? { args: request.review.args } : {}),
    ...(request.review?.label ? { label: request.review.label } : {}),
    ...(request.review?.contractName ? { contractName: request.review.contractName } : {}),
  };
}

type RememberedQuote = {
  bundleUuid: string;
  account: Address;
  callKey: string;
  callKeys: string[];
  chainIds: number[];
  payments: ChainPayment[];
  expectedTransactions: RelayrExpectedTransaction[];
  /** The plan review that showed this bundle's fee bound, and its round: its payment asks nothing more. */
  planned?: PlannedRound;
};

/** A plan and the Relayr round in it that one bundle runs. */
export type PlannedRound = { plan: ReviewedPlan; relayrRound: string };

export type RelayrDestinationProgress = {
  transactionUuid: string;
  hash?: Hex;
  status: "pending" | "submitted" | "confirmed" | "reverted";
};

type DestinationResultsListener = (results: readonly RelayrDestinationProgress[]) => void;

const quotes = new Map<string, RememberedQuote>();
const bundleInflight = new Map<string, Promise<RelayrGetBundleResponse>>();
const paymentInflight = new Set<string>();
const fundedBundles = new Set<string>();
const bundleListeners = new Map<string, Set<(bundle: RelayrGetBundleResponse) => void>>();
const bundleResultListeners = new Map<string, Set<DestinationResultsListener>>();
const bundleResultSnapshots = new Map<string, readonly RelayrDestinationProgress[]>();
const safeBundleControllers = new Map<string, ReturnType<typeof safeRelayrController>>();

function publishDestinationResults(key: string, results: readonly RelayrDestinationProgress[]) {
  bundleResultSnapshots.set(key, structuredClone(results));
  for (const listener of bundleResultListeners.get(key) ?? []) notifyProgress(listener, results);
}

function subscribeDestinationResults(key: string, listener?: DestinationResultsListener) {
  if (!listener) return () => undefined;
  const listeners = bundleResultListeners.get(key) ?? new Set<DestinationResultsListener>();
  listeners.add(listener);
  bundleResultListeners.set(key, listeners);
  const latest = bundleResultSnapshots.get(key);
  if (latest) notifyProgress(listener, latest);
  return () => {
    listeners.delete(listener);
  };
}

function notifyProgress<T>(listener: (progress: T) => void, progress: T) {
  try {
    listener(structuredClone(progress));
  } catch {
    // Display listeners cannot interrupt reconciliation or other observers.
  }
}

/**
 * One controller per bundle, so its view keeps every row from checking through paying and
 * watching. Only `fund` pays, and only sendRelayrTx calls it, after its payment review.
 */
function safeBundleController(config: Parameters<typeof safeRelayrController>[0], key: string) {
  let controller = safeBundleControllers.get(key);
  if (!controller) {
    controller = safeRelayrController(config, true);
    safeBundleControllers.set(key, controller);
  }
  return controller;
}

/** The bundle key of a saved Safe session's activity. */
function safeSessionKey(activity: TransactionActivity | undefined) {
  const session = activity && safeRelayrSession(activity);
  return session ? (session.bundleUuid ?? session.id) : undefined;
}

/**
 * Shows a saved Safe session's controller view now and on each change, until the returned stop.
 * A reopened dialog gets the latest rows even when the controller suppresses repeats.
 */
export function watchSafeBundleView(
  config: Parameters<typeof safeRelayrController>[0],
  activityId: string,
  show: (view: SafeRelayrView) => void,
) {
  const key = safeSessionKey(refreshTransactionActivities().find((row) => row.id === activityId));
  if (!key) return () => undefined;
  const controller = safeBundleController(config, key);
  const tell = () => {
    try {
      show(controller.getState());
    } catch {
      // Display listeners cannot interrupt reconciliation or other observers.
    }
  };
  tell();
  return controller.subscribe(tell);
}

const authorizingAccounts = new Set<string>();

async function withAuthorizationLock<T>(
  account: Address,
  action: (locks: TabLocks) => Promise<T>,
): Promise<T> {
  const key = account.toLowerCase();
  if (authorizingAccounts.has(key))
    throw new Error("Another authorization is being prepared for this account.");
  authorizingAccounts.add(key);
  try {
    return (await browserLocks().request(
      `revnet:relayr-authorizations:${key}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock)
          throw new Error("Another browser tab is preparing authorizations for this account.");
        return action([lock]);
      },
    )) as T;
  } finally {
    authorizingAccounts.delete(key);
  }
}

function paymentKey(payment: ChainPayment): string {
  return `${payment.chain}:${payment.target.toLowerCase()}:${payment.amount}:${payment.calldata.toLowerCase()}:${payment.token.toLowerCase()}:${payment.payment_deadline}`;
}

function rememberQuote(
  quote: RelayrPostBundleResponse,
  account: Address,
  callKey: string,
  callKeys: string[],
  expectedTransactions: RelayrExpectedTransaction[],
  planned?: PlannedRound,
): void {
  const remembered: RememberedQuote = {
    bundleUuid: quote.bundle_uuid,
    account,
    callKey,
    callKeys,
    chainIds: expectedTransactions.map((transaction) => transaction.chainId),
    payments: quote.payment_info.map((payment) => ({ ...payment })),
    expectedTransactions,
    ...(planned ? { planned } : {}),
  };
  quote.payment_info.forEach((payment) => quotes.set(paymentKey(payment), remembered));
}

function requestKey(account: Address, requests: ReviewedRelayrRequest[]): string {
  const calls = requests
    .map(
      (request) =>
        `${request.chainId}:${request.version ?? 6}:${request.data.to.toLowerCase()}:${request.data.value}:${request.data.data.toLowerCase()}`,
    )
    .sort();
  return `${account.toLowerCase()}:relayr:${keccak256(stringToHex(calls.join("|")))}`;
}

/** A published bundle holds this action; recovery must inspect that exact bundle. */
export class RelayrRecoveryError extends Error {
  readonly activityId: string;
  readonly bundleUuid?: string;
  readonly paymentStatus: TransactionActivity["relayrPaymentStatus"];
  readonly safeReleaseReason?: TransactionActivity["relayrSafeReleaseReason"];
  readonly safeExecutions: { chainId: number; safe: Address; nonce: number }[];

  constructor(
    activity: TransactionActivity,
    readonly recovery?: SafeRelayrRecovery,
  ) {
    super(
      recovery?.message ??
        `This action already has ${activity.relayrPaymentStatus === "unfunded" ? "published authorizations" : "a submitted payment"}${activity.hash ? ` (${activity.hash})` : activity.relayrPaymentStatus === "unfunded" ? " awaiting reconciliation" : " with an uncertain wallet result"}. Check the existing bundle before authorizing or paying again.`,
    );
    this.name = "RelayrRecoveryError";
    this.activityId = activity.id;
    this.bundleUuid = activity.bundleUuid;
    this.paymentStatus = activity.relayrPaymentStatus;
    this.safeReleaseReason =
      activity.relayrSafeState === "released" ? activity.relayrSafeReleaseReason : undefined;
    this.safeExecutions = (activity.relayrExpectedTransactions ?? []).flatMap((execution) =>
      execution.expectedSafeExecution
        ? [
            {
              chainId: execution.chainId,
              safe: execution.expectedSafeExecution.safe,
              nonce: execution.expectedSafeExecution.nonce,
            },
          ]
        : [],
    );
  }
}

const EXPIRED_QUOTE = "This quote expired. Review the action again for a new quote.";
const UNCHECKED = "Couldn't check the revnet. Try again.";
const FUNDED_ELSEWHERE =
  "Another payment funded this quote. Check again once its calls have run; do not pay again.";
const REPLACED_UNPAID = "This unpaid quote was replaced by a new one. Nothing was paid.";
const REPLACED = "A new quote replaced this one. Pay only the new quote.";
/** A quote whose latest payment reverted: only the SDK's retry rule lets it be paid again. */
const PAYMENT_REVERTED = {
  status: "failed",
  relayrPaymentStatus: "reverted",
  manualVerificationRequired: true,
  message:
    "The original funding transaction reverted onchain. Its destination authorizations remain reserved; retry only the exact saved quote.",
} as const;

/** The SDK's line for a session one of whose old requests can still run, in this app's time format. */
function relayrHeldMessage(until: number): string {
  return sharedHeldMessage(until, { formatTime: formatShortDateTime });
}

/** The SDK's line for a session none of whose requests can run again. */
function discardLine(reason: RelayrDiscardReason): string {
  return relayrDiscardLine(reason, { subject: "revnet" });
}

/**
 * Saved signatures are quoted again only while a quote's payment window (about
 * 10 minutes, with slack) and the SDK's run margin both fit before they expire:
 * otherwise the quote offers no payable option. Past that, they are signed
 * again at their saved nonces.
 */
const REQUOTE_MIN_SECONDS = RELAYR_REQUEST_RUN_MARGIN_SECONDS + 15 * 60;

/** A saved session none of whose requests can run again: Discard ends it. `cause` is why its calls were not proven. */
class RelayrDiscardError extends Error {
  constructor(
    readonly activityId: string,
    readonly reason: RelayrDiscardReason,
    cause?: unknown,
  ) {
    super(discardLine(reason), cause === undefined ? undefined : { cause });
    this.name = "RelayrDiscardError";
  }
}

/** Every saved session is read with the app's public client for its chain. */
function clientFor(config: Config) {
  return (chainId: number) => getPublicClient(config, { chainId: chainId as JBChainId });
}

/**
 * Ruling R114 for a saved session: each request it published at a canonical
 * finalized block on its chain, with the nonce it saved. Null when one of
 * them is not a forward request.
 */
async function savedRequestsVerdict(
  config: Config,
  activity: TransactionActivity,
): Promise<RelayrRequestsVerdict | null> {
  const requests = relayrSessionRequests(activity);
  return requests && relayrRequestsVerdict(await relayrRequestStates(clientFor(config), requests));
}

/** Mark a session for Discard (ruling R114), and the error its action throws until it is discarded. */
function discardableSession(
  activity: TransactionActivity,
  reason: RelayrDiscardReason,
  cause?: unknown,
): RelayrDiscardError {
  updateTransactionActivity(activity.id, {
    status: "failed",
    manualVerificationRequired: true,
    relayrDiscardable: reason,
    message: discardLine(reason),
  });
  return new RelayrDiscardError(activity.id, reason, cause);
}

/** An unsigned routing quote request cannot charge the wallet or authorize another action. */
function unboundRoutingPublication(
  activity: Omit<TransactionActivity, "createdAt" | "updatedAt">,
): boolean {
  if (
    activity.kind !== "relayr-bundle" ||
    activity.status !== "pending" ||
    activity.relayrPaymentStatus !== "unfunded" ||
    !activity.callKey ||
    activity.id !== `relayr-publication:${activity.callKey}` ||
    !activity.relayrExpectedTransactions?.length ||
    (
      [
        "bundleUuid",
        "chainId",
        "relayrQuote",
        "relayrPayment",
        "relayrPayments",
        "hash",
        "executionHash",
        "safeProposalHash",
        "safeProposal",
        "obsoleteSafeNonce",
        "safeResultUnconfirmed",
        "executionSeenAt",
        "relayrNonces",
        "relayrDiscardable",
        "relayrSafeSessionId",
        "relayrSafeState",
        "relayrSafeReleaseReason",
        "relayrSafeReservationKeys",
        "relayrSafeFundingUnknown",
        "relayrSafeFundingObserved",
        "manualVerificationRequired",
        "chainStates",
      ] as const
    ).some((field) => activity[field] !== undefined)
  )
    return false;
  try {
    return activity.relayrExpectedTransactions.every((transaction) => {
      if (
        transaction.transactionUuid !== "" ||
        transaction.value !== "0" ||
        transaction.receiptStatus !== undefined ||
        transaction.expectedSafeExecution !== undefined ||
        transaction.expectedDeployment !== undefined ||
        transaction.expectedPayout !== undefined ||
        transaction.reservedReceipt !== undefined
      )
        return false;
      requireRawPendingRouterCall(
        transaction.chainId,
        transaction.target,
        transaction.data,
        0n,
        transaction.expectedRouterPending,
        transaction.preconditions,
      );
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Whether a session no longer reserves anything: an unbound unsigned routing
 * request needs no recovery, or its quote was proven
 * unfundable onchain or replaced at the same forwarder nonces ("expired"), or
 * every request it published is dead and none ran. One that may have run
 * keeps its calls until it is discarded.
 */
function sessionReleased(activity: TransactionActivity): boolean {
  return (
    unboundRoutingPublication(activity) ||
    activity.relayrPaymentStatus === "expired" ||
    activity.relayrDiscardable === "expired" ||
    activity.relayrDiscardable === "changed"
  );
}

/** The quote a session can still be paid with, by the clock, or undefined. */
function payableQuote(
  activity: TransactionActivity,
  destinationChains: number[],
): RelayrPostBundleResponse | undefined {
  if (!activity.relayrQuote) return undefined;
  try {
    return quoteForDestinationChains(activity.relayrQuote, destinationChains);
  } catch {
    return undefined;
  }
}

/**
 * A raw or Safe bundle has no forwarder nonce. An unpaid one can run only if
 * its quote is paid, so it stops reserving once the deadline of every option
 * of its quote passed at a canonical finalized block, never by the clock, and
 * Relayr, read right before, reports it unpaid with every call pending
 * (ruling R104, as jbm's payer-relayr.ts:457-463): another device may have
 * paid it.
 */
async function releaseUnfundableQuote(
  config: Config,
  activity: TransactionActivity,
  /** The locks its caller holds: its write checks them first. */
  locks: TabLocks = [],
): Promise<boolean> {
  if (activity.relayrPaymentStatus !== "unfunded" || sentPayments(activity).length) return false;
  const { bundleUuid, options, destinationChainIds } = relayrSavedQuote(activity);
  const quoted = relayrQuotedOptions(
    { bundle_uuid: bundleUuid, payment_info: options },
    destinationChainIds,
  );
  if (!quoted.length) return false;
  for (const { details } of quoted) {
    const client = clientFor(config)(details.chainId);
    if (!client || !(await relayrDeadlinePassed(client, details.deadline))) return false;
  }
  if (
    !(await requireRelayrBundleUnpaid(activity.bundleUuid ?? "").then(
      () => true,
      () => false,
    ))
  )
    return false;
  await assertLocksHeld(locks);
  updateTransactionActivity(activity.id, {
    status: "failed",
    relayrPaymentStatus: "expired",
    message:
      "This unpaid quote expired. Nothing was paid; review the action again for a new quote.",
  });
  forgetQuote(activity.bundleUuid);
  return true;
}

/** A paid bundle whose calls are still being proven: it reserves them until they are proven or fail. */
function paidInFlight(activity: TransactionActivity): boolean {
  return (
    (activity.relayrPaymentStatus === "submitted" ||
      activity.relayrPaymentStatus === "confirmed") &&
    activity.status !== "failed"
  );
}

/**
 * Ruling R114 for another saved session that shares a call or a recovery
 * scope with an action about to sign (R114 (g)): different calls never sign
 * at its nonces while one of its requests can still run. A live session
 * holds the action, saying until when, and a paid bundle still running keeps
 * its own refusal. Once every request is dead, whatever Relayr reports, the
 * session reserves nothing more and is marked for Discard, and one that may
 * have run refuses the action with its line until it is discarded
 * (R114 (f)). Resolves "reserved" while it can't be classified.
 */
async function reservationOf(
  config: Config,
  activity: TransactionActivity,
  locks: TabLocks = [],
): Promise<"released" | "reserved"> {
  if (activity.relayrDiscardable === "ran") throw new RelayrDiscardError(activity.id, "ran");
  const verdict = await savedRequestsVerdict(config, activity);
  if (!verdict)
    return (await releaseUnfundableQuote(config, activity, locks)) ? "released" : "reserved";
  if (verdict.live) {
    if (paidInFlight(activity)) return "reserved";
    throw new Error(relayrHeldMessage(verdict.until));
  }
  const outcome = await relayrSessionOutcome(verdict, { nonces: activity.relayrNonces });
  if (outcome.kind !== "discard") throw new Error(relayrHeldMessage(0));
  await assertLocksHeld(locks);
  const discard = discardableSession(activity, outcome.reason);
  if (outcome.reason === "ran") throw discard;
  return "released";
}

/**
 * The saved nonce each chain's request of `session` was signed with. Throws,
 * holding, when one can't be read.
 */
function savedNonces(session: TransactionActivity): Map<number, bigint> {
  const nonces = new Map<number, bigint>();
  session.relayrExpectedTransactions?.forEach(({ chainId }, index) => {
    const saved = session.relayrNonces?.[index];
    if (!saved || !/^\d+$/.test(saved)) throw new Error(relayrHeldMessage(0));
    nonces.set(chainId, BigInt(saved));
  });
  return nonces;
}

/** Stop offering a session's quote for payment. */
function forgetQuote(bundleUuid: string | undefined): void {
  if (!bundleUuid) return;
  for (const [key, quote] of quotes)
    if (quote.bundleUuid.toLowerCase() === bundleUuid.toLowerCase()) quotes.delete(key);
}

/**
 * A new publication carries these sessions' calls: their published
 * signatures under a new quote, or new signatures at their saved nonces once
 * every request they published is dead. They are never paid from here, the
 * new session reserves what they did, and there is nothing left to discard.
 */
function supersede(sessions: TransactionActivity[]): void {
  for (const session of sessions) {
    updateTransactionActivity(session.id, {
      status: "failed",
      relayrPaymentStatus: "expired",
      manualVerificationRequired: false,
      relayrDiscardable: undefined,
      message: sentPayments(session).length ? REPLACED : REPLACED_UNPAID,
    });
    forgetQuote(session.bundleUuid);
  }
}

/** Conservative synchronous gate: any retained session keeps draft replacement unavailable. */
export function hasRelayrRecoveryScopeSession(account: Address, scope: string): boolean {
  return refreshTransactionActivities().some(
    (activity) =>
      activity.relayrCallKeys?.includes(scopeKey(account, scope)) && !sessionReleased(activity),
  );
}

/** Requires retained canonical expiry evidence and no trace of a funding attempt. */
export function isReleasedUnpaidRelayrBundle(account: Address, bundleUuid: string): boolean {
  const sessions = refreshTransactionActivities().filter(
    (activity) =>
      activity.account?.toLowerCase() === account.toLowerCase() &&
      activity.bundleUuid?.toLowerCase() === bundleUuid.toLowerCase(),
  );
  return (
    sessions.length > 0 &&
    sessions.every(
      (activity) =>
        sessionReleased(activity) &&
        !activity.hash &&
        !sentPayments(activity).length &&
        activity.relayrPaymentStatus !== "submitted" &&
        activity.relayrPaymentStatus !== "confirmed",
    )
  );
}

/**
 * A changed payload or direct route must not bypass a published operation
 * (rulings R114 (g) and R117): a session in `scope` reserves it while one of
 * its requests can still run, saying until when, and one that may have run
 * until it is discarded.
 */
export async function requireRelayrRecoveryScopeAvailable(
  account: Address,
  scope: string,
): Promise<void> {
  requireTransactionActivityPersistence();
  const key = scopeKey(account, scope);
  const reserving = refreshTransactionActivities().filter(
    (activity) =>
      activity.relayrCallKeys?.includes(key) &&
      (activity.status !== "success" || activity.manualVerificationRequired) &&
      !sessionReleased(activity),
  );
  if (!reserving.length) return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  for (const activity of reserving) {
    if ((await reservationOf(wagmiConfig, activity)) === "reserved")
      throw new ReviewRefusal(
        scope === "revnet-launch"
          ? "A previous launch still requires reconciliation. Check its existing bundle in account activity before requesting another launch; do not sign or pay again."
          : "A previous update for this destination still requires reconciliation. Check its existing bundle in account activity before submitting another update; do not sign or pay again.",
      );
  }
}

function forwarderNonceKey(key: string): boolean {
  return key.includes(":relayr-scope:forwarder-nonce:");
}

/**
 * No other saved session may run, or may have run, what this quote runs
 * (rulings R114 and R117). One that shares only a forwarder nonce reserves it
 * while one of its requests can still run (relayrRequestsDead); one that
 * shares a call or a recovery scope is classified by reservationOf. `exempt`
 * names the session this action continues.
 */
async function requireUnfunded(
  config: Config,
  quote: Pick<RememberedQuote, "bundleUuid" | "callKey" | "callKeys">,
  exempt?: string,
  /** The locks its caller holds: a session it releases is written only under them. */
  locks: TabLocks = [],
): Promise<void> {
  requireTransactionActivityPersistence();
  if (fundedBundles.has(quote.bundleUuid))
    throw new Error(
      "This action already has a submitted payment. Do not pay again; check the existing bundle.",
    );
  const activities = refreshTransactionActivities();
  // A quote that expired, was replaced or was marked for Discard is never paid.
  if (
    activities.some(
      (activity) =>
        activity.bundleUuid === quote.bundleUuid &&
        (activity.relayrPaymentStatus === "expired" ||
          isRelayrDiscardReason(activity.relayrDiscardable)),
    )
  )
    throw new Error(EXPIRED_QUOTE);
  for (const existing of activities) {
    // Legacy journals predate semantic keys. Derive their Safe reservations from
    // frozen identities so extra owner signatures cannot hide an overlapping nonce.
    const existingKeys = [
      ...(existing.relayrCallKeys ?? []),
      ...(existing.account
        ? (existing.relayrExpectedTransactions ?? []).flatMap((transaction) =>
            transaction.expectedSafeExecution
              ? [
                  safeNonceCallKey(
                    existing.account!,
                    transaction.chainId,
                    transaction.expectedSafeExecution,
                  ),
                ]
              : [],
          )
        : []),
    ];
    const shared = existingKeys.filter((key) => quote.callKeys.includes(key));
    if (
      existing.id === exempt ||
      !(
        existing.bundleUuid === quote.bundleUuid ||
        ((existing.callKey === quote.callKey || shared.length) && existing.status !== "success")
      ) ||
      (existing.bundleUuid === quote.bundleUuid && existing.relayrPaymentStatus === "unfunded") ||
      (existing.bundleUuid === quote.bundleUuid && existing.relayrPaymentStatus === "reverted") ||
      sessionReleased(existing)
    )
      continue;
    const nonceOnly =
      existing.bundleUuid !== quote.bundleUuid &&
      existing.callKey !== quote.callKey &&
      shared.every(forwarderNonceKey);
    if (nonceOnly) {
      if (existing.relayrDiscardable === "ran") continue;
      if (await relayrRequestsDead(clientFor(config), relayrSessionRequests(existing))) continue;
    } else if (
      existing.bundleUuid !== quote.bundleUuid &&
      (await reservationOf(config, existing, locks)) === "released"
    )
      continue;
    throw new RelayrRecoveryError(existing);
  }
}

/**
 * Sessions saved before the nonce scope keys reserve their signer's forwarder
 * nonce through their exact outer targets. Each reserves it while one of its
 * requests can still run (ruling R117).
 */
async function requireForwarderNoncesFree(
  config: Config,
  account: Address,
  forwarded: ReviewedRelayrRequest[],
  exempt: string[],
): Promise<void> {
  for (const activity of refreshTransactionActivities()) {
    if (
      exempt.includes(activity.id) ||
      activity.account?.toLowerCase() !== account.toLowerCase() ||
      !(activity.status !== "success" || activity.manualVerificationRequired) ||
      sessionReleased(activity) ||
      activity.relayrDiscardable === "ran" ||
      !activity.relayrExpectedTransactions?.some((expected) =>
        forwarded.some(
          (request) =>
            request.chainId === expected.chainId &&
            expected.target.toLowerCase() ===
              jbContractAddress[request.version ?? 6].ERC2771Forwarder[
                request.chainId
              ]?.toLowerCase(),
        ),
      )
    )
      continue;
    if (await relayrRequestsDead(clientFor(config), relayrSessionRequests(activity))) continue;
    throw new Error(
      "This signer and destination forwarder already has published authorizations awaiting reconciliation. Complete the original bundle before authorizing a different operation.",
    );
  }
}

/** Each forwarded request with the client and forwarder of its chain. */
function forwardedTargets(config: Config, requests: ReviewedRelayrRequest[]) {
  return requests
    .filter((request) => request.relayrMode !== "raw" && request.relayrMode !== "safe-exec")
    .map((request) => {
      const client = getPublicClient(config, { chainId: request.chainId });
      const forwarder = jbContractAddress[request.version ?? 6].ERC2771Forwarder[request.chainId];
      if (!client || !forwarder)
        throw new Error(`Bundled execution is unavailable on chain ${request.chainId}.`);
      return { request, client, forwarder };
    });
}

/**
 * The action's own proof that its calls still apply (ruling R114): each
 * destination's reviewed source and preconditions, and each call run from the
 * forwarder with the signer appended, against live state. Throws when one no
 * longer applies.
 */
async function recheck(
  targets: ReturnType<typeof forwardedTargets>,
  account: Address,
): Promise<void> {
  for (const { request, client, forwarder } of targets) {
    if (request.metadataSource) await verifyMetadataSource(client, request.metadataSource, account);
    await verifyCallPreconditions(client, request.preconditions);
    await simulateForwardedCall(client, forwarder, account, request);
  }
}

/**
 * A live session's saved signatures still apply (jbm verifyForwardedEntries,
 * relayr.ts:837-857): each is this account's forward request for its value,
 * the action's recheck passes, and the exact signed outer call runs. Resolves
 * whether they can be quoted again: true while more than REQUOTE_MIN_SECONDS
 * is left before each expires, and false when they must be signed again at
 * their saved nonces instead (R114 (a)).
 */
async function requireSavedSignaturesRun(
  config: Config,
  account: Address,
  saved: TransactionActivity,
  requests: ReviewedRelayrRequest[],
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1_000);
  let quotable = true;
  for (const transaction of saved.relayrExpectedTransactions ?? []) {
    const request = relayrForwardRequest({
      chain: transaction.chainId,
      target: transaction.target,
      data: transaction.data,
    });
    if (
      !request ||
      request.from.toLowerCase() !== account.toLowerCase() ||
      request.value !== BigInt(transaction.value)
    )
      throw new Error("The saved authorization can't be quoted again.");
    if (request.deadline <= now + REQUOTE_MIN_SECONDS) quotable = false;
  }
  await recheck(forwardedTargets(config, requests), account);
  if (!quotable) return false;
  await revalidateSignedCalls(config, account, saved.relayrExpectedTransactions ?? []);
  return true;
}

/**
 * Relayr reports a payment for the bundle, or a call running or run. The poll of a quote whose own
 * payment reverted reads it from the bundle it just fetched: another payment is the only way such a
 * quote's calls run.
 */
function relayrBundleFunded(bundle: RelayrBundle): boolean {
  const records = Array.isArray(bundle.transactions)
    ? (bundle.transactions as RelayrTransactionRecord[])
    : [];
  return (
    bundle.payment_received === true ||
    records.some(
      (record) =>
        relayrDestinationHash(record) !== null ||
        typeof record?.status?.state !== "string" ||
        record.status.state.trim().toLowerCase() !== "pending",
    )
  );
}

/** How an action goes on from its own saved session. */
type Continuation =
  /** Pay the saved quote. */
  | { kind: "quote"; quote: RelayrPostBundleResponse }
  /** Quote the saved signatures again. */
  | { kind: "requote" }
  /**
   * Sign the calls again at the saved nonces: once every request is dead, or,
   * with `until`, while they are live but too close to expiry to quote.
   */
  | { kind: "sign"; until?: number }
  /** A raw or Safe bundle whose quote can no longer be paid: quote the calls anew. */
  | { kind: "fresh" };

/**
 * Ruling R114 for an action's own saved session (as jbm's executeRelayrCalls,
 * relayr.ts:1867-1953): its requests are classified at a canonical finalized
 * block before the action's recheck, since a request that ran would make the
 * recheck refuse. While one can still run, the session holds when one may
 * have run, and otherwise pays its saved quote or quotes its saved signatures
 * again once they still run. A quote whose payment reverted is first read
 * for another payer (R104). Once every request is dead, relayrSessionOutcome
 * decides: sign the calls again at the saved nonces after the recheck passes,
 * Discard, or hold. Null while a paid bundle can still run, which the
 * reservation checks refuse.
 */
async function continueSession(
  config: Config,
  account: Address,
  saved: TransactionActivity,
  requests: ReviewedRelayrRequest[],
  chains: number[],
  locks: TabLocks,
): Promise<Continuation | null> {
  const verdict = await savedRequestsVerdict(config, saved);
  // A paid bundle still running is the reservation checks' to refuse while one of
  // its requests can still run; once every one is dead, Relayr's state no longer
  // matters (R114 (c)).
  if (paidInFlight(saved) && verdict?.live !== false) return null;
  let released = false;
  if (saved.relayrPaymentStatus === "reverted" && verdict?.live !== false) {
    const savedQuote = relayrSavedQuote(saved);
    let state: Awaited<ReturnType<typeof revertedRelayrQuote>>["state"];
    try {
      ({ state } = await revertedRelayrQuote(clientFor(config), savedQuote));
    } catch (error) {
      // Its release is unproven while an old request can still run: it holds, saying until when.
      throw verdict?.live ? new Error(relayrHeldMessage(verdict.until), { cause: error }) : error;
    }
    if (state === "funded") {
      // What Relayr ran is proven from the chain; the quote is never paid again.
      void waitForRelayrBundle(saved.bundleUuid!).catch(() => undefined);
      throw new Error(FUNDED_ELSEWHERE);
    }
    if (state === "payable") {
      const quote = payableQuote(saved, chains);
      if (!quote) throw new Error(EXPIRED_QUOTE);
      // It is paid again with the option its latest payment used. A quote that no longer offers
      // that option is held: relayrRetryOption throws.
      relayrRetryOption(savedQuote.payments, quote.payment_info);
      return { kind: "quote", quote };
    }
    released = true;
  } else if (saved.relayrPaymentStatus !== "unfunded" && verdict?.live !== false) {
    // A paid bundle whose calls are not proven, or a quote the device clock
    // expired before sessions saved their nonces, holds while one can still run.
    if (verdict?.live) throw new Error(relayrHeldMessage(verdict.until));
    return null;
  }
  const quote = !released && payableQuote(saved, chains);
  if (!verdict) {
    if (quote) return { kind: "quote", quote };
    return released || (await releaseUnfundableQuote(config, saved, locks))
      ? { kind: "fresh" }
      : null;
  }
  if (verdict.live) {
    if (verdict.mayHaveRun) throw new Error(relayrHeldMessage(verdict.until));
    if (quote) return { kind: "quote", quote };
    let quotable: boolean;
    try {
      quotable = await requireSavedSignaturesRun(config, account, saved, requests);
    } catch (error) {
      throw new Error(relayrHeldMessage(verdict.until), { cause: error });
    }
    // None ran, and the forwarder runs one request per nonce: a new signature at the
    // saved nonce and the old one can never both run.
    return quotable ? { kind: "requote" } : { kind: "sign", until: verdict.until };
  }
  // Every request is dead, so none can run again whatever Relayr reports.
  const targets = forwardedTargets(config, requests);
  const outcome = await relayrSessionOutcome(verdict, {
    nonces: saved.relayrNonces,
    recheck: () => recheck(targets, account),
  });
  if (outcome.kind === "re-sign") return { kind: "sign" };
  if (outcome.kind === "discard") {
    await assertLocksHeld(locks);
    throw discardableSession(saved, outcome.reason, outcome.error);
  }
  if (outcome.kind === "unchecked") throw new Error(UNCHECKED, { cause: outcome.error });
  throw new Error(relayrHeldMessage(0));
}

/**
 * An action's saved session: the newest one for exactly its calls that is not
 * settled. A quote the device clock expired before sessions saved their
 * nonces is one while it has forward requests: they may still run, or may
 * have run, so its calls are never signed again at the live nonce.
 */
function safeNonceCallKey(
  account: Address,
  chainId: number,
  expected: ExpectedSafeExecution,
): string {
  return scopeKey(
    account,
    `safe-execution:${safeRelayrReservationKey({ entry: { chain: chainId, target: expected.safe, data: "0x", value: "0" }, ...expected })}`,
  );
}

function safeRecoveryError(cause: unknown): unknown {
  if (!(cause instanceof SafeRelayrRecoveryError)) return cause;
  const activity = safeRelayrActivity(cause.session);
  if (!activity) return cause;
  const recovery = new RelayrRecoveryError(activity, cause.recovery);
  recovery.message = cause.message;
  return recovery;
}

function savedSessionOf(account: Address, callKey: string): TransactionActivity | undefined {
  const saved = refreshTransactionActivities()
    .filter(
      (activity) =>
        activity.kind === "relayr-bundle" &&
        activity.callKey === callKey &&
        activity.account?.toLowerCase() === account.toLowerCase() &&
        !!activity.relayrExpectedTransactions?.length &&
        !unboundRoutingPublication(activity) &&
        (activity.status !== "success" || activity.manualVerificationRequired),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return saved?.relayrPaymentStatus === "expired" &&
    (saved.relayrNonces || !relayrSessionRequests(saved))
    ? undefined
    : saved;
}

/**
 * The account view's check of a saved session that awaits its payment
 * (ruling R114 (e)): its requests are classified at a canonical finalized
 * block with no recheck, since only its action can run one. Once every one
 * is dead it is marked for Discard, as "expired" when none ran (its action
 * still signs them again at their saved nonces); while one can still run it
 * says until when.
 */
export async function checkRelayrSession(
  id: string,
  signal?: AbortSignal,
): Promise<SafeRelayrResult | undefined> {
  const activity = refreshTransactionActivities().find((row) => row.id === id);
  if (!activity) return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const safeSession = safeRelayrSession(activity);
  const key = safeSessionKey(activity);
  if (safeSession && key) {
    try {
      const result = await safeBundleController(wagmiConfig, key).check({
        signal,
        account: safeSession.account,
        sessionId: safeSession.id,
      });
      if (result.state === "pending")
        updateTransactionActivity(activity.id, {
          message:
            result.recovery?.message ??
            "The existing Safe bundle is still awaiting confirmation. Check it again before authorizing or paying again.",
        });
      return result;
    } catch (cause) {
      throw safeRecoveryError(cause);
    }
  }
  const verdict = await savedRequestsVerdict(wagmiConfig, activity);
  if (!verdict) {
    if (await releaseUnfundableQuote(wagmiConfig, activity)) return;
    if (!activity.bundleUuid) throw new RelayrRecoveryError(activity);
    const expected = expectedBundleTransactions(activity.bundleUuid);
    const bundle = await fetchBundle(activity.bundleUuid);
    verifyBundleIdentity(activity.bundleUuid, bundle, expected);
    if (
      bundle.transactions.length &&
      bundle.transactions.every((transaction) => relayrStateIsSuccess(transaction.status?.state))
    ) {
      await verifyDestinationReceipts(bundle, expected);
      updateTransactionActivity(id, {
        status: "success",
        manualVerificationRequired: false,
        relayrExpectedTransactions: expected,
        chainStates: bundleChainStates(bundle),
        message: "All saved destination transactions confirmed. Refresh the Safe queue.",
      });
    } else {
      updateTransactionActivity(id, {
        message: relayrBundleFunded(bundle)
          ? "This existing bundle has funding or execution activity. Its destinations are not all confirmed; do not pay again."
          : "This existing quote is still unpaid and reserved. Resume its original complete selection, or check again after its payment deadlines expire.",
        chainStates: bundleChainStates(bundle),
      });
    }
    return;
  }
  const outcome = await relayrSessionOutcome(verdict, { nonces: activity.relayrNonces });
  if (outcome.kind === "discard") discardableSession(activity, outcome.reason);
  // A paid bundle still running keeps its own line while a request can run.
  else if (
    !paidInFlight(activity) &&
    (outcome.kind === "hold" || outcome.kind === "refresh" || outcome.kind === "reorg-hold")
  )
    updateTransactionActivity(id, {
      message: relayrHeldMessage(outcome.kind === "reorg-hold" ? 0 : outcome.until),
    });
}

/**
 * Discard a session marked for it (ruling R114): every request it published
 * is dead. Only the session goes, never what its action saved. A pending
 * batch round holds the session by its bundle, or, when Relayr never named
 * one because the quote response was lost, by its calls' recovery scopes (as
 * jbm's project-batch.ts:114-137 links a round by its scope). After a "ran"
 * Discard, such a batch is abandoned, so its calls go out again only after a
 * fresh review (R114 (f)); after another, its round quotes again.
 */
export function discardRelayrSession(id: string): void {
  requireTransactionActivityPersistence();
  const activity = refreshTransactionActivities().find((row) => row.id === id);
  if (!activity || !isRelayrDiscardReason(activity.relayrDiscardable))
    throw new Error("Only an action whose earlier signatures can no longer run can be discarded.");
  endRelayrSession(activity, activity.relayrDiscardable === "ran");
}

/** The session goes, never what its action saved; `ran`: its batch is reviewed again. */
function endRelayrSession(activity: TransactionActivity, ran: boolean): void {
  const keys = new Set(activity.relayrCallKeys ?? []);
  const bundleUuid = activity.bundleUuid?.toLowerCase();
  const holds = (batch: MultichainBatch, round: BatchRound) =>
    bundleUuid
      ? round.bundleUuid?.toLowerCase() === bundleUuid
      : round.indices.some(
          (index) =>
            !!batch.calls[index] &&
            keys.has(scopeKey(batch.account, batchCallScope(batch, batch.calls[index], index))),
        );
  for (const batchId of releaseBatchRound(holds, ran))
    updateTransactionActivity(batchId, {
      status: "failed",
      manualVerificationRequired: false,
      message: "This batch was discarded. Review it again.",
    });
  forgetQuote(activity.bundleUuid);
  dismissTransactionActivity(activity.id);
}

/**
 * A saved session as the SDK's saved-attempt recovery reads it, for when its own check can't show
 * what became of it: held by the session's id, with the session row's strict re-read as the final
 * say before the user's check retires it.
 */
function relayrAttemptOf(activity: TransactionActivity, reason: string): SavedAttempt<never> {
  return {
    chainId: activity.chainId ?? activity.chainStates?.[0]?.chainId ?? 1,
    account: activity.account!,
    namespaces: [writeIntentKey("relayr-session", { id: activity.id })],
    saved: { started: true },
    authenticate: async () => ({ result: "unknown", reason }),
    confirmRetirable: async () => {
      // A strict, fresh read: storage that can't be read throws, and refuses.
      requireTransactionActivityPersistence();
      const now = refreshTransactionActivities().find((row) => row.id === activity.id);
      return !!now && now.status !== "success";
    },
  };
}

/**
 * When a saved session's check can't show it (an unreadable record, unavailable evidence), the
 * SDK's one check: its line, warning and the "I checked it" action, never a dead end.
 */
export async function relayrSessionCheck(
  id: string,
  cause: unknown,
): Promise<SavedAttemptCheck | undefined> {
  const activity = refreshTransactionActivities().find((row) => row.id === id);
  if (!activity?.account) return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const attempt = relayrAttemptOf(activity, cause instanceof Error ? cause.message : String(cause));
  const client = getPublicClient(wagmiConfig, { chainId: attempt.chainId as never });
  if (!client) return;
  const outcome = await savedAttempts.recover(attempt, client as unknown as WriteHoldClient);
  return outcome.status === "check" ? outcome : undefined;
}

/**
 * The user's check of a saved session that can't be shown: retired through the SDK for every tab
 * and reload, then the session goes as one that may have run, so its action is reviewed again.
 */
export async function retireCheckedRelayrSession(
  id: string,
  outcome: SavedAttemptCheck,
  force?: "unreadable",
): Promise<SavedAttemptRetired> {
  const activity = refreshTransactionActivities().find((row) => row.id === id);
  if (!activity?.account) return { retired: false };
  const retired = await savedAttempts.retire(relayrAttemptOf(activity, outcome.reason), {
    by: "check",
    outcome,
    ...(force ? { force } : {}),
  });
  if (retired.retired) endRelayrSession(activity, true);
  return retired;
}

/** After an in-flow Discard of a session that may have run, the action is reviewed again. */
const DISCARDED = "Discarded. Review it again.";

/**
 * A flow offers Discard itself (C13), not only account activity. A session
 * none of whose requests ran ("changed", "expired") is discarded at once, and
 * its line stays. One that may have run asks first: Discard ends it and the
 * action stops for a fresh review, never sending the same calls on its own.
 */
async function discardInFlow(cause: unknown): Promise<unknown> {
  if (!(cause instanceof RelayrDiscardError)) return cause;
  if (cause.reason === "ran" && !(await confirmRelayrDiscard())) return cause;
  try {
    discardRelayrSession(cause.activityId);
  } catch (error) {
    return cause.reason === "ran" ? error : cause;
  }
  return cause.reason === "ran" ? new Error(DISCARDED) : cause;
}

/**
 * Ruling R114 for a paid bundle whose calls are not proven (as jbm's
 * holdUnprovenSession, relayr.ts:1470-1480): it keeps reserving them while a
 * request can still run, and once every one is dead it is marked for Discard,
 * as "expired" when none ran (a forwarder execute that reverts leaves its
 * nonce unused, so its action signs it again) and "ran" when one may have.
 */
async function holdUnprovenSession(activityId: string): Promise<void> {
  const activity = refreshTransactionActivities().find((row) => row.id === activityId);
  if (!activity || activity.relayrPaymentStatus === "reverted") return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const verdict = await savedRequestsVerdict(wagmiConfig, activity);
  if (verdict?.live !== false) return;
  const outcome = await relayrSessionOutcome(verdict, { nonces: activity.relayrNonces });
  if (outcome.kind === "discard") discardableSession(activity, outcome.reason);
}

function quoteForDestinationChains(
  quote: RelayrPostBundleResponse,
  destinationChains: number[],
): RelayrPostBundleResponse {
  const payments = quote.payment_info.filter((payment) =>
    areRelayrChainsCompatible([...destinationChains, payment.chain]),
  );
  if (!payments.length)
    throw new Error("No funding option is available for the selected mainnet or testnet family.");
  payments.forEach((payment) =>
    relayrPaymentDetails(payment, {
      bundleUuid: quote.bundle_uuid,
      destinationChainIds: destinationChains,
    }),
  );
  // Recovery quotes must not share nested payment objects with caller-owned
  // responses. A later UI update cannot rewrite the already published fee.
  return structuredClone({ ...quote, payment_info: payments });
}

type Config = ReturnType<typeof useConfig>;

/**
 * The gas a forward request signs: the destination call simulated through the forwarder, then the
 * larger of its measured gas with headroom and the request's own.
 */
export async function forwardedRequestGas(
  client: NonNullable<ReturnType<typeof getPublicClient>>,
  forwarder: Address,
  account: Address,
  request: Pick<ReviewedRelayrRequest, "data">,
): Promise<bigint> {
  await simulateForwardedCall(client, forwarder, account, request);
  const measured = gasWithHeadroom(
    await client.estimateGas({
      account: forwarder,
      stateOverride: [{ address: forwarder, balance: maxUint256 }],
      to: request.data.to,
      value: request.data.value,
      data: `${request.data.data}${account.slice(2).toLowerCase()}` as Hex,
    }),
  );
  return measured > request.data.gas ? measured : request.data.gas;
}

/**
 * The destination trusts the forwarder, and its call runs from the forwarder
 * with `account` appended as ERC-2771's sender against live state.
 */
async function simulateForwardedCall(
  client: NonNullable<ReturnType<typeof getPublicClient>>,
  forwarder: Address,
  account: Address,
  request: Pick<ReviewedRelayrRequest, "data">,
): Promise<void> {
  const trusted = await client.readContract({
    address: request.data.to,
    abi: TRUSTED_FORWARDER_ABI,
    functionName: "isTrustedForwarder",
    args: [forwarder],
  });
  if (trusted !== true)
    throw new Error(
      "The destination contract does not trust this forwarder. Use a direct transaction.",
    );
  await client.call({
    account: forwarder,
    stateOverride: [{ address: forwarder, balance: maxUint256 }],
    to: request.data.to,
    value: request.data.value,
    data: `${request.data.data}${account.slice(2).toLowerCase()}` as Hex,
  });
}

/**
 * Re-run the exact signed outer calls against live state, so consumed nonces,
 * expired signatures, changed permissions and destination reverts are refused.
 */
async function revalidateSignedCalls(
  config: Config,
  account: Address,
  expectedTransactions: RelayrExpectedTransaction[],
): Promise<void> {
  await mapConcurrentChecks(expectedTransactions, async (expected) => {
    const client = getPublicClient(config, { chainId: expected.chainId as JBChainId });
    if (!client || !expected.gas)
      throw new Error("The signed destination call cannot be revalidated. Do not pay this quote.");
    if (expected.metadataSource)
      await verifyMetadataSource(client, expected.metadataSource, account);
    await verifyCallPreconditions(client, expected.preconditions);
    if (expected.expectedRouterPending) {
      requireRawPendingRouterCall(
        expected.chainId,
        expected.target,
        expected.data,
        BigInt(expected.value),
        expected.expectedRouterPending,
        expected.preconditions,
      );
      await simulatePendingRouterCall(client, {
        from: account,
        to: expected.target,
        data: expected.data,
        gas: BigInt(expected.gas),
      });
      return;
    }
    await client.call({
      account,
      to: expected.target,
      data: expected.data,
      value: BigInt(expected.value),
      gas: BigInt(expected.gas),
      stateOverride: [{ address: account, balance: maxUint256 }],
    });
  });
}

class RelayrVerificationError extends Error {}

function expectedBundleTransactions(bundleUuid: string): RelayrExpectedTransaction[] {
  const expected = transactionActivitySnapshot().find(
    (activity) => activity.bundleUuid === bundleUuid,
  )?.relayrExpectedTransactions;
  if (
    !expected?.length ||
    new Set(expected.map((item) => item.transactionUuid)).size !== expected.length
  )
    throw new RelayrVerificationError(
      "The signed destination calls for this bundle are unavailable. Its execution cannot be verified; do not pay again.",
    );
  return expected;
}

function verifyBundleIdentity(
  bundleUuid: string,
  bundle: RelayrGetBundleResponse,
  expected: RelayrExpectedTransaction[],
): void {
  if (
    typeof bundle.bundle_uuid !== "string" ||
    bundle.bundle_uuid.toLowerCase() !== bundleUuid.toLowerCase() ||
    !Array.isArray(bundle.transactions) ||
    bundle.transactions.length !== expected.length
  )
    throw new RelayrVerificationError(
      "The quote response does not match the signed bundle and destination count. Do not pay again.",
    );
  // The quote binder authenticated each UUID against its exact request.
  // Retain that binding when repeated-chain results arrive in any order.
  const quotedIds = new Set(expected.map((item) => item.transactionUuid));
  const seenIds = new Set<string>();
  for (const transaction of bundle.transactions) {
    const request = transaction.request;
    const identity = expected.find((item) => item.transactionUuid === transaction.tx_uuid);
    let value: bigint | undefined;
    try {
      value = BigInt(request?.value);
    } catch {
      /* Invalid API data fails identity verification below. */
    }
    if (
      !identity ||
      request.chain !== identity.chainId ||
      !quotedIds.has(transaction.tx_uuid) ||
      seenIds.has(transaction.tx_uuid) ||
      request.target?.toLowerCase() !== identity.target.toLowerCase() ||
      request.data?.toLowerCase() !== identity.data.toLowerCase() ||
      value !== BigInt(identity.value)
    )
      throw new RelayrVerificationError(
        "The destination call does not match the signed request. Do not pay again.",
      );
    seenIds.add(transaction.tx_uuid);
  }
}

async function verifyDestinationReceipts(
  bundle: RelayrGetBundleResponse,
  expected: RelayrExpectedTransaction[],
  onVerified?: (result: RelayrDestinationProgress) => void,
): Promise<void> {
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  for (const transaction of bundle.transactions) {
    const hash = relayrDestinationHash(transaction);
    if (!hash)
      throw new RelayrVerificationError(
        "Completion was reported without a destination transaction hash. Do not pay again.",
      );
    const identity = expected.find((item) => item.transactionUuid === transaction.tx_uuid)!;
    const client = getPublicClient(wagmiConfig, { chainId: identity.chainId as JBChainId });
    if (!client) throw new Error("The destination RPC is unavailable.");
    const [onchain, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    if (
      onchain.hash.toLowerCase() !== hash.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      onchain.to?.toLowerCase() !== identity.target.toLowerCase() ||
      onchain.input.toLowerCase() !== identity.data.toLowerCase() ||
      onchain.value !== BigInt(identity.value) ||
      receipt.to?.toLowerCase() !== identity.target.toLowerCase() ||
      onchain.blockHash !== receipt.blockHash ||
      onchain.blockNumber !== receipt.blockNumber
    )
      throw new RelayrVerificationError(
        "The onchain destination transaction does not match the signed request. Do not pay again.",
      );
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw new Error("Destination receipt is not in the current canonical chain.");
    if (receipt.status === "reverted" && identity.expectedRouterPending) {
      identity.receiptStatus = "reverted";
      onVerified?.({ transactionUuid: transaction.tx_uuid, hash, status: "reverted" });
      continue;
    }
    if (receipt.status !== "success")
      throw new RelayrVerificationError(
        "A destination transaction reverted onchain. Review the original bundle before attempting recovery.",
      );
    try {
      await verifyActionReceipt(
        client,
        receipt,
        identity.target,
        identity.expectedDeployment,
        identity.rejectEvents,
        identity.reservedReceipt,
        identity.expectedPayout,
        identity.expectedRouterPending,
      );
    } catch (cause) {
      throw new RelayrVerificationError(
        cause instanceof Error
          ? cause.message
          : "The destination action result could not be verified.",
      );
    }
    identity.receiptStatus = "success";
    onVerified?.({ transactionUuid: transaction.tx_uuid, hash, status: "confirmed" });
  }
}

/**
 * Prove a bundle's latest payment from the chain with the SDK, under the hash
 * it was mined: the exact reviewed payment from the session's account,
 * canonically included and successful. A canonical revert leaves the quote to
 * the SDK's retry rule; another transaction at that hash is never paid again.
 * A proof the SDK cannot make for now (no RPC for the chain, a read that
 * failed) throws, so the caller keeps checking.
 */
async function provePayment(bundleUuid: string, locks: TabLocks = []): Promise<void> {
  const activity = transactionActivitySnapshot().find((item) => item.bundleUuid === bundleUuid);
  if (!activity?.account || !sentPayments(activity).length)
    throw new RelayrVerificationError(
      "The original funding transaction cannot be verified. Do not pay again; inspect the existing bundle and wallet activity.",
    );
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const update = fence(locks, updateTransactionActivity);
  let proven: boolean;
  // Core tells of a revert without awaiting: it is written, under the locks, once the proof returns.
  let reverted = false;
  try {
    proven = await proveSavedRelayrPayment(
      clientFor(wagmiConfig),
      relayrSavedQuote(activity).payments,
      activity.account,
      () => {
        fundedBundles.delete(bundleUuid);
        reverted = true;
      },
    );
  } catch (error) {
    if (error instanceof RelayrProofError) throw new RelayrVerificationError(error.message);
    throw error;
  } finally {
    if (reverted) await update(activity.id, PAYMENT_REVERTED);
  }
  if (!proven) throw new Error("The funding RPC is unavailable.");
  await update(activity.id, { relayrPaymentStatus: "confirmed" });
}

/** Never from a cache: a stale answer could hide a payment or a destination result. */
async function fetchBundle(bundleUuid: string): Promise<RelayrGetBundleResponse> {
  const response = await fetch(`${RELAYR_API}/v1/bundle/${bundleUuid}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Transaction bundle check failed (${response.status}).`);
  return response.json();
}

function bundleSummary(bundle: RelayrGetBundleResponse): string {
  return bundle.transactions
    .map((transaction) => {
      const hash = relayrDestinationHash(transaction);
      return `Chain ${transaction.request.chain}: ${transaction.status?.state ?? "Pending"}${hash ? ` (${hash})` : ""}`;
    })
    .join(" | ");
}

function bundleChainStates(bundle: RelayrGetBundleResponse) {
  return bundle.transactions.map((transaction) => ({
    chainId: Number(transaction.request.chain),
    status: transaction.status?.state ?? "Pending",
    hash: relayrDestinationHash(transaction) ?? undefined,
  }));
}

export async function waitForRelayrBundle(
  bundleUuid: string,
  onUpdate?: (bundle: RelayrGetBundleResponse) => void,
  onResults?: DestinationResultsListener,
): Promise<RelayrGetBundleResponse> {
  const listeners =
    bundleListeners.get(bundleUuid) ?? new Set<(bundle: RelayrGetBundleResponse) => void>();
  if (onUpdate) listeners.add(onUpdate);
  bundleListeners.set(bundleUuid, listeners);
  const unsubscribeResults = subscribeDestinationResults(bundleUuid, onResults);
  const unsubscribe = () => {
    if (onUpdate) listeners.delete(onUpdate);
    unsubscribeResults();
  };
  const notify = (bundle: RelayrGetBundleResponse) =>
    listeners.forEach((listener) => listener(bundle));
  const existing = bundleInflight.get(bundleUuid);
  if (existing) return existing.finally(unsubscribe);
  const activityId = `relayr:${bundleUuid}`;
  const request = (async () => {
    const activity = refreshTransactionActivities().find((row) => row.bundleUuid === bundleUuid);
    const safeSession = activity && safeRelayrSession(activity);
    if (safeSession) {
      const { wagmiConfig } = await import("@/lib/wagmiConfig");
      const result = await safeBundleController(wagmiConfig, bundleUuid)
        .watch({
          account: safeSession.account,
          sessionId: safeSession.id,
          onUpdate: (update) =>
            notify({
              bundle_uuid: bundleUuid,
              transactions: update.session.records ?? [],
            } as RelayrGetBundleResponse),
        })
        .catch((cause) => {
          throw safeRecoveryError(cause);
        });
      if (result.state === "complete")
        return {
          bundle_uuid: bundleUuid,
          transactions: result.session.records ?? [],
        } as RelayrGetBundleResponse;
      const recovery = new RelayrRecoveryError(
        safeRelayrActivity(result.session) ?? activity,
        result.recovery,
      );
      if (!result.recovery)
        recovery.message =
          result.state === "released"
            ? "The saved Safe quote expired. Review the execution again."
            : `Transaction bundle ${bundleUuid} is still pending. Check its status before paying again.`;
      throw recovery;
    }
    let last: RelayrGetBundleResponse | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        // A quote whose own payment reverted runs only if another payment funded it,
        // which Relayr's record shows; its destinations are then proven from the chain.
        const reverted =
          transactionActivitySnapshot().find((item) => item.id === activityId)
            ?.relayrPaymentStatus === "reverted";
        if (!reverted) await provePayment(bundleUuid);
        const expected = expectedBundleTransactions(bundleUuid);
        last = await fetchBundle(bundleUuid);
        verifyBundleIdentity(bundleUuid, last, expected);
        if (reverted && !relayrBundleFunded(last))
          throw new RelayrVerificationError("The funding transaction reverted onchain.");
        const results: RelayrDestinationProgress[] = last.transactions.map((transaction) => {
          const hash = relayrDestinationHash(transaction) ?? undefined;
          return {
            transactionUuid: transaction.tx_uuid,
            hash,
            status: hash ? "submitted" : "pending",
          };
        });
        publishDestinationResults(bundleUuid, results);
        const states = last.transactions.map((transaction) => transaction.status?.state);
        const summary = bundleSummary(last);
        const routingComplete =
          expected.every((item) => item.expectedRouterPending) &&
          last.transactions.every(
            (transaction) =>
              relayrDestinationHash(transaction) &&
              (relayrStateIsSuccess(transaction.status?.state) ||
                relayrStateIsFailed(transaction.status?.state)),
          );
        if (states.some(relayrStateIsFailed) && !routingComplete) {
          updateTransactionActivity(activityId, {
            status: "failed",
            manualVerificationRequired: true,
            message: `Do not pay again. A failed destination transaction was reported. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          notify(last);
          await holdUnprovenSession(activityId);
          throw new Error(`Transaction bundle ${bundleUuid} failed. ${summary}`);
        }
        if (states.length > 0 && (states.every(relayrStateIsSuccess) || routingComplete)) {
          await verifyDestinationReceipts(last, expected, (result) => {
            const index = results.findIndex(
              (item) => item.transactionUuid === result.transactionUuid,
            );
            results[index] = result;
            publishDestinationResults(bundleUuid, results);
          });
          updateTransactionActivity(activityId, {
            status: "success",
            manualVerificationRequired: false,
            relayrDiscardable: undefined,
            relayrExpectedTransactions: expected,
            message: expected.some((item) => item.receiptStatus === "reverted")
              ? `All routing attempts reconciled. Some reverted; refresh pending payments before a new attempt. ${summary}`
              : `All ${states.length} destination transactions confirmed. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          notify(last);
          return last;
        }
        updateTransactionActivity(activityId, {
          status: "pending",
          message: `${reverted ? FUNDED_ELSEWHERE : "Payment confirmed; destination transactions are still executing."} ${summary}`,
          chainStates: bundleChainStates(last),
        });
        notify(last);
      } catch (error) {
        if (error instanceof RelayrVerificationError) {
          const reverted =
            transactionActivitySnapshot().find((item) => item.id === activityId)
              ?.relayrPaymentStatus === "reverted";
          if (!reverted) {
            updateTransactionActivity(activityId, {
              status: "failed",
              manualVerificationRequired: true,
              message: error.message,
            });
            await holdUnprovenSession(activityId);
          }
          throw error;
        }
        if (error instanceof Error && /bundle .* failed/.test(error.message)) throw error;
        updateTransactionActivity(activityId, {
          status: "pending",
          message:
            "Transaction confirmation is temporarily unavailable. Do not pay again; check this bundle again.",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    // A bundle Relayr leaves pending is classified like any unproven one (R114 (c)).
    await holdUnprovenSession(activityId);
    throw new Error(
      `Transaction bundle ${bundleUuid} is still pending after the status timeout. Do not pay again; resume checking this bundle.`,
    );
  })();
  bundleInflight.set(bundleUuid, request);
  void request
    .finally(() => {
      bundleInflight.delete(bundleUuid);
      bundleListeners.delete(bundleUuid);
      bundleResultListeners.delete(bundleUuid);
      bundleResultSnapshots.delete(bundleUuid);
      safeBundleControllers.delete(bundleUuid);
    })
    .catch(() => undefined);
  return request.finally(unsubscribe);
}

export function resumePendingRelayrBundles(): void {
  transactionActivitySnapshot()
    .filter(
      (activity) =>
        activity.kind === "relayr-bundle" &&
        activity.relayrPaymentStatus !== "unfunded" &&
        activity.bundleUuid &&
        (activity.status === "submitted" || activity.status === "pending"),
    )
    .forEach((activity) => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined));
}

export function useGetRelayrTxQuote() {
  const config = useConfig();
  const { address } = useAccount();
  const [data, setData] = useState<RelayrPostBundleResponse>();
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  const reset = useCallback(() => {
    setData(undefined);
    setError(null);
    setIsPending(false);
  }, []);

  const quoteOnce = useCallback(
    async (
      requests: ReviewedRelayrRequest[],
      options?: {
        signal?: AbortSignal;
        onMessage?: (message: string) => void;
        onStatus?: SafeRelayrStatus;
        onProgress?: (progress: SafeRelayrProgress) => void;
        /**
         * A review that already showed every call (`reviewPlan`), and the round of it these calls
         * are: nothing is asked again, and the payment within the round's fee bound pays too.
         */
        planned?: PlannedRound;
      },
    ) => {
      if (!address) throw new Error("Connect a wallet first.");
      const requireWalletContext = captureReviewedWalletContext(
        config,
        address,
        "Connected account changed. Review the authorization again.",
      );
      const safeCount = requests.filter((request) => request.relayrMode === "safe-exec").length;
      if (safeCount && safeCount !== requests.length)
        throw new Error("Safe executions are quoted as a bundle of their own.");
      if (safeCount) {
        requireNoViewAs();
        if (isSafeConnection(config))
          throw new Error(
            "A Safe cannot authorize these executions as an EOA. Use its proposal flow instead.",
          );
        if (requests.some((request) => request.data.from.toLowerCase() !== address.toLowerCase()))
          throw new Error("Request sender does not match the connected account.");
        setIsPending(true);
        setError(null);
        try {
          const prepared = await safeRelayrController(
            config,
            undefined,
            options?.onProgress,
          ).prepare({
            account: address,
            executions: requests.map(safeRelayrExecution),
            signal: options?.signal,
            onStatus: options?.onStatus,
          });
          const quote = safeRelayrQuote(prepared.session);
          const activity = safeRelayrActivity(prepared.session);
          if (!activity?.relayrExpectedTransactions)
            throw new Error("The reviewed Safe quote could not be retained.");
          rememberQuote(
            quote,
            address,
            requestKey(address, requests),
            activity.relayrCallKeys ?? [],
            activity.relayrExpectedTransactions,
          );
          setData(quote);
          return quote;
        } catch (cause) {
          const failure = safeRecoveryError(cause);
          const next =
            failure instanceof Error ? failure : new Error("Could not request a Safe quote.");
          setError(next);
          throw next;
        } finally {
          setIsPending(false);
        }
      }
      return withAuthorizationLock(address, async (locks) => {
        // Every journal write and signature under it checks this tab still holds the lock.
        const activity = activityJournal(locks);
        options?.signal?.throwIfAborted();
        requireWalletContext();
        requests = requests.map((request) => ({ ...request, data: { ...request.data } }));
        if (!address) throw new Error("Connect a wallet first.");
        if (!requests.length) throw new Error("There are no calls to quote.");
        if (isSafeConnection(config)) {
          throw new Error(
            "A Safe cannot authorize these ERC-2771 requests as an EOA. Submit each action through the Safe proposal flow instead.",
          );
        }
        const requestChains = new Set<number>();
        for (const request of requests) {
          if (request.data.from.toLowerCase() !== address.toLowerCase()) {
            throw new Error("Request sender does not match the connected account.");
          }
          if (
            requestChains.has(request.chainId) &&
            !requests
              .filter((item) => item.chainId === request.chainId)
              .every((item) => item.relayrMode === "raw" && item.expectedRouterPending)
          ) {
            throw new Error(
              `Cannot safely sign two requests for account ${address} on chain ${request.chainId} with the same onchain nonce.`,
            );
          }
          if (!isRelayrSupportedChain(request.chainId))
            throw new Error(
              "Bundled execution is unavailable on this network. Use the direct transaction flow.",
            );
          requestChains.add(request.chainId);
        }
        if (!areRelayrChainsCompatible([...requestChains]))
          throw new Error("Choose only mainnets or only testnets for one bundle.");
        const callKey = requestKey(address, requests);
        const callKeys = requests.flatMap((request) => [
          requestKey(address, [request]),
          ...(request.recoveryScope ? [scopeKey(address, request.recoveryScope)] : []),
          ...(request.relayrMode === "safe-exec" && request.expectedSafeExecution
            ? [safeNonceCallKey(address, request.chainId, request.expectedSafeExecution)]
            : []),
          ...(request.relayrMode === "raw" || request.relayrMode === "safe-exec"
            ? []
            : [
                scopeKey(
                  address,
                  `forwarder-nonce:${request.chainId}:${jbContractAddress[request.version ?? 6].ERC2771Forwarder[request.chainId]?.toLowerCase()}`,
                ),
              ]),
        ]);
        // Ruling R114: this action's own saved session, classified before its recheck.
        const saved = savedSessionOf(address, callKey);
        const continuation = saved
          ? await continueSession(config, address, saved, requests, [...requestChains], locks)
          : null;
        if (saved && !continuation) throw new RelayrRecoveryError(saved);
        if (saved && continuation?.kind === "quote") {
          const quote = continuation.quote;
          const continuedKeys = Array.from(new Set([...(saved.relayrCallKeys ?? []), ...callKeys]));
          await requireUnfunded(
            config,
            { bundleUuid: quote.bundle_uuid, callKey, callKeys: continuedKeys },
            saved.id,
            locks,
          );
          await activity.update(saved.id, {
            relayrCallKeys: continuedKeys,
          });
          requireTransactionActivityPersistence();
          options?.signal?.throwIfAborted();
          rememberQuote(quote, address, callKey, continuedKeys, saved.relayrExpectedTransactions!);
          setData(quote);
          setError(null);
          return quote;
        }
        const continued = continuation ? saved : undefined;
        const forwarded = requests.filter(
          (request) => request.relayrMode !== "raw" && request.relayrMode !== "safe-exec",
        );
        // Ruling R117: every other session that shares a call, a recovery scope or a
        // forwarder nonce reserves it while one of its requests can still run.
        await requireUnfunded(config, { bundleUuid: "", callKey, callKeys }, continued?.id, locks);
        await requireForwarderNoncesFree(
          config,
          address,
          forwarded,
          continued ? [continued.id] : [],
        );
        // A new signature for saved calls goes only to their saved nonces, once every
        // request is dead and unused (R104).
        const signAt =
          continuation?.kind === "sign" && saved ? savedNonces(saved) : new Map<number, bigint>();
        setIsPending(true);
        setError(null);
        try {
          /** The outer calls this publication posts, with what proves each one. */
          let expected: RelayrExpectedTransaction[];
          /** The plan this bundle was reviewed under, when it was signed now. */
          let planned: PlannedRound | undefined;
          /** The forwarder nonce each one was signed with, when every one is a forward request. */
          let nonces: string[] | undefined;
          if (continuation?.kind === "requote" && saved?.relayrExpectedTransactions) {
            // A refresh (R114 (a)): the saved signatures go out again under a new quote.
            expected = saved.relayrExpectedTransactions.map((transaction) => ({
              ...transaction,
              transactionUuid: "",
            }));
            nonces = saved.relayrNonces;
          } else {
            const sendDeps = reviewedSendDeps(config);
            // The signatures are refused at the wallet for View-as or another wallet connection.
            const deps = {
              ...sendDeps,
              adapter: reviewedWalletAdapter(config, address, getAccount(config).connector),
            };
            const executionGas: string[] = [];
            const transactions: (RelayrEntry | undefined)[] = [];
            const signedNonces: string[] = [];
            /** Each forward request as it will be signed, checked before the review opens. */
            const unsigned: {
              index: number;
              request: ReviewedRelayrRequest;
              client: NonNullable<ReturnType<typeof getPublicClient>>;
              forwarder: Address;
              message: ReviewedForwardRequest;
            }[] = [];
            /** Raw calls sign nothing: their sources are checked again once reviewed. */
            const raw: {
              request: ReviewedRelayrRequest;
              client: NonNullable<ReturnType<typeof getPublicClient>>;
            }[] = [];
            for (const [index, request] of requests.entries()) {
              options?.signal?.throwIfAborted();
              options?.onMessage?.(
                `Checking ${request.expectedRouterPending ? "routing attempt" : "transaction"} ${index + 1} of ${requests.length}.`,
              );
              requireWalletContext();
              const version = request.version ?? 6;
              const forwarder = jbContractAddress[version].ERC2771Forwarder[request.chainId];
              const client = getPublicClient(config, { chainId: request.chainId });
              if (!client || !forwarder)
                throw new Error(`Bundled execution is unavailable on chain ${request.chainId}.`);
              if (request.metadataSource)
                await verifyMetadataSource(client, request.metadataSource, address);
              await verifyCallPreconditions(client, request.preconditions);
              if (request.relayrMode === "raw") {
                if (request.expectedRouterPending)
                  requireRawPendingRouterCall(
                    request.chainId,
                    request.data.to,
                    request.data.data,
                    request.data.value,
                    request.expectedRouterPending,
                    request.preconditions,
                  );
                else
                  requireRawPayerCall(
                    request.data.to,
                    request.data.data,
                    request.data.value,
                    request.expectedDeployment,
                  );
                if (request.expectedRouterPending)
                  await simulatePendingRouterCall(client, {
                    from: address,
                    to: request.data.to,
                    data: request.data.data,
                    gas: request.data.gas,
                  });
                else
                  await client.call({
                    account: address,
                    to: request.data.to,
                    data: request.data.data,
                    value: request.data.value,
                  });
                executionGas[index] = (
                  request.expectedRouterPending
                    ? request.data.gas
                    : gasWithHeadroom(request.data.gas + 100_000n)
                ).toString();
                transactions[index] = {
                  chain: request.chainId,
                  target: request.data.to,
                  data: request.data.data,
                  value: request.data.value.toString(),
                };
                raw.push({ request, client });
                continue;
              }
              const gas = await forwardedRequestGas(client, forwarder, address, request);
              const nonce = await client.readContract({
                address: forwarder,
                abi: erc2771ForwarderAbi,
                functionName: "nonces",
                args: [address],
              });
              const savedNonce = signAt.get(request.chainId);
              if (savedNonce !== undefined && nonce !== savedNonce)
                throw new Error(
                  continuation?.kind === "sign" && continuation.until !== undefined
                    ? relayrHeldMessage(continuation.until)
                    : "The previous relay authorization may have executed. Check its original bundle before signing again.",
                );
              const fields = await client.readContract({
                address: forwarder,
                abi: erc2771ForwarderAbi,
                functionName: "eip712Domain",
              });
              if (
                fields[0] !== "0x0f" ||
                fields[3] !== BigInt(request.chainId) ||
                fields[4].toLowerCase() !== forwarder.toLowerCase() ||
                fields[6].length
              )
                throw new Error("The forwarder domain does not match this chain and deployment.");
              unsigned.push({
                index,
                request,
                client,
                forwarder,
                message: { ...request.data, gas, nonce, deadline: relayrForwarderDeadline() },
              });
            }
            // One review of every call the bundle runs, with the gas each signature commits to;
            // the signatures under it ask nothing more.
            planned = options?.planned ?? {
              relayrRound: "bundle",
              plan: await (
                await loadEngine()
              ).reviewPlan(
                {
                  account: address,
                  title:
                    requests.length === 1
                      ? `Review ${requests[0]!.review?.label ?? "relayed transaction"}`
                      : `Review ${requests.length} relayed transactions`,
                  description:
                    "Relayr submits these calls for you. One network fee pays for all of them, up to the amount shown.",
                  confirmLabel: "Agree & sign",
                  calls: requests.map((request, index) => ({
                    ...relayrPlanCall(
                      request,
                      address,
                      unsigned.find((item) => item.index === index)?.message.gas,
                    ),
                    relayrRound: "bundle",
                  })),
                  signal: options?.signal,
                },
                deps,
              ),
            };
            const { plan } = planned;
            for (const { request, client } of raw) {
              options?.signal?.throwIfAborted();
              requireWalletContext();
              if (request.metadataSource)
                await verifyMetadataSource(client, request.metadataSource, address);
              await verifyCallPreconditions(client, request.preconditions);
            }
            for (const { index, request, client, forwarder, message } of unsigned) {
              // Core signs the exact request on the canonical forwarder's domain, spent from the
              // plan.
              const [signature] = await (
                await loadEngine()
              ).signReviewed(
                [{ kind: "forward-request", chainId: request.chainId, request: message }],
                {
                  account: address,
                  plan,
                  locks,
                  reverify: async () => {
                    requireWalletContext();
                    const { requirePriceBasedShopVoting } =
                      await import("@/lib/shop-voting-policy");
                    requirePriceBasedShopVoting(request.data.data, request.data.to);
                    if (request.metadataSource)
                      await verifyMetadataSource(client, request.metadataSource, address);
                    await verifyCallPreconditions(client, request.preconditions);
                    requireWalletContext();
                    options?.signal?.throwIfAborted();
                  },
                },
                deps,
              );
              requireWalletContext(request.chainId);
              executionGas[index] = gasWithHeadroom(message.gas + 100_000n).toString();
              signedNonces.push(message.nonce.toString());
              transactions[index] = {
                chain: request.chainId,
                target: forwarder,
                data: encodeFunctionData({
                  abi: erc2771ForwarderAbi,
                  functionName: "execute",
                  args: [{ ...message, signature: signature! }],
                }),
                value: request.data.value.toString(),
              };
            }
            expected = (transactions as RelayrEntry[]).map((transaction, index) => ({
              gas: executionGas[index],
              metadataSource: requests[index].metadataSource,
              preconditions: requests[index].preconditions,
              expectedSafeExecution: requests[index].expectedSafeExecution,
              expectedDeployment: requests[index].expectedDeployment,
              rejectEvents: requests[index].rejectEvents,
              reservedReceipt: requests[index].reservedReceipt,
              expectedPayout: requests[index].expectedPayout,
              expectedRouterPending: requests[index].expectedRouterPending,
              chainId: transaction.chain,
              target: transaction.target,
              data: transaction.data,
              value: transaction.value,
              transactionUuid: "",
            }));
            nonces = signedNonces.length === transactions.length ? signedNonces : undefined;
          }
          const bundleRequest = relayrBundleRequest(
            expected.map(({ chainId, target, data, value }) => ({
              chain: chainId,
              target,
              data,
              value,
            })),
          );
          // A response can be lost after Relayr receives executable signatures. Persist
          // the intent first; only authenticated unsigned routing remains freely retryable.
          await requireUnfunded(
            config,
            { bundleUuid: "", callKey, callKeys },
            continued?.id,
            locks,
          );
          options?.signal?.throwIfAborted();
          requireWalletContext();
          const publicationId = `relayr-publication:${callKey}`;
          const publication: Omit<TransactionActivity, "createdAt" | "updatedAt"> = {
            id: publicationId,
            kind: "relayr-bundle",
            title: "Authorization publication",
            status: "pending",
            message:
              "Signed calls were published. If the quote response is lost, do not authorize the same action again until the existing signed calls have been reconciled onchain.",
            account: address,
            callKey,
            relayrCallKeys: callKeys,
            relayrPaymentStatus: "unfunded",
            relayrExpectedTransactions: expected,
            relayrNonces: nonces,
            relayrDiscardable: undefined,
            manualVerificationRequired: undefined,
          };
          const unsignedRouting = unboundRoutingPublication(publication);
          if (unsignedRouting) {
            publication.title = "Routing fee quote requested";
            publication.message =
              "Unsigned routing calls were sent for a fee quote. No payment was sent. If no quote returns, review the currently ready payments again.";
          }
          // The new publication carries the continued session's calls: its own
          // signatures again, or new ones once every request it published is dead.
          await fence(locks, () => {
            recordTransactionActivity(publication);
            if (continued && continued.id !== publicationId) supersede([continued]);
          })();
          requireTransactionActivityPersistence();
          options?.onMessage?.(
            unsignedRouting && requests.length > 1
              ? "Requesting the network-fee quote. This batch may take a few minutes."
              : "Requesting the network-fee quote.",
          );
          let response: Response;
          try {
            // The public 14-call routing quote takes about 154 seconds. Unsigned
            // routing can wait longer without extending any signed authorization.
            const timeout = AbortSignal.timeout(unsignedRouting ? 300_000 : 45_000);
            response = await fetch(`${RELAYR_API}/v1/bundle/prepaid`, {
              method: "POST",
              signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bundleRequest),
            });
          } catch (cause) {
            if ((cause as { name?: string } | undefined)?.name === "TimeoutError")
              throw new Error(
                unsignedRouting
                  ? "The network-fee quote timed out. No payment was sent. Review again to request a fresh quote."
                  : "The network-fee quote timed out. Check the saved authorization in account activity before trying again.",
                { cause },
              );
            throw cause;
          }
          options?.signal?.throwIfAborted();
          // Relayr's records must be exactly the signed calls before any payment is offered.
          options?.onMessage?.("Checking the returned network-fee quote.");
          const bound = await bindRelayrQuote(response, bundleRequest);
          const quote = quoteForDestinationChains(
            { bundle_uuid: bound.bundle_uuid, payment_info: bound.payment_info as ChainPayment[] },
            [...requestChains],
          );
          const expectedTransactions = bound.expectedTransactions.map((binding, index) => ({
            ...expected[index],
            chainId: binding.chain,
            target: binding.entry.target,
            data: binding.entry.data,
            value: binding.entry.value,
            transactionUuid: binding.txUuid,
          }));
          // The ready quote replaces its publication in one write under the lock.
          await fence(locks, () => {
            recordTransactionActivity({
              id: `relayr:${quote.bundle_uuid}`,
              kind: "relayr-bundle",
              title: "Transaction bundle ready for payment",
              status: "pending",
              message: unsignedRouting
                ? "The selected routing attempts are ready. Choose a funding chain to pay this existing quote once."
                : "The destination authorizations are signed. Choose a funding chain to pay this existing quote once.",
              account: address,
              callKey,
              relayrCallKeys: callKeys,
              bundleUuid: quote.bundle_uuid,
              relayrPaymentStatus: "unfunded",
              relayrExpectedTransactions: expectedTransactions,
              relayrNonces: nonces,
              relayrQuote: structuredClone(quote),
            });
            dismissTransactionActivity(publicationId);
          })();
          options?.signal?.throwIfAborted();
          rememberQuote(quote, address, callKey, callKeys, expectedTransactions, planned);

          setData(quote);
          return quote;
        } catch (cause) {
          const next = cause instanceof Error ? cause : new Error("Could not get payment options.");
          setError(next);
          throw next;
        } finally {
          setIsPending(false);
        }
      });
    },
    [address, config],
  );

  const getRelayrTxQuote = useCallback(
    async (...args: Parameters<typeof quoteOnce>) => {
      try {
        return await quoteOnce(...args);
      } catch (cause) {
        const next = await discardInFlow(cause);
        if (next !== cause) setError(next instanceof Error ? next : null);
        throw next;
      }
    },
    [quoteOnce],
  );

  return { getRelayrTxQuote, data, reset, error, isPending, isSuccess: !!data };
}

export function useSendRelayrTx() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  /** The last payment this hook sent, under the hash it was mined. */
  const [data, setData] = useState<Hex>();

  const sendRelayrTx = useCallback(
    async (
      offeredPayment: ChainPayment,
      options?: {
        onMessage?: (message: string) => void;
        onStatus?: SafeRelayrStatus;
      },
    ): Promise<Hex> => {
      requireNoViewAs();
      if (!address) throw new Error("Connect a wallet first.");
      if (isSafeConnection(config))
        throw new Error(
          "Submit each action through the Safe proposal flow instead of paying an EOA quote.",
        );
      const requireWalletContext = captureReviewedWalletContext(
        config,
        address,
        "Connected account or chain changed. Review the payment again.",
      );
      const payment = { ...offeredPayment };
      const remembered = quotes.get(paymentKey(payment));
      if (!remembered || remembered.account.toLowerCase() !== address.toLowerCase())
        throw new Error(
          "This payment does not belong to a reviewed quote for the connected account. Review the action again.",
        );
      // The payment is refused at the wallet for View-as or another wallet connection.
      const paymentDeps = {
        ...reviewedSendDeps(config),
        adapter: reviewedWalletAdapter(config, address, getAccount(config).connector, () => {
          requireWalletContext(payment.chain);
          relayrPaymentDetails(payment, {
            bundleUuid: remembered.bundleUuid,
            destinationChainIds: remembered.chainIds,
          });
        }),
      };
      const activityId = `relayr:${remembered.bundleUuid}`;
      const activity = refreshTransactionActivities().find((row) => row.id === activityId);
      const safeSession = activity && safeRelayrSession(activity);
      if (safeSession) {
        try {
          const result = await safeBundleController(config, remembered.bundleUuid).fund({
            account: address,
            sessionId: safeSession.id,
            paymentChainId: payment.chain,
            onStatus: options?.onStatus,
          });
          const hash = result.session.payments.at(-1)?.hash;
          if (!hash)
            throw new Error(
              "The Safe bundle payment result is uncertain. Check the existing bundle.",
            );
          setData(hash);
          return hash;
        } catch (cause) {
          throw safeRecoveryError(cause);
        }
      }
      /** The payment's work under its lock ended: a hash saved after this is a kept one. */
      let ended = false;
      const submit = async (lock: LockHandle | null) => {
        try {
          return await pay(lock);
        } finally {
          ended = true;
        }
      };
      const pay = async (lock: LockHandle | null) => {
        // Every journal write and the wallet itself check this tab still holds the payment's lock.
        const locks = lock ? [lock] : [];
        const activity = activityJournal(locks);
        options?.onMessage?.("Preparing the network-fee payment.");
        const journal = () => refreshTransactionActivities().find((row) => row.id === activityId);
        // The SDK keeps no more payments for a quote than this, so none is sent beyond them.
        if (sentPayments(journal()).length >= MAX_RELAYR_SENT_PAYMENTS)
          throw new Error(
            "This quote was paid too many times to pay again. Keep it pending; do not pay again.",
          );
        await requireUnfunded(config, remembered, undefined, locks);
        const { amount: value } = relayrPaymentDetails(payment, {
          bundleUuid: remembered.bundleUuid,
          destinationChainIds: remembered.chainIds,
        });
        await switchChainAsync({ chainId: payment.chain });
        const requireAccount = () => requireWalletContext(payment.chain);
        requireAccount();
        options?.onMessage?.("Review the network-fee payment.");
        const publicClient = getPublicClient(config, { chainId: payment.chain });
        if (!publicClient) throw new Error("Payment network is unavailable.");
        let sent: ReturnType<typeof sentPayments> = [];
        let submitting: TransactionActivity | undefined;
        let previousPayment: TransactionActivity | undefined;
        /** The wallet step began: the attempt is saved as submitted. */
        let walletOpened = false;
        let hash: Hex | undefined;
        /** The payment's receipt, also when it reverted. */
        let receipt: TransactionReceipt | undefined;
        const sentAs = (sentHash: Hex) => ({
          hash: sentHash,
          relayrPayments: [
            ...sent,
            {
              hash: sentHash,
              chainId: payment.chain,
              target: payment.target,
              data: payment.calldata,
              value: value.toString(),
            },
          ],
        });
        /** Rechecks the quote, its signed calls and earlier payments right before the wallet. */
        const recheck = async () => {
          requireAccount();
          options?.onMessage?.("Checking the selected transactions before payment.");
          const code = await publicClient.getCode({ address: payment.target });
          if (!code || keccak256(code) !== RELAYR_PAYMENT_CODE_HASH)
            throw new Error("Payment contract code is not recognized.");
          // Funding may be approved long after signing.
          const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
          for (const transaction of remembered.expectedTransactions)
            requirePriceBasedShopVoting(transaction.data, transaction.target);
          await revalidateSignedCalls(config, address, remembered.expectedTransactions);
          const row = journal();
          sent = sentPayments(row);
          // A quote that was paid before is paid again only on the SDK's retry rule.
          if (row && sent.length)
            await requireRelayrRetry(clientFor(config), {
              payments: relayrSavedQuote(row).payments,
              from: address,
              bundleUuid: remembered.bundleUuid.toLowerCase(),
            });
          requireAccount();
          relayrPaymentDetails(payment, {
            bundleUuid: remembered.bundleUuid,
            destinationChainIds: remembered.chainIds,
          });
          await requireUnfunded(config, remembered, undefined, locks);
          requireAccount();
        };
        /** Saves the attempt as submitted, last before the wallet. */
        const saveSubmitting = async () => {
          previousPayment = structuredClone(journal());
          if (!previousPayment)
            throw new Error("The saved payment disappeared. Recover the quote before paying.");
          submitting = structuredClone(
            await activity.record({
              id: activityId,
              kind: "relayr-bundle",
              title: "Multi-chain bundle",
              status: "submitted",
              message:
                "Funding is being submitted. Do not pay again while the wallet result is uncertain.",
              chainId: payment.chain,
              account: address,
              bundleUuid: remembered.bundleUuid,
              relayrExpectedTransactions: remembered.expectedTransactions,
              relayrPayment: {
                target: payment.target,
                data: payment.calldata,
                value: value.toString(),
              },
              relayrPayments: sent,
              relayrPaymentStatus: "submitted",
              chainStates: remembered.chainIds.map((chainId) => ({
                chainId,
                status: "Pending",
              })),
              callKey: remembered.callKey,
            }),
          );
          requireTransactionActivityPersistence();
          walletOpened = true;
          options?.onMessage?.("Confirm the network-fee payment in your wallet.");
        };
        // Refused for a lapsed lock, core saves the hash once the lock is taken back; the bundle
        // is then followed from that saved hash, as the payment's own work could not prove it.
        const onSent = async (submitted: Hex) => {
          hash ??= submitted;
          fundedBundles.add(remembered.bundleUuid);
          options?.onMessage?.("Checking the submitted network-fee payment.");
          await activity.update(activityId, {
            ...sentAs(submitted),
            message: "Payment submitted. Do not pay again while its receipt is pending.",
          });
          if (ended) void waitForRelayrBundle(remembered.bundleUuid).catch(() => undefined);
        };
        /** Nothing was sent after the submitting marker was saved (a 4001, or a gate before the wallet). */
        let unsent = false;
        /** The restore refused: the saved record is no longer this marker. */
        let unrestored: unknown;
        // Restores the exact record the marker replaced; refused for a lapsed lock, core runs it
        // again once the lock is taken back.
        const onUnsent = async () => {
          if (!submitting || !previousPayment) return;
          unsent = true;
          try {
            await activity.restoreUnsent(submitting, previousPayment);
          } catch (cause) {
            if (cause instanceof LockLostError) throw cause;
            // The row changed since the marker (a check, a hash): the catch's merge write records
            // the outcome instead, keeping what changed.
            unsent = false;
            unrestored = cause;
          }
        };
        // A quote's first payment under the plan that reviewed its round's fee bound pays within
        // that bound with no prompt. A retry, or a quote reviewed apart from a plan, reviews the
        // payment on its own, on the SDK's retry rule.
        const planned = sentPayments(journal()).length ? undefined : remembered.planned;
        /** Its last gate passed: from here an error may come from the wallet. */
        let ready = false;
        const engine = await loadEngine();
        try {
          if (planned) {
            const bindings = remembered.expectedTransactions.map((row) => ({
              txUuid: row.transactionUuid,
              chain: row.chainId,
              entry: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
            }));
            const paid = await engine.payRelayrReviewed(
              {
                bundle_uuid: remembered.bundleUuid,
                payment_info: [payment],
                transactions: bindings.map(({ txUuid, entry }) => ({
                  tx_uuid: txUuid,
                  request: entry,
                })),
                expectedTransactions: bindings,
              },
              payment.chain,
              {
                account: address,
                ...planned,
                locks,
                onUnsent,
                // Core's own gates follow and refuse as not sent.
                onSending: async () => {
                  await recheck();
                  await saveSubmitting();
                  ready = true;
                },
                onSent,
              },
              paymentDeps,
            );
            if (!("hash" in paid))
              throw new Error("Pay the network fee from an ordinary wallet. Nothing was sent.");
            receipt = await publicClient.getTransactionReceipt({ hash: paid.hash });
          } else {
            const result = await engine.sendReviewed(
              {
                account: address,
                calls: [
                  {
                    chainId: payment.chain,
                    to: payment.target,
                    value,
                    gas: RELAYR_PAYMENT_GAS,
                    data: payment.calldata,
                    label: "Pay network fee",
                    ...relayrPaymentReview(payment.calldata),
                  },
                ],
                title: "Review payment",
                description:
                  "This one payment funds the signed calls on every selected chain. Destination transactions confirm separately.",
                confirmLabel: "Pay",
                guard: requireNoViewAs,
                locks,
                reverify: recheck,
                beforeWallet: async () => saveSubmitting(),
                onUnsent: () => onUnsent(),
                assertWriteState: () => {
                  requireAccount();
                  relayrPaymentDetails(payment, {
                    bundleUuid: remembered.bundleUuid,
                    destinationChainIds: remembered.chainIds,
                  });
                  if (walletOpened) ready = true;
                },
                onSubmitted: (_call, _step, submitted) => onSent(submitted),
                // A receipt still confirming is followed here, so the bundle goes on once it lands.
                follow: { onConfirming: () => options?.onMessage?.(engine.HELD_CONFIRMING_LINE) },
              },
              paymentDeps,
            );
            if (result.status !== "done")
              throw new Error("Pay the network fee from an ordinary wallet. Nothing was sent.");
            receipt = result.receipts[0];
          }
        } catch (cause) {
          if (hash && cause instanceof ReviewedCallRevertedError) receipt = cause.receipt;
          else if (hash)
            receipt = planned
              ? await publicClient
                  .getTransactionReceipt({ hash: journal()?.hash ?? hash })
                  .catch(() => undefined)
              : undefined;
          else if (
            walletOpened &&
            (cause instanceof WalletNotInvokedError ||
              (planned ? cause instanceof RelayrPaymentNotSentError : !ready))
          ) {
            // A gate refused before the wallet: `onUnsent` restored the exact marker it saved.
            if (unrestored) throw unrestored;
            throw cause instanceof RelayrPaymentNotSentError
              ? cause
              : new RelayrPaymentNotSentError(cause);
          } else if (walletOpened) {
            const error = relayrWalletPaymentError(cause);
            // Only an explicit wallet rejection proves that no transaction was broadcast. A quote
            // paid before stays on the SDK's retry rule when the wallet declines to pay it again:
            // another payment may still fund it.
            const outcome = relayrPaymentAttemptOutcome(error, {
              sending: true,
              paid: sent.length > 0,
            });
            // The wallet's answer, kept under a lapsed lock and saved once it is taken back. One
            // that sent nothing is `onUnsent`'s.
            if (!unsent)
              await keepOutcome(locks, () =>
                activity.update(
                  activityId,
                  outcome === "reverted"
                    ? PAYMENT_REVERTED
                    : outcome === "unpaid"
                      ? {
                          status: "pending",
                          relayrPaymentStatus: "unfunded",
                          message:
                            "The wallet declined payment. The existing signed quote can still be funded once before it expires.",
                        }
                      : {
                          status: "pending",
                          message:
                            "The wallet's funding result is uncertain. Do not pay again; inspect wallet activity and this bundle.",
                        },
                ),
              );
            throw error;
          } else throw cause;
        }
        let mined = hash!;
        try {
          if (!receipt) throw new Error("The payment receipt could not be read.");
          // A wallet that sped the payment up mined it under another hash; that
          // transaction is the payment to prove and to remember.
          if (typeof receipt?.transactionHash !== "string" || !isHash(receipt.transactionHash))
            throw new Error("The payment receipt names no transaction hash.");
          if (receipt.transactionHash.toLowerCase() !== mined.toLowerCase()) {
            mined = receipt.transactionHash;
            const sped = mined;
            await keepOutcome(locks, () => activity.update(activityId, sentAs(sped)));
          }
          await provePayment(remembered.bundleUuid, locks);
        } catch (error) {
          if (!(error instanceof RelayrVerificationError)) {
            // Keep proving this payment even if an immediate read failed or the lock lapsed.
            void waitForRelayrBundle(remembered.bundleUuid).catch(() => undefined);
            await keepOutcome(locks, () =>
              activity.update(activityId, {
                status: "pending",
                message:
                  "Payment was submitted, but confirmation is uncertain. Do not pay again; check this hash and bundle.",
              }),
            );
          }
          throw new Error(
            `Payment ${mined} was submitted, but confirmation is uncertain. Do not pay again.`,
            { cause: error },
          );
        }
        await activity.update(activityId, {
          status: "pending",
          message: "Payment confirmed. Destination transactions are now pending.",
        });
        void waitForRelayrBundle(remembered.bundleUuid).catch(() => undefined);
        return mined;
      };
      if (paymentInflight.has(remembered.callKey))
        throw new Error("This payment is already in progress. Do not pay again.");
      paymentInflight.add(remembered.callKey);
      try {
        const mined = (await browserLocks().request(
          `revnet:relayr:${remembered.callKey}`,
          { mode: "exclusive" },
          submit,
        )) as Awaited<ReturnType<typeof submit>>;
        setData(mined);
        return mined;
      } finally {
        paymentInflight.delete(remembered.callKey);
      }
    },
    [address, config, switchChainAsync],
  );

  return { sendRelayrTx, data };
}

export function useGetRelayrTxBundle() {
  const [uuid, setUuid] = useState<string>();
  const [response, setResponse] = useState<RelayrGetBundleResponse>();
  const [error, setError] = useState<unknown>();
  const [isPolling, setIsPolling] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const startPolling = useCallback((bundleUuid: string) => {
    setResponse(undefined);
    setError(undefined);
    setIsPolling(true);
    setUuid(bundleUuid);
    setPollAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!uuid) return;
    let active = true;
    setIsPolling(true);
    void waitForRelayrBundle(uuid, (next) => active && setResponse(next))
      .then((next) => active && setResponse(next))
      .catch((cause) => active && setError(cause))
      .finally(() => active && setIsPolling(false));
    return () => {
      active = false;
    };
  }, [uuid, pollAttempt]);

  const states = response?.transactions.map((item) => item.status?.state) ?? [];
  const isComplete =
    !error && !isPolling && states.length > 0 && states.every(relayrStateIsSuccess);
  const hasFailed = !!error || states.some(relayrStateIsFailed);
  return { startPolling, isComplete, hasFailed, uuid, response, isPolling, error };
}
