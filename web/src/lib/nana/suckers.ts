"use client";

import { useViewedAccount } from "@/hooks/useViewedAccount";
import {
  JBCoreContracts,
  JBProjectToken,
  jbTokensAbi,
  resolveSuckers,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getContract } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { useJBChainId, useJBContractContext, useJBProject } from "./project";
import type { SuckerPair } from "./types";

const CHAIN_ORDER: readonly JBChainId[] = [1, 8453, 10, 42161, 11155111, 84532, 11155420, 421614];

/**
 * Ensure the active project is represented exactly once and keep chain order
 * deterministic.
 *
 * Identity is the whole `(chainId, projectId)` pair, matching `resolveSuckers`:
 * a chain id alone is not an identity, and two members of a group can sit on
 * the same chain under different project ids. This only has to add `current`
 * for the Bendystraw-seeded initial data — `resolveSuckers` already includes
 * the local pair itself — but doing it unconditionally is idempotent.
 */
export function normalizeSuckerPairs(
  pairs: readonly SuckerPair[],
  current: SuckerPair,
): SuckerPair[] {
  const byPair = new Map<string, SuckerPair>();
  for (const pair of [current, ...pairs]) {
    const key = `${pair.peerChainId}:${pair.projectId}`;
    if (!byPair.has(key)) byPair.set(key, pair);
  }
  return [...byPair.values()].sort((a, b) => {
    const aIndex = CHAIN_ORDER.indexOf(a.peerChainId);
    const bIndex = CHAIN_ORDER.indexOf(b.peerChainId);
    if (aIndex !== bIndex) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    if (a.peerChainId !== b.peerChainId) return a.peerChainId - b.peerChainId;
    return a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0;
  });
}

/**
 * Resolve the V6 sucker group on-chain. Server-provided peers seed the cache,
 * removing the duplicate client indexer waterfall on initial render. Manual
 * `refetch` still resolves the live registry after cross-chain edits.
 *
 * `resolveSuckers` rejects rather than returning a truncated group when a
 * registry read fails — a partial group under-counts supply, surplus, and
 * balances. React Query keeps the Bendystraw-seeded pairs as `data` and raises
 * `isError`, so the page renders what the indexer knew instead of silently
 * treating an incomplete group as complete.
 */
export function useSuckers({ enabled = true }: { enabled?: boolean } = {}) {
  const config = useConfig();
  const chainId = useJBChainId();
  const { projectId } = useJBContractContext();
  const project = useJBProject();
  const allowedChainIds = project?.allowedChainIds;
  const current = useMemo(
    () => (chainId ? ({ peerChainId: chainId, projectId } satisfies SuckerPair) : undefined),
    [chainId, projectId],
  );
  const initialData = useMemo(
    () =>
      current
        ? normalizeSuckerPairs(project?.initialSuckers ?? [], current).filter(
            (pair) => !allowedChainIds || allowedChainIds.includes(pair.peerChainId),
          )
        : ([] satisfies SuckerPair[]),
    [allowedChainIds, current, project?.initialSuckers],
  );

  return useQuery({
    queryKey: ["revnet", "suckers", chainId, projectId.toString(), allowedChainIds ?? "all"],
    enabled: enabled && !!chainId && (!allowedChainIds || allowedChainIds.includes(chainId)),
    initialData,
    staleTime: Infinity,
    queryFn: async () => {
      if (!chainId || !current || (allowedChainIds && !allowedChainIds.includes(chainId)))
        return [];
      const pairs = await resolveSuckers({
        config,
        chainId,
        projectId,
        version: 6,
      });
      return normalizeSuckerPairs(pairs, current).filter(
        (pair) => !allowedChainIds || allowedChainIds.includes(pair.peerChainId),
      );
    },
  });
}

/**
 * Return the connected account's claimed + credit project-token balance on
 * every chain in the sucker group.
 */
export function useSuckersUserTokenBalance() {
  const config = useConfig();
  const chainId = useJBChainId();
  const { projectId, contractAddress } = useJBContractContext();
  const { address } = useViewedAccount();
  const suckers = useSuckers();

  const currentChain = useReadContract({
    abi: jbTokensAbi,
    functionName: "totalBalanceOf",
    address: chainId ? contractAddress(JBCoreContracts.JBTokens, chainId) : undefined,
    chainId,
    args: address ? [address, projectId] : undefined,
    query: {
      enabled: !!address && !!chainId,
      select: (value) => new JBProjectToken(value),
    },
  });

  const peerKey = (suckers.data ?? [])
    .map((pair) => `${pair.peerChainId}:${pair.projectId}`)
    .join(",");
  const balances = useQuery({
    queryKey: [
      "revnet",
      "suckersUserTokenBalance",
      address,
      chainId,
      projectId.toString(),
      currentChain.data?.value.toString(),
      peerKey,
    ],
    enabled: !!address && !!chainId && !suckers.isLoading,
    queryFn: async () => {
      if (!address || !chainId) return [];
      const pairs = suckers.data ?? [];
      // Identity is the whole pair: a group member sharing the active chain
      // under a different project id still needs its own balance read.
      const remotePairs = pairs.filter(
        (pair) => !(pair.peerChainId === chainId && pair.projectId === projectId),
      );
      const remote = await Promise.all(
        remotePairs.map(async (pair) => {
          const tokenStore = getContract({
            address: contractAddress(JBCoreContracts.JBTokens, pair.peerChainId),
            abi: jbTokensAbi,
            client: config.getClient({ chainId: pair.peerChainId }),
          });
          const balance = await tokenStore.read.totalBalanceOf([address, pair.projectId]);
          return {
            balance: new JBProjectToken(balance),
            chainId: pair.peerChainId,
            projectId: pair.projectId,
          };
        }),
      );
      return [
        {
          balance: currentChain.data ?? new JBProjectToken(0n),
          chainId,
          projectId,
        },
        ...remote,
      ];
    },
  });

  return {
    ...balances,
    isLoading: balances.isLoading || suckers.isLoading || currentChain.isLoading,
    isError: balances.isError || suckers.isError || currentChain.isError,
    error: balances.error ?? suckers.error ?? currentChain.error,
  };
}
