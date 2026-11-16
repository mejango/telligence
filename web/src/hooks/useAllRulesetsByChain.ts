"use client";

import { useJBContractContext } from "@/lib/nana/project";
import type { RawRuleset } from "@/lib/nana/rulesets";
import type { JBChainId } from "@/lib/nana/types";
import { JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useQueries } from "@tanstack/react-query";
import { projectRulesetsQueryOptions } from "./useRulesets";

export function useAllRulesetsByChain(
  projects: readonly { chainId: JBChainId; projectId: number }[],
) {
  const { contractAddress } = useJBContractContext();

  return useQueries({
    queries: projects.map((project) =>
      projectRulesetsQueryOptions(
        project.chainId,
        BigInt(project.projectId),
        contractAddress(JBCoreContracts.JBRulesets, project.chainId),
      ),
    ),
    combine: (queries) => ({
      // Missing history is not an empty stage list. Keep the aggregate incomplete
      // until every chain has data; failed refreshes retain the last verified rows.
      data: queries.every((query) => query.data !== undefined)
        ? (Object.fromEntries(
            queries.map((query, index) => [projects[index].chainId, query.data!]),
          ) as Record<number, RawRuleset[]>)
        : undefined,
      isLoading: queries.some((query) => query.isLoading),
      isError: queries.some((query) => query.isError),
      error: queries.find((query) => query.error)?.error ?? null,
    }),
  });
}
