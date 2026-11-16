"use client";

import { useCompleteProjectPermissions } from "@/hooks/useCompleteBendystrawLists";
import { findCurrentRevnetOperator, revnetOperatorCandidates } from "@/lib/revnetOperator";
import { getJBContractAddress, RevnetCoreContracts } from "@bananapus/nana-sdk-core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { isAddress, type Address } from "viem";
import {
  isLiveRevnetOperator,
  permissionHoldersWhere,
  publicClientFor,
  type ChainProjectRow,
} from "./operatorLib";

export type LiveOperatorFallback = ChainProjectRow & { address?: string };

/**
 * Bendystraw supplies bounded REVOwner-account candidates; target-chain
 * JBProjects/REVOwner reads decide which address is actually authoritative.
 */
export function useLiveRevnetOperators(
  rows: readonly ChainProjectRow[],
  fallback?: LiveOperatorFallback,
) {
  const revOwnerAccount = rows[0]
    ? getJBContractAddress(RevnetCoreContracts.REVOwner, 6, rows[0].chainId)
    : undefined;
  const holders = useCompleteProjectPermissions(
    permissionHoldersWhere(rows, revOwnerAccount ? { account: revOwnerAccount } : undefined),
    rows.length > 0 && Boolean(revOwnerAccount),
  );

  const candidates = useMemo(
    () =>
      rows.map((row) => {
        const values = revnetOperatorCandidates(
          (holders.data ?? []).filter(
            (item) => item.chainId === row.chainId && item.projectId === row.projectId,
          ),
        );
        if (
          fallback?.chainId === row.chainId &&
          fallback.projectId === row.projectId &&
          fallback.address &&
          isAddress(fallback.address) &&
          !values.some((value) => value.toLowerCase() === fallback.address!.toLowerCase())
        ) {
          values.push(fallback.address as Address);
        }
        return { row, values };
      }),
    [fallback, holders.data, rows],
  );

  const live = useQueries({
    queries: candidates.map(({ row, values }) => ({
      queryKey: ["v6-live-revnet-operator", row.chainId, row.projectId, values],
      enabled: !holders.isLoading,
      staleTime: 15_000,
      queryFn: async () => {
        const operator = await findCurrentRevnetOperator(values, (candidate) =>
          isLiveRevnetOperator(publicClientFor(row.chainId), row, candidate),
        );
        return [row.chainId, operator] as const;
      },
    })),
  });

  const discoveredOperatorByChain = useMemo(() => {
    const map = new Map<number, Address>();
    for (const query of live) {
      if (!query.data) continue;
      const [chainId, operator] = query.data;
      if (operator) map.set(chainId, operator);
    }
    return map;
  }, [live]);
  const isLoading = holders.isLoading || live.some((query) => query.isLoading);

  return {
    // Existing write consumers expect a complete map. Only display consumers opt
    // into partial discovery, so a slow chain cannot shrink an action's scope.
    operatorByChain: isLoading ? new Map<number, Address>() : discoveredOperatorByChain,
    discoveredOperatorByChain,
    isLoading,
    isError: holders.isError || live.some((query) => query.isError),
    refetch: async () => {
      await holders.refetch();
      await Promise.all(live.map((query) => query.refetch()));
    },
  };
}
