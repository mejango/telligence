"use client";

import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { readAllProjectRulesets, type RawRuleset } from "@/lib/nana/rulesets";
import { PERSIST } from "@/lib/query-persist";
import { wagmiConfig } from "@/lib/wagmiConfig";
import {
  JBCoreContracts,
  RulesetWeight,
  WeightCutPercent,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { getPublicClient } from "wagmi/actions";

export function projectRulesetsQueryOptions(
  chainId: JBChainId | undefined,
  projectId: bigint,
  rulesetsContract: Address,
) {
  return queryOptions({
    queryKey: ["all-rulesets", chainId, projectId.toString(), rulesetsContract.toLowerCase()],
    // Ruleset LISTS are immutable only for revnets, whose stages are fixed at deploy. This app also
    // renders ordinary projects, whose owner can queue a new ruleset at any time — caching those
    // forever left Terms and stages permanently stale ACROSS SESSIONS. Persisted-but-revalidating
    // is correct for both: a revnet's list simply never differs on revalidation.
    meta: PERSIST,
    staleTime: 60_000,
    gcTime: Infinity,
    enabled: !!chainId,
    queryFn: async () => {
      const client = getPublicClient(wagmiConfig, { chainId });
      if (!client) throw new Error(`No public client for chain ${chainId}.`);
      const rulesets = await readAllProjectRulesets(client, rulesetsContract, projectId);
      return rulesets.reverse();
    },
  });
}

function selectDisplayRulesets(rulesets: RawRuleset[]) {
  return rulesets.map((ruleset) => ({
    ...ruleset,
    weight: new RulesetWeight(ruleset.weight),
    weightCutPercent: new WeightCutPercent(ruleset.weightCutPercent),
  }));
}

export function useRulesets() {
  const { projectId, contractAddress } = useJBContractContext();
  const chainId = useJBChainId();
  const { data, ...rest } = useQuery({
    ...projectRulesetsQueryOptions(chainId, projectId, contractAddress(JBCoreContracts.JBRulesets)),
    select: selectDisplayRulesets,
  });

  return { rulesets: data, ...rest };
}
