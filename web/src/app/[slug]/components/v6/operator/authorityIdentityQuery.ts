import { readAuthorityIdentity } from "@bananapus/nana-sdk-core/safe";
import { queryOptions } from "@tanstack/react-query";
import type { Address } from "viem";
import { publicClientFor, type ChainProjectRow } from "./operatorLib";

/** Shared display proof only. Signing and submission must always read a fresh identity. */
export function authorityIdentityQuery(chainId: ChainProjectRow["chainId"], authority: Address) {
  return queryOptions({
    queryKey: ["operator-authority-identity", chainId, authority.toLowerCase()],
    staleTime: 30_000,
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      // Keep the SDK's gas-capped, return-bounded canonical identity checks.
      const identity = await readAuthorityIdentity(publicClientFor(chainId), authority);
      if (!identity) throw new Error("The account type could not be verified. Try again.");
      return identity;
    },
  });
}
