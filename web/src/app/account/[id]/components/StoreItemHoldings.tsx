"use client";

import { TierMediaPreview } from "@/app/[slug]/components/v6/shop/TierMediaPreview";
import { tierDisplayName, type TierMedia } from "@/app/[slug]/components/v6/shop/shopLib";
import { ChainLogo } from "@/components/ChainLogo";
import { SkeletonLines } from "@/components/ui/skeleton";
import {
  useCompleteOwnedNfts,
  useCompleteProjectsByRefs,
} from "@/hooks/useCompleteBendystrawLists";
import { projectRefKey, projectRefsWheres } from "@/lib/accountHoldings";
import type { OwnedProjectRow } from "@/lib/bendystraw/types";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import type { JBChainId } from "@/lib/nana/types";
import { slugFor } from "@/lib/slug";
import { parseTierMetadataJson, tierDisplayMetadata } from "@/lib/v6/pay";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import type { Address } from "viem";

type TierHolding = {
  /** Media/query key — one resolution per (chainId, projectId, tierId). */
  key: string;
  tierId: number;
  count: number;
  tokenUri: string | null;
};

type ProjectItems = {
  key: string;
  chainId: JBChainId;
  projectId: number;
  name: string;
  /** The shop route for the project; every row is v6 so this always resolves. */
  slug: string | undefined;
  tiers: TierHolding[];
};

/**
 * Best-effort tier metadata from an owned token's URI: inline data-JSON first
 * (the resolver idiom), then the immutable IPFS JSON through the app gateway —
 * the same resolution chain the shop tab uses (resolveTierMedia).
 */
async function resolveNftTokenMedia(tokenUri: string | null): Promise<TierMedia> {
  if (!tokenUri) return {};
  const inline = parseTierMetadataJson(tokenUri);
  if (inline) return tierDisplayMetadata(inline);

  const url = ipfsUriToAppUrl(tokenUri) ?? (/^https?:\/\//u.test(tokenUri) ? tokenUri : undefined);
  if (!url) return {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return {};
    const contentType = res.headers?.get("content-type")?.toLowerCase() ?? "";
    if (/^(?:image|audio|video)\//u.test(contentType)) {
      return tierDisplayMetadata({ image: url, mediaType: contentType.split(";", 1)[0] });
    }
    const json = (await res.json()) as unknown;
    return json && typeof json === "object"
      ? tierDisplayMetadata(json as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function StoreItemHoldings({ address }: { address: Address }) {
  // This app is V6-only: the version pin keeps other protocol versions' rows
  // (which reuse projectIds for unrelated projects) out entirely.
  const nftsQuery = useCompleteOwnedNfts({ owner: address.toLowerCase(), version: 6 });

  const items = useMemo(
    () => (nftsQuery.data ?? []).filter((item) => !!JB_CHAINS[item.chainId as JBChainId]),
    [nftsQuery.data],
  );

  const refsWheres = useMemo(() => projectRefsWheres(items), [items]);
  const projectsQuery = useCompleteProjectsByRefs(refsWheres, refsWheres.length > 0);
  const projectByRef = useMemo(() => {
    const map = new Map<string, OwnedProjectRow>();
    for (const project of projectsQuery.data ?? []) {
      map.set(projectRefKey(project), project);
    }
    return map;
  }, [projectsQuery.data]);

  const groups = useMemo<ProjectItems[]>(() => {
    const byProject = new Map<string, ProjectItems>();
    for (const item of items) {
      const key = projectRefKey(item);
      const project = projectByRef.get(key);
      const group = byProject.get(key) ?? {
        key,
        chainId: item.chainId as JBChainId,
        projectId: item.projectId,
        name: project?.name ?? project?.handle ?? `Project #${item.projectId}`,
        slug: slugFor(item.chainId, item.projectId),
        tiers: [],
      };
      const tierKey = `${item.chainId}:${item.projectId}:${item.tierId}`;
      const tier = group.tiers.find((candidate) => candidate.key === tierKey);
      if (tier) {
        tier.count += 1;
        tier.tokenUri ??= item.tokenUri;
      } else {
        group.tiers.push({ key: tierKey, tierId: item.tierId, count: 1, tokenUri: item.tokenUri });
      }
      byProject.set(key, group);
    }
    return [...byProject.values()]
      .map((group) => ({
        ...group,
        tiers: [...group.tiers].sort((a, b) => b.count - a.count || a.tierId - b.tierId),
      }))
      .sort(
        (a, b) =>
          b.tiers.reduce((sum, tier) => sum + tier.count, 0) -
          a.tiers.reduce((sum, tier) => sum + tier.count, 0),
      );
  }, [items, projectByRef]);

  // One best-effort media resolution per distinct tier, cached forever — the
  // token URI (and the IPFS JSON behind it) is immutable.
  const tiers = useMemo(() => groups.flatMap((group) => group.tiers), [groups]);
  const mediaByKey = useQueries({
    queries: tiers.map((tier) => ({
      queryKey: ["accountNftTierMedia", tier.key],
      staleTime: Infinity,
      queryFn: () => resolveNftTokenMedia(tier.tokenUri),
    })),
    combine: (results) => {
      const map: Record<string, TierMedia> = {};
      results.forEach((result, index) => {
        if (result.data) map[tiers[index].key] = result.data;
      });
      return map;
    },
  });

  const isLoading = nftsQuery.isLoading || (items.length > 0 && projectsQuery.isLoading);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Store items</h2>
      {isLoading ? (
        <SkeletonLines lines={3} className="mt-3" />
      ) : nftsQuery.isError ? (
        <p className="text-sm text-zinc-500">Could not read store items.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-zinc-500">This account owns no store items.</p>
      ) : (
        <>
          <div className="divide-y divide-melon-200 bg-melon-50 px-4">
            {groups.map((group) => (
              <div key={group.key} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ChainLogo chainId={group.chainId} width={16} height={16} standalone />
                  {group.slug ? (
                    <Link
                      href={`/${group.slug}/shop`}
                      className="text-sm font-medium hover:underline"
                    >
                      {group.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{group.name}</span>
                  )}
                </div>
                <div className="mt-2 divide-y divide-zinc-100">
                  {group.tiers.map((tier) => {
                    const media = mediaByKey[tier.key];
                    const name = tierDisplayName(media, tier.tierId);
                    return (
                      <div key={tier.key} className="flex items-center gap-3 py-1.5 text-sm">
                        <div className="h-10 w-10 shrink-0 overflow-hidden border border-zinc-200 bg-white">
                          <TierMediaPreview media={media} tierId={tier.tierId} alt={name} />
                        </div>
                        <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">
                          {name}
                        </span>
                        <span className="text-zinc-500">×{tier.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
