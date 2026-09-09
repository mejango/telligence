import "server-only";

import { mainnet } from "@/lib/chains";
import { jbCenterRpcTransport } from "@/lib/jbcenter-rpc";
import { cache } from "react";
import { createPublicClient, getAddress, isAddress, type Address } from "viem";
import { normalize } from "viem/ens";

/**
 * Resolve the route param — a 0x address or an ENS name — to an address.
 * Request-cached so the layout and the active tab page share one resolution.
 */
export const resolveAccount = cache(
  async (id: string): Promise<{ address: Address; ensName?: string } | null> => {
    const raw = decodeURIComponent(id).trim();
    if (isAddress(raw)) return { address: getAddress(raw) };

    let name: string;
    try {
      name = normalize(raw);
    } catch {
      return null;
    }
    if (!name.includes(".")) return null;

    // Forward-resolve on the configured mainnet transport, mirroring
    // useEnsName's onchain-only policy.
    const client = createPublicClient({
      chain: mainnet,
      transport: jbCenterRpcTransport(mainnet.id),
    });
    const address = await client.getEnsAddress({ name }).catch(() => null);
    return address ? { address, ensName: name } : null;
  },
);
