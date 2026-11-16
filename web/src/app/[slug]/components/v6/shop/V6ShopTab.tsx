"use client";

import { ShopInventorySkeleton } from "@/components/loading/LoadingSkeletons";
import { useHydrated } from "@/hooks/useHydrated";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { projectViewHref } from "@/lib/projectSubtabNavigation";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useProjectNavigation } from "../../../ProjectRouteContext";
import { ProjectItem } from "../shared";
import { CustomersSection } from "./CustomersSection";
import { InventorySection } from "./InventorySection";
import { useShopInventory, useTierMedia } from "./shopLib";

const SUBTABS = [
  { key: "inventory", label: "INVENTORY" },
  { key: "customers", label: "CUSTOMERS" },
] as const;

type SubtabKey = (typeof SUBTABS)[number]["key"];

/**
 * The Shop tab (website/ renderShopTab parity): INVENTORY | CUSTOMERS
 * subtabs over the project's 721 tiers hook. Items added here land in the
 * shared shop cart the Pay card checks out from.
 */
export function V6ShopTab({ projects }: { projects: ProjectItem[] }) {
  return (
    <Suspense fallback={<ShopInventorySkeleton />}>
      <ShopTabInner projects={projects} />
    </Suspense>
  );
}

function ShopTabInner({ projects }: { projects: ProjectItem[] }) {
  const navigate = useProjectNavigation();
  const searchParams = useSearchParams();
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const requested = searchParams.get("subtab");
  const initial: SubtabKey = SUBTABS.some((tab) => tab.key === requested)
    ? (requested as SubtabKey)
    : "inventory";
  const subtab = initial;
  // Lazy mount: a subtab renders the first time it's opened, then stays
  // mounted (hidden) so its state and queries survive switching back.
  const [visited, setVisited] = useState<Record<SubtabKey, boolean>>({
    inventory: initial === "inventory",
    customers: initial === "customers",
  });

  const show = (key: SubtabKey) => {
    const href = projectViewHref(window.location.href, "subtab", key);
    navigate(() => {
      setVisited((current) => (current[key] ? current : { ...current, [key]: true }));
      window.history.replaceState(null, "", href);
    }, href);
  };

  const [retryingMedia, setRetryingMedia] = useState(false);
  const shopQuery = useShopInventory(chainId, projectId);
  const media = useTierMedia(chainId, shopQuery.data);
  const mediaById = media.data;
  // The Pay card can fill this query before this boundary hydrates, so match the server first.
  const hydrated = useHydrated();

  if (!chainId) return null;

  if (!hydrated || shopQuery.isLoading) {
    return <ShopInventorySkeleton />;
  }
  if (shopQuery.isError) {
    return (
      <div className="text-zinc-500">
        Couldn&apos;t load the shop right now — try again in a moment.
      </div>
    );
  }
  if (!shopQuery.data) {
    return <div className="text-zinc-500">This project has no shop.</div>;
  }

  const shop = shopQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-5 border-b border-zinc-200">
        {SUBTABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            data-project-navigation="local"
            onClick={() => show(tab.key)}
            className={cn(
              "-mb-px pb-2 text-sm font-medium tracking-wide transition-colors",
              subtab === tab.key
                ? "border-b-2 border-teal-500 text-zinc-900"
                : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visited.inventory || subtab === "inventory" ? (
        <div className={subtab === "inventory" ? "" : "hidden"}>
          {media.isError || retryingMedia ? (
            <p className="mb-4 text-sm text-zinc-500" role="status">
              Some item details could not be loaded.{" "}
              <button
                type="button"
                className="underline disabled:opacity-50"
                disabled={retryingMedia || media.isFetching}
                onClick={() => {
                  setRetryingMedia(true);
                  void media.retryFailed().finally(() => setRetryingMedia(false));
                }}
              >
                {retryingMedia || media.isFetching ? "Retrying details…" : "Retry details"}
              </button>
            </p>
          ) : null}
          <InventorySection
            shop={shop}
            chainId={chainId}
            projectId={projectId}
            projects={projects}
            mediaById={mediaById}
          />
        </div>
      ) : null}

      {visited.customers || subtab === "customers" ? (
        <div className={subtab === "customers" ? "" : "hidden"}>
          <CustomersSection shop={shop} mediaById={mediaById} projects={projects} />
        </div>
      ) : null}
    </div>
  );
}
