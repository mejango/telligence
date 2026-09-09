"use client";

import { FALLBACK_RULESET_ID, RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import { useFetchProjectRulesets } from "@/hooks/useFetchProjectRulesets";
import { useJBContractContext } from "@/lib/nana/project";
import { useSuckers } from "@/lib/nana/suckers";
import { JBCoreContracts, jbSplitsAbi } from "@bananapus/nana-sdk-core";
import { useCallback, useMemo } from "react";
import { useReadContracts } from "wagmi";
import { chainsAtStage } from "../splitsLib";

/**
 * The reserved splits for one stage on every chain the project is on.
 *
 * `stageIdx` is the stage's INDEX in the chronological ruleset list — the same
 * stage carries a different ruleset id on each chain, so an id can't address it.
 *
 * Each chain also reports the size of its fallback (ruleset 0) group, because
 * `JBSplits.splitsOf` serves that group whenever the stage's own group is empty.
 */
export function useChainSplits(stageIdx: number) {
  const { contractAddress } = useJBContractContext();
  const { data: suckers, refetch } = useSuckers();
  const { suckerPairsWithRulesets } = useFetchProjectRulesets(suckers);

  const stageChains = useMemo(
    () => chainsAtStage(suckerPairsWithRulesets, stageIdx),
    [suckerPairsWithRulesets, stageIdx],
  );

  const contracts = useMemo(
    () =>
      stageChains.flatMap((chain) => {
        const splitsOf = {
          chainId: chain.chainId,
          abi: jbSplitsAbi,
          address: contractAddress(JBCoreContracts.JBSplits, chain.chainId),
          functionName: "splitsOf" as const,
        };
        return [
          {
            ...splitsOf,
            args: [chain.projectId, chain.rulesetId, RESERVED_TOKEN_SPLIT_GROUP_ID] as const,
          },
          {
            ...splitsOf,
            args: [chain.projectId, FALLBACK_RULESET_ID, RESERVED_TOKEN_SPLIT_GROUP_ID] as const,
          },
        ];
      }),
    [stageChains, contractAddress],
  );

  const {
    data,
    isLoading,
    refetch: refetchSplits,
  } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });

  const chainSplits = useMemo(() => {
    if (!data) return [];

    return stageChains.map((chain, idx) => {
      const stageResult = data[idx * 2];
      const fallbackResult = data[idx * 2 + 1];
      return {
        chainId: chain.chainId,
        projectId: chain.projectId,
        rulesetId: chain.rulesetId,
        splits: stageResult?.status === "success" ? stageResult.result : [],
        // null when the read failed — the empty-save guard fails closed on it.
        fallbackSplitCount:
          fallbackResult?.status === "success" ? fallbackResult.result.length : null,
      };
    });
  }, [data, stageChains]);

  const allRulesets = useMemo(() => {
    if (!suckerPairsWithRulesets || suckerPairsWithRulesets.length === 0) return [];
    return suckerPairsWithRulesets[0].rulesets;
  }, [suckerPairsWithRulesets]);

  // The splits themselves are what an edit changes; refreshing only the sucker
  // list would leave the editor showing pre-edit recipients.
  const refetchAll = useCallback(async () => {
    await Promise.all([refetch(), refetchSplits()]);
  }, [refetch, refetchSplits]);

  return {
    chainSplits,
    allRulesets,
    isLoading,
    refetch: refetchAll,
  };
}
