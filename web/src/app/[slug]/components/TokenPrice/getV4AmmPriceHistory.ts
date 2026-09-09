import { usdRateOf } from "@/lib/baseCurrencyRate";
import {
  IndexedBuybackPoolsOperation,
  IndexedPoolLiquidityEventsOperation,
  IndexedPoolSwapsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type {
  IndexedBuybackPoolsQuery,
  IndexedPoolLiquidityEventsQuery,
  IndexedPoolSwapsQuery,
} from "@/lib/bendystraw/types";
import type { PoolReservePoint } from "@/lib/priceSeries";
import { downsampleTimeSeries, JBChainId, NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import {
  uniswapV4AmountsForLiquidity,
  uniswapV4PriceFromSqrtPriceX96,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { zeroAddress } from "viem";
import type { PriceDataPoint } from "./getTokenPriceChartData";

const PAGE_SIZE = 1000;
const MAX_DISPLAY_POINTS = 3000;

type RawPool = IndexedBuybackPoolsQuery["buybackPoolEvents"]["items"][number];

type PoolAmounts = { tokenAmount: bigint; pairAmount: bigint };

type RawLiquidityEvent =
  IndexedPoolLiquidityEventsQuery["buybackPoolLiquidityEvents"]["items"][number];
type Position = { lower: bigint; upper: bigint; liquidity: bigint };

/** Applies one liquidity change to the set of open positions, keyed by NFT id. */
function applyLiquidityEvent(positions: Map<string, Position>, event: RawLiquidityEvent) {
  const liquidity = BigInt(event.liquidityAfter);
  if (liquidity > 0n) {
    positions.set(event.tokenId, {
      lower: uniswapV4SqrtPriceX96AtTick(event.tickLower),
      upper: uniswapV4SqrtPriceX96AtTick(event.tickUpper),
      liquidity,
    });
  } else {
    positions.delete(event.tokenId);
  }
}

function poolAmountsAt(
  positions: Iterable<Position>,
  sqrtPriceX96: bigint,
  projectTokenIsCurrency0: boolean,
): PoolAmounts {
  let amount0 = 0n;
  let amount1 = 0n;
  for (const position of positions) {
    const amounts = uniswapV4AmountsForLiquidity(
      sqrtPriceX96,
      position.lower,
      position.upper,
      position.liquidity,
    );
    amount0 += amounts.amount0;
    amount1 += amounts.amount1;
  }
  return projectTokenIsCurrency0
    ? { tokenAmount: amount0, pairAmount: amount1 }
    : { tokenAmount: amount1, pairAmount: amount0 };
}

/**
 * Both sides of the pool over time, for the faint bars under the pool line and the tooltip's
 * holdings at the hovered moment: every liquidity change replayed in order, with the reserves
 * re-read at each change (at the price the index recorded there) and at each trade's exact
 * post-swap price. The bar values are only ever compared with each other, so they stay in the
 * pair token's units and off the chart's axis.
 */
function replayPoolReserves(
  events: RawLiquidityEvent[],
  prices: { timestamp: number; sqrtPriceX96: string }[],
  projectTokenIsCurrency0: boolean,
  terminalDecimals: number,
): PoolReservePoint[] {
  const positions = new Map<string, Position>();
  const reservesAt = (timestamp: number, sqrtPriceX96: bigint): PoolReservePoint[] => {
    const ammPrice = v4PriceFromSqrtPriceX96(
      sqrtPriceX96,
      projectTokenIsCurrency0,
      terminalDecimals,
    );
    if (!ammPrice) return [];
    const { tokenAmount, pairAmount } = poolAmountsAt(
      positions.values(),
      sqrtPriceX96,
      projectTokenIsCurrency0,
    );
    const pair = Number(pairAmount) / 10 ** terminalDecimals;
    const token = Number(tokenAmount) / 1e18;
    return [
      {
        timestamp,
        pairAmount: pair,
        tokenAmount: token,
        pairValue: pair,
        tokenValue: token * ammPrice,
      },
    ];
  };

  // One ordered timeline; a liquidity change in the same second as a trade applies first,
  // so the trade's point already reflects it. Trades before the first change carry nothing.
  const timeline = [
    ...events.map((event) => ({ at: Number(event.timestamp), order: 0, event })),
    ...prices.map((price) => ({ at: price.timestamp, order: 1, price })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);

  const out: PoolReservePoint[] = [];
  let seenLiquidity = false;
  for (const item of timeline) {
    if ("event" in item) {
      applyLiquidityEvent(positions, item.event);
      seenLiquidity = true;
      if (item.event.sqrtPriceX96)
        out.push(...reservesAt(item.at, BigInt(item.event.sqrtPriceX96)));
    } else if (seenLiquidity) {
      out.push(...reservesAt(item.at, BigInt(item.price.sqrtPriceX96)));
    }
  }
  return out;
}

type RawSwap = IndexedPoolSwapsQuery["swapEvents"]["items"][number];

function v4PriceFromSqrtPriceX96(
  sqrtPriceX96: string | bigint,
  projectTokenIsCurrency0: boolean,
  terminalDecimals: number,
  projectTokenDecimals = 18,
): number | null {
  const price = uniswapV4PriceFromSqrtPriceX96(
    BigInt(sqrtPriceX96),
    !projectTokenIsCurrency0,
    terminalDecimals,
  );
  if (price === null) return null;
  const adjusted = price * 10 ** (projectTokenDecimals - 18);
  return Number.isFinite(adjusted) && adjusted > 0 ? adjusted : null;
}

export async function getV4AmmPriceHistory({
  projectId,
  chainId,
  terminalToken,
  terminalDecimals,
  poolId,
}: {
  projectId: string;
  chainId: JBChainId;
  /** Ignored when `poolId` is given. */
  terminalToken?: string;
  terminalDecimals: number;
  /** Selects the pool directly when the caller already read it onchain. */
  poolId?: string;
}): Promise<{
  data: PriceDataPoint[];
  hasPool: boolean;
  reserves: PoolReservePoint[];
}> {
  const variables = {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version: 6,
  };
  const pools: RawPool[] = [];
  let poolTotalCount = 0;
  do {
    const poolResult = await queryBendystraw(chainId, IndexedBuybackPoolsOperation, {
      ...variables,
      limit: PAGE_SIZE,
      offset: pools.length,
    });
    const page = poolResult.buybackPoolEvents?.items ?? [];
    poolTotalCount = poolResult.buybackPoolEvents?.totalCount ?? page.length;
    pools.push(...page);
    if (!page.length) break;
  } while (pools.length < poolTotalCount);
  // The hook stores native ETH pools under address(0), while the project's
  // accounting token is the 0xEEEe sentinel — normalize before matching or
  // every ETH-accounting project reads as having no pool.
  const wantedTerminalToken =
    terminalToken?.toLowerCase() === NATIVE_TOKEN.toLowerCase()
      ? zeroAddress
      : terminalToken?.toLowerCase();
  const pool = poolId
    ? pools.find((item) => item.poolId.toLowerCase() === poolId.toLowerCase())
    : pools.find((item) => item.terminalToken.toLowerCase() === wantedTerminalToken);
  if (!pool) return { data: [], hasPool: false, reserves: [] };

  const swaps: RawSwap[] = [];
  let totalCount = 0;
  while (swaps.length < totalCount || swaps.length === 0) {
    const page = await queryBendystraw(chainId, IndexedPoolSwapsOperation, {
      ...variables,
      limit: PAGE_SIZE,
      offset: swaps.length,
    });
    const items = page.swapEvents?.items ?? [];
    totalCount = page.swapEvents?.totalCount ?? items.length;
    swaps.push(...items);
    if (items.length === 0 || swaps.length >= totalCount) break;
  }

  const liquidityEvents: RawLiquidityEvent[] = [];
  let liquidityTotal = 0;
  do {
    const page = await queryBendystraw(chainId, IndexedPoolLiquidityEventsOperation, {
      ...variables,
      limit: PAGE_SIZE,
      offset: liquidityEvents.length,
    });
    const items = page.buybackPoolLiquidityEvents?.items ?? [];
    liquidityTotal = page.buybackPoolLiquidityEvents?.totalCount ?? items.length;
    liquidityEvents.push(...items);
    if (!items.length) break;
  } while (liquidityEvents.length < liquidityTotal);

  const data: PriceDataPoint[] = [];
  // Every exact pool price the index saw, for the reserves replay below.
  const pricePoints: { timestamp: number; sqrtPriceX96: string }[] = [];
  if (pool.initialSqrtPriceX96 && pool.projectTokenIsCurrency0 !== null) {
    const ammPrice = v4PriceFromSqrtPriceX96(
      pool.initialSqrtPriceX96,
      pool.projectTokenIsCurrency0,
      terminalDecimals,
    );
    const timestamp = Number(pool.timestamp);
    if (ammPrice) {
      data.push({ timestamp, ammPrice });
      pricePoints.push({ timestamp, sqrtPriceX96: pool.initialSqrtPriceX96 });
    }
  }

  for (const swap of swaps) {
    if (
      swap.direction === "mint" ||
      !swap.poolId ||
      swap.poolId.toLowerCase() !== pool.poolId.toLowerCase()
    ) {
      continue;
    }

    let ammPrice =
      swap.sqrtPriceX96 && swap.projectTokenIsCurrency0 !== null
        ? v4PriceFromSqrtPriceX96(swap.sqrtPriceX96, swap.projectTokenIsCurrency0, terminalDecimals)
        : null;
    if (!ammPrice) {
      const terminalAmount = Number(BigInt(swap.terminalTokenAmount)) / 10 ** terminalDecimals;
      const projectAmount = Number(BigInt(swap.projectTokenAmount)) / 1e18;
      ammPrice = projectAmount > 0 ? terminalAmount / projectAmount : null;
    }
    if (ammPrice && Number.isFinite(ammPrice)) {
      const timestamp = Number(swap.timestamp);
      data.push({
        timestamp,
        ammPrice,
        accountingTokenUsdRate: usdRateOf(swap.accountingTokenUsdRate),
      });
      if (swap.sqrtPriceX96) {
        pricePoints.push({ timestamp, sqrtPriceX96: swap.sqrtPriceX96 });
      }
    }
  }

  data.sort((a, b) => a.timestamp - b.timestamp);
  pricePoints.sort((a, b) => a.timestamp - b.timestamp);

  const poolEvents = liquidityEvents.filter(
    (event) => event.poolId.toLowerCase() === pool.poolId.toLowerCase(),
  );
  const reserves =
    pool.projectTokenIsCurrency0 === null
      ? []
      : replayPoolReserves(poolEvents, pricePoints, pool.projectTokenIsCurrency0, terminalDecimals);

  return {
    data: downsampleTimeSeries(
      data,
      MAX_DISPLAY_POINTS,
      (point) => point.timestamp,
      (point) => point.ammPrice ?? 0,
    ),
    hasPool: true,
    reserves,
  };
}
