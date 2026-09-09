"use client";

import { ActivityItemRow } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import { mapActivityEvents } from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { ProfilesProvider } from "@/components/ProfilesContext";
import { ProjectLink } from "@/components/ProjectLink";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCompleteAccountActivity } from "@/hooks/useCompleteBendystrawLists";
import { waitForRelayrBundle } from "@/hooks/useReviewedRelayr";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { mergeAccountActivity } from "@/lib/bendystraw/accountActivity";
import type { AccountActivityEventItem } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { canCheckRelayrBundle } from "@/lib/relayr-activity";
import { slugFor } from "@/lib/slug";
import { useTransactionActivities, type TransactionActivity } from "@/lib/transaction-activity";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import { useMemo, useState } from "react";
import type { Address } from "viem";

const INITIAL_ITEMS = 25;
const LOAD_MORE_COUNT = 25;

function statusLabel(status: TransactionActivity["status"]): string {
  return status === "safe-proposed" ? "Safe proposal pending" : status;
}

// Relayr is expected to ship a query-by-account API soon. When it does,
// replace this local-store read with a fetch against that endpoint so any
// viewer (and any device) sees the account's Relayr history/state.
function useInFlightActivities(address: Address, enabled: boolean): TransactionActivity[] {
  const all = useTransactionActivities();
  return useMemo(() => {
    if (!enabled) return [];
    return all.filter((activity) => activity.account?.toLowerCase() === address.toLowerCase());
  }, [all, address, enabled]);
}

function InFlightCard({ activity, isSelf }: { activity: TransactionActivity; isSelf: boolean }) {
  const resumable = isSelf && canCheckRelayrBundle(activity);
  return (
    <div className="border border-melon-200 bg-melon-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase text-melon-700">
            {statusLabel(activity.status)}
          </p>
          <p className="mt-0.5 text-sm font-medium text-zinc-800">{activity.title}</p>
        </div>
        {resumable ? (
          <button
            type="button"
            className="text-xs font-medium text-teal-700 underline"
            onClick={() => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined)}
          >
            Check bundle
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-zinc-600">{activity.message}</p>
      {activity.chainStates?.length ? (
        <ul className="mt-2 space-y-0.5">
          {activity.chainStates.map((state) => (
            <li key={state.chainId} className="text-xs text-zinc-500">
              {JB_CHAINS[state.chainId as JBChainId]?.name ?? `Chain ${state.chainId}`}:{" "}
              {state.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AccountActivity({ address }: { address: Address }) {
  const { address: viewed } = useViewedAccount();
  const isSelf = !!viewed && viewed.toLowerCase() === address.toLowerCase();
  const [visibleCount, setVisibleCount] = useState(INITIAL_ITEMS);
  const { data, isLoading, isError } = useCompleteAccountActivity(address.toLowerCase());

  // From-branch rows merged with beneficiary-branch rows (payments to the
  // account, mints, auto-issues), deduped and sorted newest first.
  const items = useMemo(
    () =>
      (data ? mergeAccountActivity(data) : []).filter(
        (item): item is AccountActivityEventItem => !!JB_CHAINS[item.chainId as JBChainId],
      ),
    [data],
  );

  const projectByEventId = useMemo(() => {
    const map = new Map<string, AccountActivityEventItem["project"]>();
    for (const item of items) map.set(item.id, item.project);
    return map;
  }, [items]);

  const events = useMemo(
    () =>
      mapActivityEvents(items, (event) => {
        const project = (event as AccountActivityEventItem).project;
        // USD is the account feed's denomination — one unit across every project a wallet
        // touched. `flowAmount` falls back to the accounting token when the indexer has no
        // USD figure, and puts the raw accounting amount on hover either way.
        return {
          tokenSymbol: project?.tokenSymbol,
          decimals: project?.decimals,
          denominateInUsd: true,
        };
      }),
    [items],
  );

  const confirmedTxHashes = useMemo(
    () => new Set(items.map((item) => item.txHash.toLowerCase())),
    [items],
  );

  // Local, in-flight transaction state layered above confirmed rows — shown
  // only when viewing your own account, deduped against indexed rows.
  const inFlight = useInFlightActivities(address, isSelf).filter((activity) => {
    // An indexed payment or one destination does not settle the whole bundle.
    if (
      activity.kind === "relayr-bundle" &&
      (activity.status !== "success" || activity.manualVerificationRequired)
    )
      return true;
    const hashes = [
      activity.hash,
      activity.executionHash,
      ...(activity.chainStates?.map((state) => state.hash) ?? []),
    ];
    return !hashes.some((hash) => hash && confirmedTxHashes.has(hash.toLowerCase()));
  });

  const visibleEvents = events.slice(0, visibleCount);
  const hasMore = events.length > visibleCount;
  const addresses = visibleEvents.map((event) => event.beneficiary);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Activity</h2>
      {inFlight.length > 0 ? (
        <div className="mb-4 space-y-2">
          {inFlight.map((activity) => (
            <InFlightCard key={activity.id} activity={activity} isSelf={isSelf} />
          ))}
        </div>
      ) : null}
      <ProfilesProvider addresses={addresses}>
        {isLoading ? (
          <SkeletonLines lines={6} className="mt-3" />
        ) : isError ? (
          <p className="py-4 text-sm text-red-600">
            Activity is temporarily unavailable. Try again shortly.
          </p>
        ) : visibleEvents.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">No activity yet</p>
        ) : (
          <div className="flex flex-col">
            {visibleEvents.map((event) => {
              const project = projectByEventId.get(event.id);
              const slug = slugFor(event.chainId, project?.projectId ?? 0);
              const projectLabel = project?.name ?? project?.handle ?? undefined;
              return (
                <div key={event.id}>
                  {projectLabel && slug ? (
                    <ProjectLink
                      href={`/${slug}`}
                      projectHint={{ name: projectLabel, logoUri: null }}
                      className="mt-3 -mb-2 block text-xs font-medium text-teal-700 hover:underline"
                    >
                      {projectLabel}
                    </ProjectLink>
                  ) : null}
                  <ActivityItemRow event={event} />
                </div>
              );
            })}
          </div>
        )}
        {hasMore ? (
          <button
            onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_COUNT)}
            className="mt-3 w-full rounded-md border border-zinc-200 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            Load more
          </button>
        ) : null}
      </ProfilesProvider>
    </section>
  );
}
