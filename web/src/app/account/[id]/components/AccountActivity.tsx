"use client";

import { ActivityItemRow } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import { mapActivityEvents } from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { ProfilesProvider } from "@/components/ProfilesContext";
import { ProjectLink } from "@/components/ProjectLink";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCompleteAccountActivity } from "@/hooks/useCompleteBendystrawLists";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { mergeAccountActivity } from "@/lib/bendystraw/accountActivity";
import type { AccountActivityEventItem } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { slugFor } from "@/lib/slug";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { Address } from "viem";

// Only the account itself sees its held and in-flight writes; their machinery loads for it alone.
const AccountPendingWrites = dynamic(
  () => import("./AccountPendingWrites").then((module) => module.AccountPendingWrites),
  { ssr: false },
);

const INITIAL_ITEMS = 25;
const LOAD_MORE_COUNT = 25;

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
        // Each row shows the token its event moved; USD covers a row whose token is unknown,
        // and the project's accounting token is the last resort when the indexer has neither.
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

  const visibleEvents = events.slice(0, visibleCount);
  const hasMore = events.length > visibleCount;
  const addresses = visibleEvents.map((event) => event.beneficiary);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Activity</h2>
      {isSelf ? (
        <AccountPendingWrites address={address} confirmedTxHashes={confirmedTxHashes} />
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
