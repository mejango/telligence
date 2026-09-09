import { mainnet } from "@/lib/chains";
import { useQuery } from "@tanstack/react-query";
import { Address, PublicClient } from "viem";
import { normalize } from "viem/ens";
import { usePublicClient } from "wagmi";

/**
 * Resolve an ENS name through the configured mainnet transport. Keeping this
 * onchain avoids leaking every looked-up name to a third-party API.
 */
async function resolveName(name: string, { publicClient }: { publicClient: PublicClient }) {
  const address = await publicClient.getEnsAddress({ name: normalize(name) });
  return { name, address };
}

/**
 * Try to resolve an ENS name to an address. Returns null for values that are
 * not resolvable names.
 */
export function useEnsAddress(name: string | undefined, { enabled }: { enabled?: boolean } = {}) {
  const chainId = mainnet.id;
  const publicClient = usePublicClient({ chainId });

  return useQuery<Address | null>({
    queryKey: ["ensAddress", name, chainId],
    queryFn: async () => {
      if (!name || !name.includes(".")) return null;
      if (!publicClient) {
        throw new Error("Public client not available");
      }

      try {
        const data = await resolveName(name, { publicClient });
        return data.address;
      } catch {
        // Invalid/unnormalizable names resolve to "no address" rather than an error.
        return null;
      }
    },
    enabled,
  });
}
