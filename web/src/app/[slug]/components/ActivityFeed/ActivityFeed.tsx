"use client";

import { ProfilesProvider } from "@/components/ProfilesContext";
import { ActivityFeedSkeleton } from "@/components/loading/LoadingSkeletons";
import { ChevronDown } from "@/components/ui/icons";
import { useCompleteActivityEvents } from "@/hooks/useCompleteBendystrawLists";
import type { SuckerGroupQuery } from "@/lib/bendystraw/types";
import { useState } from "react";
import { ProjectTabIcon } from "../ProjectTabIcon";
import { ActivityItem, type ActivityEvent } from "./ActivityItem";
import {
  groupSameTxEvents,
  isProjectFeedActivityEvent,
  mapActivityEvents,
  projectFeedTokenContext,
} from "./mapActivityEvents";

type Project = NonNullable<
  NonNullable<SuckerGroupQuery["suckerGroup"]>["projects"]
>["items"][number];

interface Props {
  suckerGroupId: string;
  projects: Project[];
}

const INITIAL_ITEMS = 10;
const LOAD_MORE_COUNT = 5;

type ActivityCategory =
  | "pay"
  | "addToBalance"
  | "cashOut"
  | "tokenMint"
  | "autoIssue"
  | "tokenDeploy"
  | "projectCreate"
  | "ownershipTransfer"
  | "ruleset"
  | "payout"
  | "buybackSwap"
  | "buybackPool"
  | "reserved";

const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  pay: "Payments",
  addToBalance: "Add to balance",
  cashOut: "Cash outs",
  tokenMint: "Token mints",
  autoIssue: "Auto-issuance",
  tokenDeploy: "Token deploys",
  projectCreate: "Project creation",
  ownershipTransfer: "Ownership transfers",
  ruleset: "Ruleset changes",
  payout: "Payouts",
  buybackSwap: "Buyback swaps",
  buybackPool: "Buyback pools",
  reserved: "Reserved tokens",
};

export function activityCategory(event: ActivityEvent): ActivityCategory | null {
  switch (event.type) {
    case "in":
      return "pay";
    case "out":
      return "cashOut";
    case "addToBalance":
      return "addToBalance";
    case "mint":
    case "issuance":
      return "tokenMint";
    case "autoIssue":
      return "autoIssue";
    case "deployErc20":
      return "tokenDeploy";
    case "projectCreate":
      return "projectCreate";
    case "projectTransfer":
      return "ownershipTransfer";
    case "rulesetQueued":
      return "ruleset";
    case "payout":
      return "payout";
    case "swapBuy":
    case "swapSell":
    case "swap":
      return "buybackSwap";
    case "buybackPool":
      return "buybackPool";
    case "reserved":
    case "reservedSplit":
      return "reserved";
    case "operatorPermissionsSet":
      return null;
  }
}

function ActivityTypeFilter({
  categories,
  selected,
  onChange,
}: {
  categories: ActivityCategory[];
  selected: Set<ActivityCategory> | null;
  onChange: (next: Set<ActivityCategory> | null) => void;
}) {
  if (categories.length < 2) return null;
  const selectedLabel =
    selected === null
      ? "All"
      : selected.size === 1
        ? ACTIVITY_CATEGORY_LABELS[[...selected][0]]
        : `${selected.size} events`;

  const toggle = (category: ActivityCategory) => {
    const next = selected === null ? new Set(categories) : new Set(selected);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    onChange(next.size === categories.length ? null : next);
  };

  return (
    <details className="group relative z-20">
      <summary className="flex min-h-11 cursor-pointer list-none select-none items-center justify-between gap-2 border border-teal-200 bg-teal-50 px-3 text-sm text-zinc-600 transition-colors hover:border-teal-400 focus-visible:border-teal-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span>{selectedLabel}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 opacity-60 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="absolute right-0 top-full mt-1 min-w-56 border border-teal-300 bg-teal-50 p-2 shadow-lg">
        <label className="flex cursor-pointer items-center gap-2 border-b border-teal-200 px-1 py-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={selected === null}
            onChange={() => onChange(selected === null ? new Set() : null)}
          />
          All
        </label>
        {categories.map((category) => (
          <label
            key={category}
            className="flex cursor-pointer items-center gap-2 px-1 py-2 text-sm text-zinc-600"
          >
            <input
              type="checkbox"
              checked={selected === null || selected.has(category)}
              onChange={() => toggle(category)}
            />
            {ACTIVITY_CATEGORY_LABELS[category]}
          </label>
        ))}
      </div>
    </details>
  );
}

export function ActivityFeed({ suckerGroupId, projects }: Props) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_ITEMS);
  const [selectedCategories, setSelectedCategories] = useState<Set<ActivityCategory> | null>(null);
  const { data, isLoading, isError } = useCompleteActivityEvents(
    {
      orderBy: "timestamp",
      orderDirection: "desc",
      where: { suckerGroupId },
    },
    Number(projects[0]?.chainId ?? 1),
  );

  const items = data ?? [];

  // Token amounts when every chain shares one accounting-token kind; indexed
  // USD when the sucker group's chains disagree (ecosystem convention).
  const events = mapActivityEvents(
    items.filter(isProjectFeedActivityEvent),
    projectFeedTokenContext(projects),
  );

  const categories: ActivityCategory[] = [];
  events.forEach((event) => {
    const category = activityCategory(event);
    if (category && !categories.includes(category)) categories.push(category);
  });
  // Filter by category first, then collapse same-tx rows — filtering to one
  // category still surfaces that category's own fragment on its own row.
  const filteredEvents = groupSameTxEvents(
    events.filter((event) => {
      const category = activityCategory(event);
      return selectedCategories === null || (!!category && selectedCategories.has(category));
    }),
  );
  const visibleEvents = filteredEvents.slice(0, visibleCount);
  const hasMore = filteredEvents.length > visibleCount;
  const addresses = visibleEvents.map((e) => e.beneficiary);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        {/* Same voice as the project tabs — the icon and type the Latest tab
            uses when the feed collapses into the tab bar. */}
        <h3 className="flex items-center gap-2 text-base font-medium uppercase">
          <ProjectTabIcon label="Activity" />
          Latest
        </h3>
        <ActivityTypeFilter
          categories={categories}
          selected={selectedCategories}
          onChange={(next) => {
            setSelectedCategories(next);
            setVisibleCount(INITIAL_ITEMS);
          }}
        />
      </div>
      <ProfilesProvider addresses={addresses}>
        <div className="pr-1">
          {isError ? (
            <p className="py-4 text-center text-sm text-red-600">
              Activity is temporarily unavailable. Try again shortly.
            </p>
          ) : visibleEvents.length > 0 ? (
            <div className="flex flex-col">
              {visibleEvents.map((event) => (
                <ActivityItem key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <div className={isLoading ? "py-2" : "py-4 text-center"}>
              {isLoading ? (
                <ActivityFeedSkeleton />
              ) : (
                <p className="text-sm text-zinc-500">
                  {events.length ? "No activity matches this filter." : "No activity yet"}
                </p>
              )}
            </div>
          )}
        </div>

        {hasMore && (
          <button
            onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_COUNT)}
            className="mt-3 min-h-8 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
          >
            more
          </button>
        )}
      </ProfilesProvider>
    </div>
  );
}
