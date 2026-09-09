"use client";

import {
  getJBContractAddress,
  JBChainId,
  JBSuckerContracts,
  jbSuckerRegistryAbi,
} from "@bananapus/nana-sdk-core";
import { useReadContract } from "wagmi";

export function useSuckerPairs(projectId: number, chainId: JBChainId) {
  const { data, ...rest } = useReadContract({
    abi: jbSuckerRegistryAbi,
    address: getJBContractAddress(JBSuckerContracts.JBSuckerRegistry, 6, chainId),
    functionName: "suckerPairsOf",
    args: [BigInt(projectId)],
    chainId,
  });

  return { suckerPairs: data || [], ...rest };
}
