"use client";

import { PERSIST } from "@/lib/query-persist";
import { useQuery } from "@tanstack/react-query";
import { ProjectItem } from "../../shared";
import { chainProjectsKey, projectTokenSymbol, toChainProjects } from "../settlement/lib";
import { AmmCard } from "./AmmCard";
import { MarketPriceChart } from "./MarketPriceChart";
import { SplitHookCard } from "./SplitHookCard";

/**
 * Owners → Market: the project's buyback-hook Uniswap V4 pool per chain, plus
 * the LP split-hook card when a reserved split routes to it (website/
 * renderOwnersAmm + renderSplitHookCard parity).
 */
export function V6MarketSubtab({ projects }: { projects: ProjectItem[] }) {
  const chains = toChainProjects(projects);

  const { data: tokenSymbol = "tokens" } = useQuery({
    queryKey: ["v6ProjectTokenSymbol", chainProjectsKey(chains)],
    meta: PERSIST,
    enabled: projects.length > 0,
    staleTime: Infinity,
    queryFn: () => projectTokenSymbol(projects),
  });

  if (chains.length === 0) {
    return <div className="text-zinc-500">No project chains found.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <MarketPriceChart chains={chains} tokenSymbol={tokenSymbol} />
      <AmmCard chains={chains} tokenSymbol={tokenSymbol} />
      <SplitHookCard chains={chains} tokenSymbol={tokenSymbol} />
    </div>
  );
}
