"use client";

import { chainDisplayName } from "@/app/constants";
import { LostReplyHashField } from "@/components/LostReplyHashField";
import {
  checkRelayrSession,
  discardRelayrSession,
  relayrSessionCheck,
  retireCheckedRelayrSession,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import { canCheckRelayrBundle, canCheckRelayrSignatures } from "@/lib/relayr-activity";
import {
  dismissTransactionActivity,
  useTransactionActivities,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import { formatTransactionMessage } from "@/lib/utils";
import { SUPPORTED_CHAINS } from "@/lib/wagmiTransports";
import { writeHolds } from "@/lib/write-hold";
import {
  checkedItLabel,
  HELD_HASH_MISMATCH_LINE,
  HELD_HASH_UNVERIFIED_LINE,
  SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL,
  SAVED_ATTEMPT_UNREADABLE_LINE,
  type SavedAttemptCheck,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import { HeldWritesNotice, useHeldWrites } from "@bananapus/nana-sdk-core/review/react";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";

function statusLabel(activity: TransactionActivity): string {
  if (activity.safeResultUnconfirmed) return "Unconfirmed";
  return activity.status === "safe-proposed" ? "Safe proposal pending" : activity.status;
}

// Relayr is expected to ship a query-by-account API soon. When it does,
// replace this local-store read with a fetch against that endpoint so any
// viewer (and any device) sees the account's Relayr history/state.
function useInFlightActivities(address: Address): TransactionActivity[] {
  const all = useTransactionActivities();
  return useMemo(
    () => all.filter((activity) => activity.account?.toLowerCase() === address.toLowerCase()),
    [all, address],
  );
}

/**
 * Every write the SDK holds for this account on one chain, with its line and its release, and a
 * hash field for one whose wallet reply was lost.
 */
function HeldWritesOn({ chainId, account }: { chainId: number; account: Address }) {
  const client = usePublicClient({ chainId });
  const items = useHeldWrites({ hold: writeHolds, chainId, account, client });
  // A held send with no hash: the user can give it when the hold can check it (its nonce and
  // the block it was sent from).
  const unhashed = items.flatMap((item) => {
    const held = writeHolds.list({ account, chainId }).find(({ key }) => key === item.key);
    return item.view.state?.status === "held-no-hash" &&
      held?.record.nonce !== undefined &&
      held.record.fromBlock !== undefined
      ? [{ key: item.key, handle: held.handle }]
      : [];
  });
  return (
    <>
      <HeldWritesNotice
        items={items}
        className="space-y-2 border border-melon-200 p-3 text-xs text-zinc-700 [&_button]:font-medium [&_button]:text-teal-700 [&_button]:underline"
      />
      {client
        ? unhashed.map(({ key, handle }) => (
            <div key={key} className="border border-melon-200 p-3">
              <LostReplyHashField
                id={`held-hash-${key}`}
                onCheck={async (hash) => {
                  // The hold attaches it only when it is that exact send; unread, it is retryable.
                  const { hashCheck } = await handle.attachHash(client as WriteHoldClient, hash!);
                  return hashCheck === "attached"
                    ? null
                    : hashCheck === "mismatch"
                      ? HELD_HASH_MISMATCH_LINE
                      : HELD_HASH_UNVERIFIED_LINE;
                }}
              />
            </div>
          ))
        : null}
    </>
  );
}

function InFlightCard({ activity, isSelf }: { activity: TransactionActivity; isSelf: boolean }) {
  /** A check that couldn't show the session: the SDK's one "I checked it" action. */
  const [check, setCheck] = useState<SavedAttemptCheck>();
  const [unreadable, setUnreadable] = useState(false);
  const checked = (run: () => Promise<unknown>) =>
    void run().catch(async (cause: unknown) =>
      setCheck(await relayrSessionCheck(activity.id, cause).catch(() => undefined)),
    );
  const retire = (force?: "unreadable") => {
    if (!check) return;
    void retireCheckedRelayrSession(activity.id, check, force).then((retired) => {
      // Retired: the session's card goes with it.
      if (retired.retired) setCheck(undefined);
      else setUnreadable(retired.reason === "unreadable");
    });
  };
  const resumable = isSelf && canCheckRelayrBundle(activity);
  // An unpaid session's signatures are checked onchain; one whose requests are all dead
  // is marked for Discard, and its line is the card's message (ruling R114 (e)). A
  // completed bundle, or a quote a new one replaced, is never discarded.
  const checkable = isSelf && canCheckRelayrSignatures(activity);
  const discardable =
    isSelf &&
    !!activity.relayrDiscardable &&
    activity.status !== "success" &&
    activity.relayrPaymentStatus !== "expired";
  return (
    <div className="border border-melon-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase text-melon-700">{statusLabel(activity)}</p>
          <p className="mt-0.5 text-sm font-medium text-zinc-800">
            {formatTransactionMessage(activity.title)}
          </p>
        </div>
        {resumable ? (
          <button
            type="button"
            className="text-xs font-medium text-teal-700 underline"
            onClick={() => checked(() => waitForRelayrBundle(activity.bundleUuid!))}
          >
            Check bundle
          </button>
        ) : null}
        {checkable ? (
          <button
            type="button"
            className="text-xs font-medium text-teal-700 underline"
            onClick={() => checked(() => checkRelayrSession(activity.id))}
          >
            Check signatures
          </button>
        ) : null}
        {discardable ? (
          <button
            type="button"
            className="text-xs font-medium text-teal-700 underline"
            onClick={() => {
              try {
                discardRelayrSession(activity.id);
              } catch {
                // A session that can't be discarded here keeps its card and line.
              }
            }}
          >
            Discard
          </button>
        ) : null}
        {isSelf && activity.safeResultUnconfirmed ? (
          <button
            type="button"
            className="text-xs font-medium text-teal-700 underline"
            onClick={() => dismissTransactionActivity(activity.id)}
          >
            Dismiss
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-zinc-600">{formatTransactionMessage(activity.message)}</p>
      {check ? (
        <div className="mt-2 grid gap-1 text-xs text-zinc-700">
          <p>{check.line}</p>
          <p>{check.warning}</p>
          <button type="button" className="w-fit underline" onClick={() => retire()}>
            {checkedItLabel()}
          </button>
          {unreadable ? (
            <>
              <p>{SAVED_ATTEMPT_UNREADABLE_LINE}</p>
              <button
                type="button"
                className="w-fit underline"
                onClick={() => retire("unreadable")}
              >
                {SAVED_ATTEMPT_CONTINUE_ANYWAY_LABEL}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {activity.chainStates?.length ? (
        <ul className="mt-2 space-y-0.5">
          {activity.chainStates.map((state) => (
            <li key={state.chainId} className="text-xs text-zinc-500">
              {chainDisplayName(state.chainId)}: {state.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The connected account's own held writes and in-flight transactions, above its indexed
 * activity. It renders only for the account itself, so its write machinery loads only then.
 */
export function AccountPendingWrites({
  address,
  confirmedTxHashes,
}: {
  address: Address;
  confirmedTxHashes: Set<string>;
}) {
  // Local, in-flight transaction state layered above confirmed rows — shown
  // only when viewing your own account, deduped against indexed rows.
  const inFlight = useInFlightActivities(address).filter((activity) => {
    // An indexed payment or one destination does not settle the whole bundle.
    if (
      activity.kind === "relayr-bundle" &&
      (activity.status !== "success" || activity.manualVerificationRequired)
    )
      return true;
    // A Safe proposal the app can't confirm stays, with its Dismiss, until its account dismisses it.
    if (activity.safeResultUnconfirmed) return true;
    const hashes = [
      activity.hash,
      activity.executionHash,
      ...(activity.chainStates?.map((state) => state.hash) ?? []),
    ];
    return !hashes.some((hash) => hash && confirmedTxHashes.has(hash.toLowerCase()));
  });

  return (
    <>
      <div className="mb-4 space-y-2 empty:hidden">
        {SUPPORTED_CHAINS.map((chain) => (
          <HeldWritesOn key={chain.id} chainId={chain.id} account={address} />
        ))}
      </div>
      {inFlight.length > 0 ? (
        <div className="mb-4 space-y-2">
          {inFlight.map((activity) => (
            <InFlightCard key={activity.id} activity={activity} isSelf />
          ))}
        </div>
      ) : null}
    </>
  );
}
