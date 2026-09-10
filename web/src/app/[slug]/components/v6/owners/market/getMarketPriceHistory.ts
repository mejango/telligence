"use server";

import { getV4AmmPriceHistory } from "@/app/[slug]/components/TokenPrice/getV4AmmPriceHistory";
import { isSupportedChainId } from "@/app/constants";
import { JBChainId } from "@bananapus/nana-sdk-core";

// A public Server Action: bound every argument before it reaches the indexer.
const PROJECT_ID = /^[1-9]\d{0,17}$/;
const POOL_ID = /^0x[0-9a-fA-F]{64}$/;

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
  if (
    !params ||
    typeof params !== "object" ||
    typeof params.projectId !== "string" ||
    !PROJECT_ID.test(params.projectId) ||
    typeof params.chainId !== "number" ||
    !isSupportedChainId(params.chainId) ||
    typeof params.poolId !== "string" ||
    !POOL_ID.test(params.poolId) ||
    !Number.isInteger(params.pairDecimals) ||
    params.pairDecimals < 0 ||
    params.pairDecimals > 36
  )
    return [];
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
