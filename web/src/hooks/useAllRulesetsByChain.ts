"use client";

import { useJBContractContext } from "@/lib/nana/project";
import { readAllProjectRulesets, type RawRuleset } from "@/lib/nana/rulesets";
import type { JBChainId } from "@/lib/nana/types";
import { PERSIST } from "@/lib/query-persist";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "wagmi/actions";

export function useAllRulesetsByChain(
  projects: readonly { chainId: JBChainId; projectId: number }[],
) {
  const { contractAddress } = useJBContractContext();
  const key = projects
    .map((p) => `${p.chainId}:${p.projectId}`)
    .sort()
    .join("|");

  return useQuery({
    queryKey: ["all-rulesets-by-chain", key],
    // Ruleset LISTS are immutable only for revnets, whose stages are fixed at deploy. This app also
    // renders ordinary projects, whose owner can queue a new ruleset at any time — caching those
    // forever left Terms and stages permanently stale ACROSS SESSIONS. Persisted-but-revalidating
    // is correct for both: a revnet's list simply never differs on revalidation.
    meta: PERSIST,
    staleTime: 60_000,
    gcTime: Infinity,
    enabled: projects.length > 0,
    queryFn: async (): Promise<Record<number, RawRuleset[]>> => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const client = getPublicClient(wagmiConfig, { chainId: project.chainId });
          if (!client) throw new Error(`No public client for chain ${project.chainId}.`);
          const rulesets = await readAllProjectRulesets(
            client,
            contractAddress(JBCoreContracts.JBRulesets, project.chainId),
            BigInt(project.projectId),
          );
          return [Number(project.chainId), rulesets.slice().reverse()] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });
}
