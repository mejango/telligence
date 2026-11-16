"use client";

import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import type { MetadataSourceGuard } from "@/lib/project-metadata-write";
import { ReviewRefusal } from "@/lib/review-refusal";
import type { RelayrDiscardReason } from "@bananapus/nana-sdk-core/review/relayr";
import type { SafeRelayrSession } from "@bananapus/nana-sdk-core/review/safe-relayr";
import type { ExpectedPayoutReceipt, ExpectedReservedReceipt } from "@bananapus/nana-sdk-core/v6";
import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import type {
  CallPrecondition,
  ExpectedPayerDeployment,
  ExpectedSafeExecution,
  RejectedReceiptEvent,
} from "./multichain-guards";
import type { RouterPendingReceiptGuard } from "./pending-router-calls";
import type { ReviewedSafeProposal } from "./safe-transactions";
import type { StoredHold } from "./write-hold";

export type TransactionActivityStatus =
  "submitted" | "pending" | "safe-proposed" | "success" | "failed";

/** Exact signed outer calls, retained so an API status cannot substitute another transaction. */
export type RelayrExpectedTransaction = {
  chainId: number;
  target: Address;
  data: Hex;
  value: string;
  transactionUuid: string;
  /** Canonical receipt outcome; a reverted permissionless attempt is consumed. */
  receiptStatus?: "success" | "reverted";
  gas?: string;
  metadataSource?: MetadataSourceGuard;
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ExpectedReservedReceipt;
  expectedPayout?: ExpectedPayoutReceipt;
  expectedRouterPending?: RouterPendingReceiptGuard;
  expectedSafeExecution?: ExpectedSafeExecution;
};

export type TransactionActivity = {
  id: string;
  kind: "direct" | "safe" | "relayr-payment" | "relayr-bundle";
  title: string;
  status: TransactionActivityStatus;
  message: string;
  chainId?: number;
  account?: Address;
  hash?: Hex;
  safeProposalHash?: Hex;
  /** The Safe a proposal was made to and the calls it was reviewed to run, values as strings. */
  safeProposal?: ReviewedSafeProposal;
  /** A direct write's hold, so its screens can show it. */
  directHold?: StoredHold;
  /** Its authenticated call became permanently obsolete; keep nonce cancellation guidance. */
  obsoleteSafeNonce?: number;
  /**
   * The app can't confirm this Safe proposal's result: its watch has ended, and it blocks an
   * identical call until its account dismisses it.
   */
  safeResultUnconfirmed?: boolean;
  /**
   * The proposal's follower ended and handed it to the SDK's write hold: the hold's state is what
   * it shows, through reloads, until the hold clears or the user dismisses it or takes the exit.
   */
  holdFollows?: true;
  /** A Safe proposal the SDK's write hold holds (from its send, or moved into it on load). */
  sdkHeld?: true;
  /**
   * The chain proved this proposal executed: the Safe's execution event for its safeTxHash at
   * the block that used `nonce` (decimal), in transaction `executionHash`. That receipt alone
   * settles it, with no Safe service; until then it stays held, and nothing dismisses it.
   */
  safeExecutionProven?: { safe: Address; nonce: string; executionHash?: Hex };
  /**
   * The proposal's own Safe nonce, in decimal: from its authenticated service record, or found
   * from its hash. Once the Safe uses it, only the canonical chain may release the proposal.
   */
  safeProposalNonce?: string;
  executionHash?: Hex;
  /** When the chain first answered that it holds no receipt for a Safe proposal's `executionHash`. */
  executionSeenAt?: number;
  bundleUuid?: string;
  /** Stable SDK session identity while a publication receives its bundle UUID. */
  relayrSafeSessionId?: string;
  /** Preserve the SDK's release decision, including cancellation before publication. */
  relayrSafeState?: SafeRelayrSession["state"];
  /** Why the SDK proved that this saved Safe execution no longer reserves its nonce. */
  relayrSafeReleaseReason?: SafeRelayrSession["releaseReason"];
  /** Retain opaque/incomplete legacy reservations when the SDK saves their recovery state. */
  relayrSafeReservationKeys?: string[];
  /** A Safe funding wallet invocation has not produced a known hash yet. */
  relayrSafeFundingUnknown?: boolean;
  /** Relayr has reported funding or execution, even if no local payment hash was captured. */
  relayrSafeFundingObserved?: boolean;
  relayrExpectedTransactions?: RelayrExpectedTransaction[];
  relayrPayment?: { target: Address; data: Hex; value: string };
  /** Every funding payment the wallet broadcast for this bundle, oldest first. */
  relayrPayments?: Array<{ hash: Hex; chainId: number; target: Address; data: Hex; value: string }>;
  relayrCallKeys?: string[];
  relayrQuote?: RelayrPostBundleResponse;
  /**
   * The forwarder nonce each request in `relayrExpectedTransactions` was signed with, in order, in
   * decimal. Saved only when every request is a forward request.
   */
  relayrNonces?: string[];
  /**
   * Every request this session published is dead at a canonical finalized block, and why (ruling
   * R114). Discard ends it; until then a session that may have run still reserves its calls.
   */
  relayrDiscardable?: RelayrDiscardReason;
  /**
   * "expired": a quote nothing can fund any more, proven onchain, or one a new quote for its calls
   * replaced at the same forwarder nonces. It no longer reserves its calls.
   */
  relayrPaymentStatus?: "unfunded" | "submitted" | "confirmed" | "reverted" | "expired";
  /** A caller-specific receipt/postcondition check must pass before success is trusted. */
  manualVerificationRequired?: boolean;
  chainStates?: Array<{
    chainId: number;
    status: string;
    hash?: Hex;
  }>;
  callKey?: string;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "revnet:transaction-activities:v1";
const MAX_TERMINAL_ACTIVITIES = 20;
const EMPTY: TransactionActivity[] = [];
let snapshot: TransactionActivity[] = EMPTY;
let hydrated = false;
let persistedValue: string | null | undefined;
let storageWriteFailed = false;
let storageReadFailed = false;
const listeners = new Set<() => void>();

/** Shared identity for one reviewed direct call and its durable submission evidence. */
export function contractTransactionKey(
  account: Address,
  chainId: number,
  call: { address: Address; value?: bigint; data: Hex },
): string {
  return `${account.toLowerCase()}:${chainId}:${call.address.toLowerCase()}:${call.value ?? 0n}:${call.data}`;
}

function parseActivities(raw: string | null): TransactionActivity[] {
  const parsed: unknown = JSON.parse(raw ?? "[]");
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        !["direct", "safe", "relayr-payment", "relayr-bundle"].includes(row.kind) ||
        !["submitted", "pending", "safe-proposed", "success", "failed"].includes(row.status),
    )
  ) {
    throw new Error("Transaction recovery storage is malformed.");
  }
  return retainActivities(parsed);
}

