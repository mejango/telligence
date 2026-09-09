import { base } from "@/lib/chains";
import { cache } from "react";
import { createPublicClient, PublicClient, type Chain } from "viem";
import { jbCenterRpcTransport } from "./jbcenter-rpc";

// Keep shared inspection components' numeric chain inputs type-compatible;
// runtime transports and transaction construction remain restricted to Base.
export const SUPPORTED_CHAINS: readonly [Chain] = [base];

export const transports = {
  [base.id]: jbCenterRpcTransport(base.id),
};

export const getViemPublicClient = cache((chainId: number) => {
  if (chainId !== base.id) throw new Error("Telligence uses Base only.");
  const transport = transports[chainId];
  if (!transport) throw new Error(`Transport not found for chainId: ${chainId}`);

  return createPublicClient({
    batch: { multicall: true },
    chain: SUPPORTED_CHAINS.find((chain) => chain.id === chainId),
    transport,
  }) as PublicClient;
});
