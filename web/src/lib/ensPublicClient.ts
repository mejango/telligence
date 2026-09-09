import { mainnet } from "@/lib/chains";
import { createPublicClient, type PublicClient } from "viem";
import { jbCenterRpcTransport } from "./jbcenter-rpc";

let client: PublicClient | undefined;

/** Read-only ENS access is separate from Base project and wallet transports. */
export function getEnsPublicClient(): PublicClient {
  return (client ??= createPublicClient({
    batch: { multicall: true },
    chain: mainnet,
    transport: jbCenterRpcTransport(mainnet.id),
  }) as PublicClient);
}
