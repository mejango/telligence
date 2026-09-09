"use client";

import { useSyncExternalStore } from "react";
import { getAddress, isAddress, type Address } from "viem";

const STORAGE_KEY = "revnet:view-as:v1";
let snapshot: Address | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    snapshot = stored && isAddress(stored) ? getAddress(stored) : null;
  } catch {
    snapshot = null;
  }
}

function emit(next: Address | null): void {
  snapshot = next;
  if (typeof window !== "undefined") {
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The mode still applies for this session when storage is unavailable.
    }
  }
  listeners.forEach((listener) => listener());
}

export function viewAsSnapshot(): Address | null {
  hydrate();
  return snapshot;
}

export function subscribeViewAs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setViewAs(address: Address): void {
  hydrate();
  if (!isAddress(address)) return;
  emit(getAddress(address));
}

export function clearViewAs(): void {
  hydrate();
  emit(null);
}

export const VIEW_AS_WRITE_ERROR =
  "You're viewing the site as another account — exit View as to transact.";

/** Refuse wallet writes and signatures while "View as" impersonation is active. */
export function requireNoViewAs(): void {
  if (viewAsSnapshot()) throw new Error(VIEW_AS_WRITE_ERROR);
}

export function useViewAs(): {
  viewAs: Address | null;
  setViewAs: (address: Address) => void;
  clearViewAs: () => void;
} {
  const viewAs = useSyncExternalStore(subscribeViewAs, viewAsSnapshot, () => null);
  return { viewAs, setViewAs, clearViewAs };
}
