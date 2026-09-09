"use client";

import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import type { MetadataSourceGuard } from "@/lib/project-metadata-write";
import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import type {
  CallPrecondition,
  ExpectedPayerDeployment,
  RejectedReceiptEvent,
  ReservedReceiptGuard,
} from "./multichain-guards";
import type { ExpectedPayoutReceipt } from "./payout-receipts";

export type TransactionActivityStatus =
  "submitted" | "pending" | "safe-proposed" | "success" | "failed";

/** Exact signed outer calls, retained so an API status cannot substitute another transaction. */
export type RelayrExpectedTransaction = {
  chainId: number;
  target: Address;
  data: Hex;
  value: string;
  transactionUuid: string;
  gas?: string;
  metadataSource?: MetadataSourceGuard;
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ReservedReceiptGuard;
  expectedPayout?: ExpectedPayoutReceipt;
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
  executionHash?: Hex;
  bundleUuid?: string;
  relayrExpectedTransactions?: RelayrExpectedTransaction[];
  relayrPayment?: { target: Address; data: Hex; value: string };
  relayrCallKeys?: string[];
  relayrQuote?: RelayrPostBundleResponse;
  relayrAuthorizationExpiresAt?: number;
  relayrPaymentStatus?: "unfunded" | "submitted" | "confirmed" | "reverted";
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
    throw new Error(
      "Transaction recovery storage is unavailable. Restore browser storage before publishing signatures or sending a Relayr payment.",
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
  if (snapshot.find((row) => row.id === id)?.manualVerificationRequired) return;
  emit(snapshot.filter((row) => row.id !== id));
}

export function transactionActivityForHash(hash?: Hex): TransactionActivity | undefined {
  if (!hash) return undefined;
  return transactionActivitySnapshot().find(
    (row) => row.hash?.toLowerCase() === hash.toLowerCase(),
  );
}
