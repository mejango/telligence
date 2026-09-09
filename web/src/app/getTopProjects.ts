import { TopSuckerGroupsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { TopSuckerGroupsQuery } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { fetchEthPrice } from "@/lib/ethPrice";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";
import { formatUnits } from "viem";

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

  const needsEthPrice = top.suckerGroups.items.some(
    (group) =>
      group.projects?.items[0]?.isRevnet &&
      group.projects.items[0].tokenSymbol?.toUpperCase() === "ETH",
  );
  // The ETH price only converts ETH-denominated balances for ranking. When the
  // feed fails, drop those rows (they can't be ranked honestly) but keep the
  // rows that never needed the price instead of blanking the whole table.
  const ethPrice = needsEthPrice ? await fetchEthPrice() : null;

  const ranked = top.suckerGroups.items
    .map((group) => {
      const project = group.projects?.items[0];
      if (!project || !project.isRevnet) return null;

      const symbol = project.tokenSymbol?.toUpperCase();
      if (symbol !== "ETH" && symbol !== "USDC") return null;
      if (symbol === "ETH" && ethPrice === null) return null;

      const balance = Number(formatUnits(BigInt(group.balance), project.decimals ?? 18));
      const balanceUsd = symbol === "ETH" ? balance * (ethPrice ?? 0) : balance;

      return { project, balanceUsd };
    })
    .filter((item) => item !== null)
    .sort((a, b) => b.balanceUsd - a.balanceUsd)
    .slice(offset, offset + limit)
    .map((item, index) => {
      const { project, balanceUsd } = item;
      const chainId = project.chainId as JBChainId;

      return {
        rank: offset + index + 1,
        projectId: project.projectId,
        chainId: chainId,
        chainSlug: JB_CHAINS[chainId]?.slug ?? "eth",
        name: project.name ?? `Project #${project.projectId}`,
        tagline: project.projectTagline ?? null,
        logoUri: ipfsUriToAppUrl(project.logoUri) ? project.logoUri : null,
        balanceUsd,
      };
    });

  return Promise.all(
    ranked.map(async (project) => ({
      ...project,
      issuanceFingerprint: await getIssuanceFingerprint(project.projectId, project.chainId),
    })),
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
  ["top-projects-v3"],
  { revalidate: 600 }, // 10 minutes
);
