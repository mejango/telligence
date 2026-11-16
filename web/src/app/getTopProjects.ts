import { usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import { TopSuckerGroupsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { TopSuckerGroupsQuery } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import { fillIndexedMetadata } from "@/lib/projectMetadataFill.server";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";

function scaledUsd(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(String(value).split(".")[0]);
  } catch {
    return null;
  }
}

/**
 * The group member holding the most money, so a cross-chain group links to the chain its
 * balance is on. Ties and unpriced members fall back to the earliest member. Juicebox
 * Money's top-projects reader applies the same rule.
 */
function largestBalanceProject<T extends { balanceUsd?: unknown }>(
  projects: readonly T[],
): T | undefined {
  let best = projects[0];
  let bestUsd = scaledUsd(best?.balanceUsd);
  for (const project of projects.slice(1)) {
    const usd = scaledUsd(project.balanceUsd);
    if (usd !== null && (bestUsd === null || usd > bestUsd)) {
      best = project;
      bestUsd = usd;
    }
  }
  return best;
}

export async function getTopProjects(limit = 8, offset = 0) {
  let top: TopSuckerGroupsQuery;
  try {
    top = await fetchTopProjects();
  } catch (error) {
    // Bendystraw is a derivative view. Its availability must never make the
    // canonical landing page unavailable or prevent a production build.
    console.error("Failed to load top projects:", error);
    return [];
  }

  const ranked = top.suckerGroups.items
    .map((group) => {
      const project = largestBalanceProject(group.projects?.items ?? []);
      const balanceUsd = usdFromScaled(group.balanceUsd);
      if (!project?.isRevnet || balanceUsd === null) return null;
      return { project, balanceUsd };
    })
    .filter((item) => item !== null)
    .sort((a, b) => b.balanceUsd - a.balanceUsd)
    .slice(offset, offset + limit);

  const projects = await fillIndexedMetadata(ranked.map((item) => item.project));

  return Promise.all(
    ranked.map(async ({ balanceUsd }, index) => {
      const project = projects[index]!;
      const chainId = project.chainId as JBChainId;

      return {
        rank: offset + index + 1,
        projectId: project.projectId,
        chainId: chainId,
        chainSlug: JB_CHAINS[chainId]?.slug ?? "eth",
        href: `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`,
        name: project.name ?? `Project #${project.projectId}`,
        tagline: project.projectTagline ?? null,
        logoUri: ipfsUriToAppUrl(project.logoUri) ? project.logoUri : null,
        balanceUsd,
        issuanceFingerprint: await getIssuanceFingerprint(project.projectId, chainId),
      };
    }),
  );
}

const fetchTopProjects = unstable_cache(
  async () => {
    const items: TopSuckerGroupsQuery["suckerGroups"]["items"] = [];
    let totalCount = 0;
    do {
      const page = await queryBendystraw(mainnet.id, TopSuckerGroupsOperation, {
        limit: 1000,
        offset: items.length,
      });
      const pageItems = page.suckerGroups.items ?? [];
      totalCount = page.suckerGroups.totalCount ?? pageItems.length;
      items.push(...pageItems);
      if (!pageItems.length) break;
    } while (items.length < totalCount);
    return { suckerGroups: { items, totalCount } };
  },
  ["top-projects-v5"],
  { revalidate: 600 }, // 10 minutes
);
