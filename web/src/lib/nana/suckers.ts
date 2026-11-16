"use client";

import { chainSortIndex } from "@/app/constants";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import {
  JBCoreContracts,
  JBProjectToken,
  jbTokensAbi,
  resolveSuckers,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getContract } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { useJBChainId, useJBContractContext, useJBProject } from "./project";
import type { SuckerPair } from "./types";

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
    const order = chainSortIndex(a.peerChainId) - chainSortIndex(b.peerChainId);
    if (order !== 0) return order;
    return a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0;
  });
}

/**
 * Whether `pairs` lists this exact `(chainId, projectId)`. Write paths check a
 * target against `useSuckers().verifiedPairs` with this before building calldata.
 */
export function hasSuckerPair(
  pairs: readonly SuckerPair[] | undefined,
  pair: { peerChainId: number; projectId: bigint },
): boolean {
  return (pairs ?? []).some(
    (p) => p.peerChainId === pair.peerChainId && p.projectId === pair.projectId,
  );
}

type SuckerCheck = { isVerified: boolean; isError: boolean };

/**
 * Whether the registry read is still in flight. It starts on mount, so it has
 * normally landed before anyone reaches a write; while it has not, the write's
 * own button shows its loading state rather than a message or another step.
 */
export function isPairCheckPending(suckers: SuckerCheck): boolean {
  return !suckers.isVerified && !suckers.isError;
}

/** The one inline line a write shows when its target pair is not chain-verified; null while pending. */
export function unverifiedPairLine(suckers: SuckerCheck, chainName: string): string | null {
  if (suckers.isVerified) return `The ${chainName} project listed here isn't linked onchain.`;
  if (suckers.isError) return `Couldn't confirm ${chainName} belongs to this project.`;
  return null;
}

/**
 * Resolve the V6 sucker group on-chain. Server-provided (Bendystraw) peers seed
 * the cache so the first render shows the group without a client waterfall, but
 * the seed is stale from the start: the on-chain registry read always runs on
 * mount, and once it lands the group stays cached until a manual `refetch`.
 *
 * `data` is for display. Anything that builds calldata for a peer reads
 * `verifiedPairs`: the page's own pair until the registry read lands, then the
 * on-chain group. An indexer-listed peer never reaches a write.
 *
 * `resolveSuckers` rejects rather than returning a truncated group when a
 * registry read fails — a partial group under-counts supply, surplus, and
 * balances. React Query keeps the Bendystraw-seeded pairs as `data` and raises
 * `isError`, so the page renders what the indexer knew instead of silently
 * treating an incomplete group as complete, while peer writes stay blocked.
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

  const query = useQuery({
    queryKey: ["revnet", "suckers", chainId, projectId.toString(), allowedChainIds ?? "all"],
    enabled: enabled && !!chainId && (!allowedChainIds || allowedChainIds.includes(chainId)),
    initialData,
    // The indexer seed is dated 0, so it is never mistaken for a chain read and is
    // fetched over at once; a chain read then stays fresh until a manual refetch.
    initialDataUpdatedAt: 0,
    staleTime: (q) => (q.state.dataUpdatedAt > 0 ? Infinity : 0),
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
  const chainRead = query.dataUpdatedAt > 0;
  const verifiedPairs = useMemo(
    () => (chainRead ? query.data : current ? [current] : []),
    [chainRead, query.data, current],
  );
  return { ...query, isVerified: chainRead, verifiedPairs };
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

  // Borrow, burn, cash out and credit claims act on these rows' project ids, so
  // only chain-verified pairs get a balance row; peers appear once the registry read lands.
  const pairs = suckers.verifiedPairs;
  const peerKey = pairs.map((pair) => `${pair.peerChainId}:${pair.projectId}`).join(",");
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
        ...(currentChain.data ? [{ balance: currentChain.data, chainId, projectId }] : []),
        ...remote,
      ];
    },
  });

  const isLoading = balances.isLoading || isPairCheckPending(suckers) || currentChain.isLoading;
  const isError = balances.isError || suckers.isError || currentChain.isError;
  return {
    ...balances,
    isComplete:
      suckers.isVerified &&
      balances.isSuccess &&
      currentChain.data !== undefined &&
      !isLoading &&
      !isError,
    // While verified peers are read, or if a peer read fails, the home balance read
    // on its own stays shown (and selectable).
    data:
      balances.data ??
      (chainId && currentChain.data
        ? [{ balance: currentChain.data, chainId, projectId }]
        : undefined),
    isLoading,
    isError,
    error: balances.error ?? suckers.error ?? currentChain.error,
  };
}
