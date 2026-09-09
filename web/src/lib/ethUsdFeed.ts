import {
  jbContractAddress,
  JBCoreContracts,
  jbPricesAbi,
  USD_CURRENCY_ID,
} from "@bananapus/nana-sdk-core";
import { getViemPublicClient, type transports } from "./wagmiTransports";

/** Currency id 1 is the native token; `JBPrices` keys its feeds by these ids. */
const NATIVE_CURRENCY_ID = 1;
/** Project 0 holds the protocol's default feeds, used by every project without its own. */
const DEFAULT_FEED_PROJECT_ID = 0n;
/** Mainnet first — same registry on every chain, so the rest are just fallbacks. */
const FEED_CHAIN_IDS = [1, 8453, 10, 42161] as const;

/**
 * USD per ETH, read from the protocol's own price feed.
 *
 * This used to fetch `juicebox.money/api/juicebox/prices/ethusd`, a route belonging to the
 * V1–V5 app. That app is moving to old.juicebox.money and the V6 client takes the apex
 * domain, so the fetch would have resolved to a 404 — silently pricing every ETH treasury at
 * $0 rather than failing loudly.
 *
 * `JBPrices.pricePerUnitOf` is the rate the protocol itself converts with, so a treasury
 * priced here reads the same as the same treasury priced by a terminal.
 *
 * Throws when no chain answers, so a caller's cache never stores a fabricated number.
 */
export async function readEthUsdPrice(): Promise<number> {
  const errors: string[] = [];
  for (const chainId of FEED_CHAIN_IDS) {
    const prices = jbContractAddress["6"][JBCoreContracts.JBPrices]?.[chainId];
    if (!prices) continue;
    try {
      const client = getViemPublicClient(chainId as keyof typeof transports);
      const price = (await client.readContract({
        address: prices,
        abi: jbPricesAbi,
        functionName: "pricePerUnitOf",
        args: [
          DEFAULT_FEED_PROJECT_ID,
          BigInt(USD_CURRENCY_ID(6)),
          BigInt(NATIVE_CURRENCY_ID),
          18n,
        ],
      })) as bigint;
      const value = Number(price) / 1e18;
      if (Number.isFinite(value) && value > 0) return value;
      errors.push(`chain ${chainId} returned ${price}`);
    } catch (reason) {
      errors.push(
        `chain ${chainId}: ${reason instanceof Error ? reason.message.split("\n")[0] : "read failed"}`,
      );
    }
  }
  throw new Error(`ETH price unavailable (${errors.join("; ") || "no configured feed"})`);
}
