"use client";

import { chainDisplayName } from "@/app/constants";
import { hasSuckerPair, isPairCheckPending, unverifiedPairLine, useSuckers } from "./suckers";

/** A `(chainId, projectId)` a write targets, as the server project lists carry it. */
export type GroupWriteTarget = { chainId: number; projectId: bigint | number };

/**
 * The write gate for targets taken from the server sucker-group list (the
 * indexer). Display may use that list; a write may only target pairs the
 * on-chain sucker registry lists.
 *
 * - `blocked`: some target is not chain-verified; the write's button is disabled.
 * - `pending`: the registry read is still in flight; the button shows loading.
 * - `line`: one inline line naming the mismatch or failure, null while pending.
 * - `checking`: the registry read is in flight, for gating a second target list.
 * - `assertVerified(targets)`: the send-time recheck; throws with that line.
 */
export function useGroupWriteGate(targets: readonly GroupWriteTarget[]) {
  const suckers = useSuckers();
  const unverifiedOf = (list: readonly GroupWriteTarget[]) =>
    list.filter(
      (target) =>
        !hasSuckerPair(suckers.verifiedPairs, {
          peerChainId: target.chainId,
          projectId: BigInt(target.projectId),
        }),
    );
  const lineFor = (unverified: readonly GroupWriteTarget[]) =>
    unverified.length
      ? unverifiedPairLine(
          suckers,
          [...new Set(unverified.map((target) => chainDisplayName(target.chainId)))].join(", "),
        )
      : null;
  const unverified = unverifiedOf(targets);
  const checking = isPairCheckPending(suckers);
  return {
    checking,
    blocked: unverified.length > 0,
    pending: unverified.length > 0 && checking,
    line: lineFor(unverified),
    unverifiedOf,
    lineFor,
    assertVerified(list: readonly GroupWriteTarget[]) {
      const missing = unverifiedOf(list);
      if (missing.length) {
        throw new Error(
          lineFor(missing) ?? "Still confirming this project's chains onchain. Try again.",
        );
      }
    },
  };
}
