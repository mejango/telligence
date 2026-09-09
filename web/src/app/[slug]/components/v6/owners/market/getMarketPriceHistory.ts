"use server";

import { getV4AmmPriceHistory } from "@/app/[slug]/components/TokenPrice/getV4AmmPriceHistory";
import { JBChainId } from "@bananapus/nana-sdk-core";

/**
 * AMM spot prices for one buyback pool the Market subtab already resolved
 * onchain: the pool's registration price, then each swap's post-trade spot.
 */
export async function getMarketPriceHistory(params: {
  projectId: string;
  chainId: JBChainId;
  poolId: string;
  pairDecimals: number;
}): Promise<{ timestamp: number; price: number }[]> {
  const { data } = await getV4AmmPriceHistory({
    projectId: params.projectId,
    chainId: params.chainId,
    poolId: params.poolId,
    terminalDecimals: params.pairDecimals,
  });
  return data.flatMap((point) =>
    point.ammPrice ? [{ timestamp: point.timestamp, price: point.ammPrice }] : [],
  );
}
