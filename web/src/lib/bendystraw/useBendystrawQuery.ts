"use client";

import { bendystrawCacheTtl } from "@bananapus/nana-sdk-core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryBendystrawFromBrowser } from "./client";
import type { BendystrawOperation } from "./operations";

export type BendystrawQueryOptions = {
  enabled?: boolean;
  pollInterval?: number | false;
  chainId?: number;
};

export function useBendystrawQuery<TResult, TVariables extends Record<string, unknown>>(
  operation: BendystrawOperation<TResult, TVariables>,
  variables: TVariables,
  options: BendystrawQueryOptions = {},
): UseQueryResult<TResult, Error> {
  return useQuery({
    queryKey: ["bendystraw", operation.id, options.chainId ?? null, variables],
    queryFn: () => queryBendystrawFromBrowser(operation, variables, options.chainId),
    enabled: options.enabled ?? true,
    refetchInterval: options.pollInterval || false,
    retry: 2,
    staleTime: options.pollInterval
      ? Math.min(options.pollInterval, bendystrawCacheTtl("live"))
      : bendystrawCacheTtl("standard"),
  });
}
