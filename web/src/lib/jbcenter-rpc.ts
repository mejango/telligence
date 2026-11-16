import { jbCenterAppOrigin, jbCenterBaseUrl } from "@/lib/jbcenter-config";
import {
  createJBCenterRpcProvider,
  createPacedJBCenterLimiter,
} from "@bananapus/nana-sdk-core/jbcenter";
import { custom, http, type Transport } from "viem";

const serverFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Origin", jbCenterAppOrigin());
  return fetch(input, { ...init, headers });
};

// One scheduler per page, shared by every chain and every provider retry.
const browserLimiter = createPacedJBCenterLimiter();
const browserFetch: typeof fetch = (input, init) => window.fetch(input, init);

/** Center's RPC for `chainId`. Center load balances reads across nodes that import blocks at
 * slightly different times, so a read pinned to a block one node has imported can land on one
 * that has not, which answers JSON-RPC -32001 ("Requested resource not found." in viem). The
 * SDK's provider asks again after 250, 500, 1,000, 2,000 and 2,000 ms: reading `latest` instead
 * would read state older than the block the read pins. The read's signal goes with every try, and
 * a wait between tries ends the moment it aborts. */
export function jbCenterRpcTransport(chainId: number): Transport {
  if (
    process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER === "true" &&
    process.env.NEXT_PUBLIC_RPC_FIXTURE_URL
  ) {
    return http(process.env.NEXT_PUBLIC_RPC_FIXTURE_URL);
  }
  return custom(
    createJBCenterRpcProvider(chainId, {
      baseUrl: jbCenterBaseUrl(),
      fetch: typeof window === "undefined" ? serverFetch : browserFetch,
      limiter: typeof window === "undefined" ? undefined : browserLimiter,
    }),
    { retryCount: 1 },
  );
}