function isInFlight(activity: TransactionActivity): boolean {
  return (
    activity.manualVerificationRequired === true ||
    activity.status === "submitted" ||
    activity.status === "pending" ||
    activity.status === "safe-proposed"
  );
}

/**
 * Keep every unresolved activity so its persisted call key continues to block
 * an identical submission after a reload. Only completed history is cosmetic
 * and may be capped.
 */
function retainActivities(activities: TransactionActivity[]): TransactionActivity[] {
  let terminalCount = 0;
  return activities.filter((activity) => {
    if (isInFlight(activity)) return true;
    terminalCount += 1;
    return terminalCount <= MAX_TERMINAL_ACTIVITIES;
  });
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    snapshot = parseActivities(raw);
    persistedValue = raw;
    storageReadFailed = false;
  } catch {
    storageReadFailed = true;
  }
}

function emit(next: TransactionActivity[]): void {
  snapshot = retainActivities(next);
  if (typeof window !== "undefined" && !storageReadFailed) {
    try {
      const serialized = JSON.stringify(snapshot);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      persistedValue = serialized;
      storageWriteFailed = false;
    } catch {
      // Status remains available for this session when storage is unavailable.
      storageWriteFailed = true;
    }
  }
  listeners.forEach((listener) => listener());
}

/**
 * Re-read the persisted lock set before a write. Storage events are not sent
 * to the tab which made a change, and an already-open sibling tab may have
 * hydrated before another tab proposed a Safe transaction.
 */
export function refreshTransactionActivities(): TransactionActivity[] {
  hydrate();
  if (typeof window === "undefined" || storageWriteFailed) return snapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === persistedValue && !storageReadFailed) return snapshot;
    const parsed = parseActivities(raw);
    persistedValue = raw;
    snapshot = parsed;
    storageReadFailed = false;
    listeners.forEach((listener) => listener());
  } catch {
    // A malformed or inaccessible sibling-tab value is not trusted.
    storageReadFailed = true;
  }
  return snapshot;
}

