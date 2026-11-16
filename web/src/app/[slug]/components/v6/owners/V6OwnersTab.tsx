"use client";

import { CardSkeleton } from "@/components/loading/CardSkeleton";
import { projectViewHref } from "@/lib/projectSubtabNavigation";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { twJoin } from "tailwind-merge";
import { useProjectNavigation } from "../../../ProjectRouteContext";
import { ProjectItem } from "../shared";
import { V6AccountsSubtab } from "./accounts/V6AccountsSubtab";
import { V6TokenPanel } from "./V6TokenPanel";

const V6MarketSubtab = dynamic(
  () => import("./market/V6MarketSubtab").then((module) => module.V6MarketSubtab),
  { loading: () => <CardSkeleton rows={4} /> },
);
const V6SettlementSubtab = dynamic(
  () => import("./settlement/V6SettlementSubtab").then((module) => module.V6SettlementSubtab),
  { loading: () => <CardSkeleton rows={4} /> },
);
const V6AutoIssuanceSubtab = dynamic(
  () => import("./V6AutoIssuanceSubtab").then((module) => module.V6AutoIssuanceSubtab),
  { loading: () => <CardSkeleton rows={4} /> },
);
const V6LoansSubtab = dynamic(
  () => import("./V6LoansSubtab").then((module) => module.V6LoansSubtab),
  { loading: () => <CardSkeleton rows={4} /> },
);
const V6SplitsSubtab = dynamic(
  () => import("./V6SplitsSubtab").then((module) => module.V6SplitsSubtab),
  { loading: () => <CardSkeleton rows={4} /> },
);

const SUBTABS = [
  { key: "accounts", label: "Accounts" },
  { key: "market", label: "Market" },
  { key: "settlement", label: "Settlement" },
  { key: "splits", label: "Splits" },
  { key: "auto-issuance", label: "Auto issuance" },
  { key: "loans", label: "Loans" },
] as const;

type SubtabKey = (typeof SUBTABS)[number]["key"];

/**
 * The website/-parity Owners tab for V6 projects: a caps-label subtab row over
 * Accounts | Market | Settlement | Splits | Auto issuance | Loans. Subtabs are
 * lazy-mounted on first open (then kept alive, hidden, to preserve their state),
 * and the active subtab is reflected in the URL via `?subtab=` for deep links.
 */
export function V6OwnersTab({ projects }: { projects: ProjectItem[] }) {
  return (
    // useSearchParams (for the ?subtab= deep link) requires a Suspense boundary.
    <Suspense fallback={<CardSkeleton rows={4} />}>
      <OwnersTabInner projects={projects} />
    </Suspense>
  );
}

function OwnersTabInner({ projects }: { projects: ProjectItem[] }) {
  const navigate = useProjectNavigation();
  const searchParams = useSearchParams();
  const requested = searchParams.get("subtab");
  const initial: SubtabKey = SUBTABS.some((t) => t.key === requested)
    ? (requested as SubtabKey)
    : "accounts";

  const active = initial;
  const [mounted, setMounted] = useState<ReadonlySet<SubtabKey>>(() => new Set([initial]));

  const show = (key: SubtabKey) => {
    const href = projectViewHref(window.location.href, "subtab", key);
    navigate(() => {
      setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      window.history.replaceState(null, "", href);
    }, href);
  };

  const panel = (key: SubtabKey, node: React.ReactNode) =>
    mounted.has(key) || active === key ? (
      <div className={active === key ? "" : "hidden"}>{node}</div>
    ) : null;

  return (
    <div className="text-gray-600 text-md">
      <V6TokenPanel projects={projects} />

      <div className="flex gap-4 sm:gap-6 overflow-x-auto mb-6">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            type="button"
            data-project-navigation="local"
            onClick={() => show(t.key)}
            className={twJoin(
              "uppercase text-sm font-medium tracking-wide whitespace-nowrap pb-1 transition-all",
              active === t.key
                ? "text-black underline decoration-teal-500 underline-offset-8 decoration-2"
                : "text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {panel("accounts", <V6AccountsSubtab projects={projects} />)}
      {panel("market", <V6MarketSubtab projects={projects} />)}
      {panel("settlement", <V6SettlementSubtab projects={projects} />)}
      {panel("splits", <V6SplitsSubtab projects={projects} />)}
      {panel("auto-issuance", <V6AutoIssuanceSubtab projects={projects} />)}
      {panel("loans", <V6LoansSubtab projects={projects} />)}
    </div>
  );
}
