"use client";

import { ShopInventorySkeleton } from "@/components/loading/LoadingSkeletons";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { decodeProjectRouteSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ProjectItem } from "../shared";
import { CustomersSection } from "./CustomersSection";
import { InventorySection } from "./InventorySection";
import { useShopInventory, useTierMedia } from "./shopLib";

const SUBTABS = [
  { key: "inventory", label: "INVENTORY" },
  { key: "customers", label: "CUSTOMERS" },
] as const;

type SubtabKey = (typeof SUBTABS)[number]["key"];

export function shopSubtabNavigation(slug: string, currentHref: string, key: SubtabKey) {
  const url = new URL(currentHref);
  url.searchParams.set("subtab", key);
  return {
    href: url.href,
    mode: decodeProjectRouteSlug(slug)?.startsWith("@") ? "document" : "client",
  } as const;
}

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
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const requested = searchParams.get("subtab");
  const initial: SubtabKey = SUBTABS.some((tab) => tab.key === requested)
    ? (requested as SubtabKey)
    : "inventory";
  const [subtab, setSubtab] = useState<SubtabKey>(initial);
  // Lazy mount: a subtab renders the first time it's opened, then stays
  // mounted (hidden) so its state and queries survive switching back.
  const [visited, setVisited] = useState<Record<SubtabKey, boolean>>({
    inventory: initial === "inventory",
    customers: initial === "customers",
  });

  const show = (key: SubtabKey) => {
    const navigation = shopSubtabNavigation(params.slug, window.location.href, key);
    if (navigation.mode === "document") {
      // The alias may have rebound while this shop remained mounted. Resolve
      // it again before revealing another project's cached inventory data.
      window.location.assign(navigation.href);
      return;
    }
    setSubtab(key);
    setVisited((current) => (current[key] ? current : { ...current, [key]: true }));
    window.history.replaceState(null, "", navigation.href);
  };

  const shopQuery = useShopInventory(chainId, projectId);
  const { data: mediaById } = useTierMedia(chainId, shopQuery.data);

  if (!chainId) return null;

  if (shopQuery.isLoading) {
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

      {visited.inventory ? (
        <div className={subtab === "inventory" ? "" : "hidden"}>
          <InventorySection
            shop={shop}
            chainId={chainId}
            projectId={projectId}
            projects={projects}
            mediaById={mediaById}
          />
        </div>
      ) : null}

      {visited.customers ? (
        <div className={subtab === "customers" ? "" : "hidden"}>
          <CustomersSection shop={shop} mediaById={mediaById} projects={projects} />
        </div>
      ) : null}
    </div>
  );
}