/** Funding and signature publication must retain their recovery lock across reloads. */
export function requireTransactionActivityPersistence(): void {
  refreshTransactionActivities();
  if (typeof window === "undefined" || storageWriteFailed || storageReadFailed) {
    throw new ReviewRefusal(
      "Transaction recovery storage is unavailable. Restore browser storage before publishing signatures or sending a payment.",
    );
  }
}

export function transactionActivitySnapshot(): TransactionActivity[] {
  hydrate();
  return snapshot;
}

export function subscribeTransactionActivities(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTransactionActivities(): TransactionActivity[] {
  return useSyncExternalStore(
    subscribeTransactionActivities,
    transactionActivitySnapshot,
    () => EMPTY,
  );
}

export function recordTransactionActivity(
  activity: Omit<TransactionActivity, "createdAt" | "updatedAt"> &
    Partial<Pick<TransactionActivity, "createdAt" | "updatedAt">>,
): TransactionActivity {
  refreshTransactionActivities();
  const now = Date.now();
  const current = snapshot.find((row) => row.id === activity.id);
  const next: TransactionActivity = {
    ...current,
    ...activity,
    createdAt: activity.createdAt ?? current?.createdAt ?? now,
    updatedAt: activity.updatedAt ?? now,
  };
  emit([next, ...snapshot.filter((row) => row.id !== next.id)]);
  return next;
}

export function updateTransactionActivity(
  id: string,
  patch: Partial<Omit<TransactionActivity, "id" | "createdAt">>,
): void {
  refreshTransactionActivities();
  const current = snapshot.find((row) => row.id === id);
  if (!current) return;
  const guardedPatch =
    current.manualVerificationRequired &&
    patch.status === "success" &&
    patch.manualVerificationRequired !== false
      ? { ...patch, status: current.status, message: current.message }
      : patch;
  emit([
    { ...current, ...guardedPatch, updatedAt: Date.now() },
    ...snapshot.filter((row) => row.id !== id),
  ]);
}

/** Restore only the exact payment marker whose wallet invocation was refused. */
export function restoreUnsentPaymentActivity(
  expected: TransactionActivity,
  previous: TransactionActivity,
): void {
  requireTransactionActivityPersistence();
  const current = snapshot.find((row) => row.id === expected.id);
  if (
    expected.id !== previous.id ||
    expected.relayrPaymentStatus !== "submitted" ||
    JSON.stringify(current) !== JSON.stringify(expected)
  ) {
    throw new Error("The saved submission changed. Preserve its recovery record.");
  }
  emit(snapshot.map((row) => (row.id === expected.id ? structuredClone(previous) : row)));
  requireTransactionActivityPersistence();
}

/**
 * Quarantine a mined write whose action-specific verification did not finish.
 * The hash remains an in-flight dedupe lock, and the generic receipt watcher
 * cannot overwrite it with a false-success message later.
 */
export function holdTransactionActivityForVerification(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "pending",
    message,
    manualVerificationRequired: true,
  });
}

export function failTransactionActivityVerification(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "failed",
    message,
    manualVerificationRequired: true,
  });
}

/** Settle a mined write whose verification proved it failed: nothing changed, so it may be sent again. */
export function settleTransactionActivityFailure(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "failed",
    message,
    manualVerificationRequired: false,
  });
}

export function releaseTransactionActivityVerification(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "success",
    message,
    manualVerificationRequired: false,
  });
}

export function dismissTransactionActivity(id: string): void {
  refreshTransactionActivities();
  const row = snapshot.find((activity) => activity.id === id);
  // A held entry stays until it is verified, unless the app can never confirm it, or a Relayr
  // session none of whose requests can run again is discarded.
  if (row?.manualVerificationRequired && !row.safeResultUnconfirmed && !row.relayrDiscardable)
    return;
  // A proven execution is the only evidence of what ran; its receipt settles it first.
  if (row?.safeExecutionProven && row.status !== "success" && row.status !== "failed") return;
  // A Safe proposal still followed is held; only one the app can't confirm may be dismissed.
  if (row?.status === "safe-proposed" && !row.safeResultUnconfirmed) return;
  emit(snapshot.filter((activity) => activity.id !== id));
}

export function transactionActivityForHash(hash?: Hex): TransactionActivity | undefined {
  if (!hash) return undefined;
  return transactionActivitySnapshot().find(
    (row) => row.hash?.toLowerCase() === hash.toLowerCase(),
  );
}
