"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { DateRelative } from "@/components/DateRelative";
import { IpfsImage } from "@/components/IpfsImage";
import { IssuanceFingerprint } from "@/components/IssuanceFingerprint";
import { ProjectLink } from "@/components/ProjectLink";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { formatEthAddress } from "@/lib/utils";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { useCallback, useMemo, useState } from "react";
import {
  foldSameTxActivities,
  mapActivityEvents,
  type ActivityEventItem,
} from "./[slug]/components/ActivityFeed/mapActivityEvents";
import type { HomepageRawActivity } from "./getHomepageActivity";

type HomepageActivity = ReturnType<typeof mapActivityEvents>[number];

function description(event: HomepageActivity, symbol: string) {
  switch (event.type) {
    case "in":
      // Acquisitions read "bought <amount> <token> <source>". Buyback-routed
      // pays issue nothing themselves — "bought 0" would misread.
      return event.tokenCount && event.tokenCount !== "0"
        ? `bought ${event.tokenCount} ${symbol} from issuance`
        : "paid in";
    case "out":
      return `cashed out ${event.tokenCount} ${symbol}`;
    case "addToBalance":
      return "added to balance";
    case "swapBuy":
      return `bought ${event.tokenCount} ${symbol} via the buyback pool`;
    case "swapSell":
      return `sold ${event.tokenCount} ${symbol} via the buyback pool`;
    case "issuance":
      return `bought ${event.tokenCount} ${symbol} from issuance`;
    case "swap":
      return `swapped ${event.tokenCount} ${symbol} via the buyback pool`;
    case "payout":
      return "sent payouts";
    case "rulesetQueued":
      return "reconfigured the revnet";
    case "projectCreate":
      return "created the revnet";
    case "buybackPool":
      return "set the buyback pool";
    default:
      return event.type === "autoIssue"
        ? `auto-issued ${event.tokenCount} ${symbol}`
        : "updated the revnet";
  }
}

/** One sentence for a row and its same-tx companions: "bought … via the buyback pool". */
function combinedDescription(event: HomepageActivity, symbol: string): string {
  // A zero-issuance pay's "paid in" adds nothing next to the amount + "in"
  // tag — it contributes no fragment when other actions exist.
  const entries = [event, ...(event.also ?? [])];
  const visible =
    entries.length > 1
      ? entries.filter(
          (entry) => !(entry.type === "in" && (!entry.tokenCount || entry.tokenCount === "0")),
        )
      : entries;
  const fragments = (visible.length ? visible : entries).map((entry) => description(entry, symbol));
  if (fragments.length === 1) return fragments[0];
  if (fragments.length === 2) return `${fragments[0]} and ${fragments[1]}`;
  return `${fragments.slice(0, -1).join(", ")}, and ${fragments[fragments.length - 1]}`;
}

