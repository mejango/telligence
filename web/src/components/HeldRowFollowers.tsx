"use client";

import { followedRow, showSafeView } from "@/lib/held-rows";
import {
  updateTransactionActivity,
  useTransactionActivities,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import { holdInputOf, writeHolds } from "@/lib/write-hold";
import {
  HELD_FAILED_LINE,
  HELD_RELEASED_ELSEWHERE_LINE,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import { useHeldWrite } from "@bananapus/nana-sdk-core/review/react";
import { useEffect, useMemo, useRef } from "react";
import type { PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";

/**
 * Every held write the hold may still settle, followed through the SDK's held write for as long
 * as it may: from its send, through the screen that sent it closing, across reloads. A Safe
 * proposal's row shows its held write's line; a direct write's result is told, so the next send
 * of the same action goes straight on.
 */
export function HeldRowFollowers() {
  const rows = useTransactionActivities();
  return (
    <>
      {rows.filter(followedRow).map((row) => (
        <HeldRowFollower key={row.id} row={row} />
      ))}
    </>
  );
}

function HeldRowFollower({ row }: { row: TransactionActivity }) {
  const config = useConfig();
  const chainId = row.chainId!;
  const client = useMemo(
    () => getPublicClient(config, { chainId } as never) as unknown as PublicClient | undefined,
    [config, chainId],
  );
  const input = holdInputOf(row)!;
  const hash = row.hash!;
  // A proposal the hold doesn't hold (proposed through Safe's service, or journaled by an earlier
  // build) is adopted into it first, by its safeTxHash.
  const adopted = row.kind === "safe" && !row.sdkHeld;
  const held = useHeldWrite({
    hold: writeHolds,
    ...input,
    client: client as unknown as WriteHoldClient | undefined,
    ...(adopted ? { adopt: async () => ({ safe: { safeTxHash: hash } }) } : {}),
  });
  // A nonce the earlier build saved for it lets the hold prove what used that nonce.
  const nonce =
    adopted && row.safeProposalNonce && /^\d+$/.test(row.safeProposalNonce)
      ? Number(row.safeProposalNonce)
      : undefined;
  const seenHeld = useRef(false);
  const { phase, line, exit, settled, state, adopting, handle } = held;
  useEffect(() => {
    // A direct write's row says how its hold settled it, which tells the user.
    if (row.kind === "direct") {
      // Only its own transaction's settlement: a later attempt of the same call settles itself.
      if (
        phase === "settled" &&
        settled &&
        "hash" in settled &&
        settled.hash.toLowerCase() === row.hash?.toLowerCase()
      )
        updateTransactionActivity(row.id, {
          status: settled.result === "success" ? "success" : "failed",
          message: settled.result === "success" ? "Confirmed onchain." : HELD_FAILED_LINE,
        });
      return;
    }
    if (phase === "awaiting" || phase === "confirming" || phase === "held") {
      if (!seenHeld.current && nonce !== undefined && handle && client)
        void handle
          .attachSafeNonce(client as unknown as WriteHoldClient, { safeTxHash: hash, nonce })
          .catch(() => undefined);
      seenHeld.current = true;
    }
    // A success the hold settled before this view saw it held (an earlier load's, another
    // window's, or this proposal's adoption): its row shows it.
    if (phase === "succeeded" && settled) {
      showSafeView(row.id, { ...held, phase: "settled" });
      return;
    }
    // A row the hold no longer holds (another window's exit, or a settlement no view here saw)
    // shows what the hold kept of it.
    if (phase === "clear" && !adopting && !seenHeld.current && state)
      showSafeView(row.id, {
        ...held,
        phase: settled ? "settled" : "released",
        line: settled ? null : HELD_RELEASED_ELSEWHERE_LINE,
      });
    else if (phase !== "clear" && phase !== "succeeded") showSafeView(row.id, held, client);
    // Each change of what the held write shows.
  }, [phase, line, exit, settled, state, adopting]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
