import { mainnet } from "@/lib/chains";
import { getEnsPublicClient } from "@/lib/ensPublicClient";
import { useQuery } from "@tanstack/react-query";
import { Address, isAddress, PublicClient } from "viem";

/**
 * Resolve an address through ENS on the configured mainnet transport. Keeping
 * this onchain avoids leaking every displayed account to a third-party API.
 * @param address
 * @returns
 */
async function resolveAddress(address: Address, { publicClient }: { publicClient: PublicClient }) {
  const name = await publicClient.getEnsName({ address });
  return { name, address };
}

/**
 * Try to resolve an address to an ENS name.
 */
export function useEnsName(address: string | undefined, { enabled }: { enabled?: boolean } = {}) {
  const chainId = mainnet.id;
  const publicClient = getEnsPublicClient();

  return useQuery({
    queryKey: ["ensName", address, chainId],
    queryFn: async () => {
      if (!address || !isAddress(address)) return null;
      const data = await resolveAddress(address, { publicClient });
      return data.name;
    },
    enabled,
  });
}
