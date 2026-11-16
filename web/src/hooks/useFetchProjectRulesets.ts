import { useJBContractContext } from "@/lib/nana/project";
import type { RawRuleset } from "@/lib/nana/rulesets";
import { decodeRulesetMetadata, RulesetMetadata } from "@/lib/utils";
import { JBCoreContracts, SuckerPair } from "@bananapus/nana-sdk-core";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";
import { projectRulesetsQueryOptions } from "./useRulesets";

type RuleSet = {
  cycleNumber: number;
  id: number;
  basedOnId: number;
  start: number;
  duration: number;
  weight: bigint;
  weightCutPercent: number;
  approvalHook: `0x${string}`;
  metadata: RulesetMetadata;
};

type SuckerPairWithRulesets = SuckerPair & {
  readonly rulesets: readonly RuleSet[];
};

export function useFetchProjectRulesets(suckers: SuckerPair[] | undefined | null) {
  const { contractAddress } = useJBContractContext();
  const combine = useCallback(
    (queries: UseQueryResult<RawRuleset[], Error>[]) => {
      const error = queries.find((query) => query.error)?.error ?? null;
      const complete = queries.length > 0 && queries.every((query) => query.data !== undefined);
      return {
        suckerPairsWithRulesets:
          !error && complete
            ? suckers?.map((sucker, index): SuckerPairWithRulesets => ({
                ...sucker,
                rulesets: queries[index].data!.map((ruleset) => ({
                  ...ruleset,
                  metadata: decodeRulesetMetadata(ruleset.metadata),
                })),
              }))
            : undefined,
        isLoading: !suckers || queries.some((query) => query.isLoading),
        error,
      };
    },
    [suckers],
  );

  return useQueries({
    queries: (suckers ?? []).map((sucker) =>
      projectRulesetsQueryOptions(
        sucker.peerChainId,
        sucker.projectId,
        contractAddress(JBCoreContracts.JBRulesets, sucker.peerChainId),
      ),
    ),
    combine,
  });
}