export function HomepageActivityFeed({
  initialEvents,
  initialHasMore,
}: {
  initialEvents: HomepageRawActivity[];
  initialHasMore: boolean;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const mappedById = useMemo(
    () =>
      new Map(
        mapActivityEvents(events as ActivityEventItem[], (event) => ({
          tokenSymbol: event.project?.tokenSymbol,
          decimals: event.project?.decimals,
          denominateInUsd: false,
        })).map((event) => [event.id, event]),
      ),
    [events],
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/homepage-activity?limit=8&offset=${events.length}`);
      if (!response.ok) throw new Error("Activity unavailable");
      const data = (await response.json()) as { events: HomepageRawActivity[]; hasMore: boolean };
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        return [...current, ...data.events.filter((event) => !ids.has(event.id))];
      });
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [events.length, hasMore, loading]);
  const markerRef = useInfiniteScroll(loadMore, hasMore && !loading);

  // One line item per transaction (per project): fold same-tx rows together.
  const eventGroups: HomepageRawActivity[][] = [];
  {
    const groups = new Map<string, HomepageRawActivity[]>();
    for (const event of events) {
      const key = `${event.chainId}:${event.project?.projectId ?? ""}:${event.txHash}`;
      const group = groups.get(key);
      if (group) group.push(event);
      else {
        const fresh = [event];
        groups.set(key, fresh);
        eventGroups.push(fresh);
      }
    }
  }

  if (!events.length)
    return (
      <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
        No recent activity yet.
      </p>
    );
  return (
    <ol className="divide-y divide-teal-100">
      {eventGroups.map((group, index) => {
        const event = group[0];
        const project = event.project;
        const activities = group
          .map((member) => mappedById.get(member.id))
          .filter((activity): activity is HomepageActivity => !!activity);
        if (!project || !activities.length) return null;
        const activity = foldSameTxActivities(activities);
        const chainId = event.chainId as JBChainId;
        const name = project.name ?? `Project #${project.projectId}`;
        const href = `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`;
        const explorer = JB_CHAINS[chainId]?.chain.blockExplorers?.default.url;
        const isIn =
          activity.type === "in" ||
          activity.type === "addToBalance" ||
          activity.type === "swapBuy" ||
          activity.type === "issuance";
        const isOut = activity.type === "out" || activity.type === "swapSell";
        // The project ERC-20's ticker. `project.tokenSymbol` names the ACCOUNTING
        // token (ETH, USDC) — labelling a project-token count with it reads as
        // "bought 23.29 ETH" for a revnet that issues MARKEE.
        const symbol = event.tokenTicker?.replace(/^\$+/, "") ?? "tokens";
        return (
          <li key={event.id} className="relative h-28 overflow-hidden px-4 py-3">
            <IssuanceFingerprint values={event.issuanceFingerprint} />
            <div className="relative z-10 flex items-start gap-3">
              <ProjectLink
                href={href}
                projectHint={{
                  name,
                  logoUri: project.logoUri ?? null,
                  tagline: project.projectTagline ?? null,
                }}
                className="shrink-0"
              >
                <IpfsImage
                  src={project.logoUri}
                  alt=""
                  width={46}
                  height={46}
                  loading={index < 4 ? "eager" : "lazy"}
                  fetchPriority={index < 4 ? "high" : "auto"}
                  className="size-[46px] object-cover"
                  fallback={<div className="size-[46px] bg-teal-100" />}
                />
              </ProjectLink>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="shrink-0 whitespace-nowrap">
                    <DateRelative timestamp={event.timestamp} />
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    {activity.baseAmount ? (
                      <span className="truncate" title={activity.exactAmount}>
                        {activity.baseAmount}
                        {activity.baseTokenSymbol ? ` ${activity.baseTokenSymbol}` : ""}
                      </span>
                    ) : null}
                    {isIn ? (
                      <span className="inline-flex h-5 min-w-7 shrink-0 items-center justify-center border border-teal-600 px-1 text-center text-[10px] leading-none text-teal-600">
                        in
                      </span>
                    ) : null}
                    {isOut ? (
                      <span className="inline-flex h-5 min-w-7 shrink-0 items-center justify-center border border-orange-500 px-1 text-center text-[10px] leading-none text-orange-500">
                        out
                      </span>
                    ) : null}
                    <span className="shrink-0">
                      <ChainLogo chainId={chainId} width={14} height={14} />
                    </span>
                  </div>
                </div>
                <ProjectLink
                  href={href}
                  projectHint={{
                    name,
                    logoUri: project.logoUri ?? null,
                    tagline: project.projectTagline ?? null,
                  }}
                  className="mt-1 block truncate text-sm font-medium text-teal-700 hover:underline"
                >
                  {name}
                </ProjectLink>
                <div className="mt-1 line-clamp-2 text-sm">
                  {explorer ? (
                    <a
                      href={`${explorer}/address/${activity.beneficiary}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-zinc-400 underline-offset-2 hover:text-teal-700"
                    >
                      {formatEthAddress(activity.beneficiary)}
                    </a>
                  ) : (
                    <span>{formatEthAddress(activity.beneficiary)}</span>
                  )}
                  <span className="text-zinc-700"> {combinedDescription(activity, symbol)}</span>
                </div>
              </div>
            </div>
          </li>
        );
      })}
      {hasMore || loading ? (
        <li className="h-12" aria-hidden>
          <div ref={markerRef} className="h-px" />
        </li>
      ) : null}
    </ol>
  );
}
