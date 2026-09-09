"use client";

import type { JBChainId } from "@bananapus/nana-sdk-core";
import { useQueries } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ProjectItem } from "../shared";
import { loadShopInventory, type ShopInventory } from "./shopLib";

export type ShopDestination = { chainId: JBChainId; projectId: bigint; shop: ShopInventory };

/** Discover peers independently; an unreadable peer never becomes an eligible destination. */
export function useShopDestinations(
  projects: ProjectItem[],
  chainId: JBChainId,
  projectId: bigint,
) {
  const config = useConfig();
  const clientFor = useCallback(
    (targetChainId: JBChainId) => {
      const client = getPublicClient(config, { chainId: targetChainId }) as
        PublicClient | undefined;
      if (!client) throw new Error(`No connection is available for chain ${targetChainId}.`);
      return client;
    },
    [config],
  );
  const refs = [
    ...new Map(
      [
        { chainId, projectId },
        ...projects.map((project) => ({
          chainId: project.chainId as JBChainId,
          projectId: BigInt(project.projectId),
        })),
      ].map((project) => [`${project.chainId}:${project.projectId}`, project]),
    ).values(),
  ];
  const queries = useQueries({
    queries: refs.map((project) => ({
      queryKey: ["v6Shop721", project.chainId, project.projectId.toString()],
      staleTime: 15_000,
      retry: 1,
      queryFn: () =>
        loadShopInventory(clientFor(project.chainId), project.chainId, project.projectId),
    })),
  });
  return {
    destinations: queries.flatMap((query, index) =>
      query.data ? [{ ...refs[index], shop: query.data }] : [],
    ),
    unavailable: queries.flatMap((query, index) => (query.isError ? [refs[index]] : [])),
    isLoading: queries.some((query) => query.isLoading),
    clientFor,
  };
}
