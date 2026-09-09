"use server";

import { getRulesets } from "@/app/[slug]/terms/getRulesets";
import {
  accountingIsAxisUnit,
  baseIsUsd,
  fetchLiveBasePerAccountingToken,
  fetchPayEventRates,
  rateAt,
  toBaseAxis,
  type BaseRatePoint,
} from "@/lib/baseCurrencyRate";
import { getCurrentCashOutTax } from "@/lib/cashOutTax";
import { minimumCashOutPriceAtIssuancePrice } from "@/lib/minimumCashOutPrice";
import { smoothPriceSeries } from "@/lib/priceSeries";
import { getStartTimeForRange, getTimeRangeConfig, TimeRange } from "@/lib/timeRange";
import { getTokenAddress } from "@/lib/token";
import { JBChainId, NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { calculateIssuancePriceHistory } from "./calculateIssuancePriceHistory";
import { getFloorPriceHistory } from "./getFloorPriceHistory";
import { getV4AmmPriceHistory } from "./getV4AmmPriceHistory";

export type PriceDataPoint = {
  timestamp: number;
  issuancePrice?: number;
  ammPrice?: number;
  floorPrice?: number;
  minimumCashOutPrice?: number;
  cashOutChangeReason?: string;
  /** USD per accounting token at THIS point's block, when the indexer recorded it. Consumed
   *  by the axis conversion below and never rendered. */
  accountingTokenUsdRate?: number | null;
  // Floor price calculation inputs (for debugging)
  totalSupply?: string;
  totalBalance?: string;
  cashOutTaxRate?: number;
};

export async function getTokenPriceChartData(params: {
  projectId: string;
  chainId: JBChainId;
  range: TimeRange;
  suckerGroupId: string;
  baseToken: { address: string; symbol: string; decimals: number };
}) {
  const { projectId, chainId, baseToken, suckerGroupId, range } = params;
  const startTime = getStartTimeForRange(range);

  const rulesets = await getRulesets(projectId, chainId);
  const projectStart = rulesets.length > 0 ? rulesets[0].start : 0;
  // Every stage shares the project's denomination; stage 0 decides the axis.
  const baseCurrency = rulesets[0]?.baseCurrency;
  // Issuance is 1/weight — ALREADY in base-currency units, and exact. It is the AMM and
  // cash-out series (accounting-token denominated) that move onto the axis.
  const issuanceData = calculateIssuancePriceHistory(rulesets, range);

  const projectTokenAddress = await getTokenAddress(chainId, Number(projectId));
  if (!projectTokenAddress || projectTokenAddress === NATIVE_TOKEN) {
    throw new Error("Could not get project token address");
  }

  // V6 buyback pools are Uniswap V4 pools identified by bytes32 pool IDs.
  const currentCashOutTax = await getCurrentCashOutTax(projectId, chainId);
  const [v4Result, floorResult] = await Promise.allSettled([
    getV4AmmPriceHistory({
      projectId,
      chainId,
      terminalToken: baseToken.address,
      terminalDecimals: baseToken.decimals,
    }),
    getFloorPriceHistory({
      suckerGroupId,
      chainId,
      baseTokenDecimals: baseToken.decimals,
      currentCashOutTax,
      projectStart,
    }),
  ]);
  const v4History = v4Result.status === "fulfilled" ? v4Result.value : null;
  const rawAmmData = v4History?.hasPool ? v4History.data : [];
  const rawFloorData = floorResult.status === "fulfilled" ? floorResult.value : [];

  // Move the accounting-denominated series onto the base-currency axis. A no-op (and no
  // network call) whenever the accounting token already IS the axis unit, which is the
  // common case.
  //
  // Otherwise, two sources. Pay-event ratios give the rate in force at each point's OWN
  // timestamp, which matters when the pair floats — converting a year of ETH-denominated
  // history at today's rate would restate it. But they only exist where the indexer values
  // the accounting token, and it does not value USDC (it reports `amountUsd: 0`), which left
  // every USDC revnet with no market or cash-out line at all. `JBPrices` — the protocol's own
  // feed, consulted on every payment — always has a rate for a pair the terminal can price,
  // so it backs every point the pay events don't reach.
  const onAxis = accountingIsAxisUnit(baseCurrency, baseToken.address);
  const [rates, liveRate] = onAxis
    ? [[] as BaseRatePoint[], 1]
    : await Promise.all([
        baseIsUsd(baseCurrency)
          ? fetchPayEventRates(chainId, Number(projectId), baseToken.decimals)
          : Promise.resolve([] as BaseRatePoint[]),
        fetchLiveBasePerAccountingToken(
          chainId,
          Number(projectId),
          baseCurrency,
          baseToken.address,
        ),
      ]);
  const convertible = onAxis || rates.length > 0 || liveRate !== null;
  // Best rate available for a point, in descending order of fidelity:
  //  1. the rate the INDEXER recorded at that point's own block — exact, and only meaningful
  //     when the axis is USD, since that is what it measures.
  //  2. the pay-event ratio in force at that timestamp — the indexer's valuation, approximate.
  //  3. the live feed — today's number applied to the past.
  const indexedRates = baseIsUsd(baseCurrency);
  const rateFor = (point: PriceDataPoint) =>
    onAxis
      ? 1
      : ((indexedRates ? point.accountingTokenUsdRate : null) ??
        rateAt(rates, point.timestamp) ??
        liveRate);

  const ammData = onAxis
    ? rawAmmData
    : rawAmmData
        .map((point) => ({
          ...point,
          ammPrice: toBaseAxis(point.ammPrice, rateFor(point)),
        }))
        .filter((point) => point.ammPrice !== undefined);
  const floorData = onAxis
    ? rawFloorData
    : rawFloorData
        .map((point) => ({
          ...point,
          floorPrice: toBaseAxis(point.floorPrice, rateFor(point)),
          minimumCashOutPrice: toBaseAxis(point.minimumCashOutPrice, rateFor(point)),
        }))
        .filter((point) => point.floorPrice !== undefined);
  // Which basis actually carried the series, for the note the UI shows.
  const usedIndexedPointRates =
    indexedRates &&
    [...rawAmmData, ...rawFloorData].some((point) => point.accountingTokenUsdRate != null);

  const { interval } = getTimeRangeConfig(range);
  const now = Math.floor(Date.now() / 1000);
  const firstAmmTimestamp = ammData[0]?.timestamp ?? now;
  const chartStart =
    range === "all"
      ? Math.min(...[projectStart, firstAmmTimestamp].filter((timestamp) => timestamp > 0))
      : startTime;
  const exactAmmData = visibleAmmSeries(ammData, chartStart, now);
  const smoothedAmmData = smoothPriceSeries(
    exactAmmData.flatMap((point) =>
      point.ammPrice === undefined ? [] : [{ timestamp: point.timestamp, value: point.ammPrice }],
    ),
  ).map((point) => ({ timestamp: point.timestamp, ammPrice: point.value }));
  // Pool observations keep their own timestamps. The other protocol-defined
  // series retain the range's normal interval; collapsing pool points into
  // that interval would make "Every trade" silently omit trades.
  const data = mergeDataPoints(issuanceData, smoothedAmmData, floorData, interval, null);
  const tradeData = mergeDataPoints(issuanceData, exactAmmData, floorData, interval, null);
  const inSelectedRange = (point: PriceDataPoint) =>
    range === "all" || point.timestamp >= startTime;

  return {
    chartData: data.filter(inSelectedRange),
    tradeChartData: tradeData.filter(inSelectedRange),
    hasPool: !!v4History?.hasPool,
    /** Both sides of the pool over time, for the bars under the pool line and the tooltip. */
    poolReserves: v4History?.reserves ?? [],
    /** The axis unit: the ruleset's base currency, which issuance is denominated in. */
    baseCurrency,
    /**
     * How the market/cash-out lines reached the axis, so the UI can be specific about which
     * approximation the reader is looking at: `indexed` follows the rate at each point's own
     * timestamp, `live` applies today's feed rate to the whole range. Null when the
     * accounting token is already the axis unit and nothing was converted.
     */
    conversionBasis: onAxis
      ? null
      : usedIndexedPointRates || rates.length > 0
        ? ("indexed" as const)
        : liveRate !== null
          ? ("live" as const)
          : null,
    /** No rate was derivable, so the accounting-denominated lines are omitted entirely. */
    marketSeriesUnavailable: !onAxis && !convertible,
    unavailableSources: [
      ...(v4Result.status === "rejected" ? ["pool"] : []),
      ...(floorResult.status === "rejected" ? ["cash out"] : []),
    ],
    stages: rulesets.map((ruleset, index) => ({
      name: `Stage ${index + 1}`,
      timestamp: normalizeToInterval(ruleset.start, interval),
    })),
    todayTimestamp: normalizeToInterval(Math.floor(Date.now() / 1000), interval),
  };
}

function mergeDataPoints(
  issuanceData: PriceDataPoint[],
  ammData: PriceDataPoint[],
  floorData: PriceDataPoint[],
  interval: number,
  ammInterval: number | null = interval,
): PriceDataPoint[] {
  const merged = new Map<number, PriceDataPoint>();

  for (const point of issuanceData) {
    const dayTs = normalizeToInterval(point.timestamp, interval);
    const existing = merged.get(dayTs);
    if (existing) {
      existing.issuancePrice = point.issuancePrice;
    } else {
      merged.set(dayTs, { timestamp: dayTs, issuancePrice: point.issuancePrice });
    }
  }

  for (const point of ammData) {
    const dayTs =
      ammInterval === null ? point.timestamp : normalizeToInterval(point.timestamp, ammInterval);
    const existing = merged.get(dayTs);
    if (existing) {
      existing.ammPrice = point.ammPrice;
    } else {
      merged.set(dayTs, { timestamp: dayTs, ammPrice: point.ammPrice });
    }
  }

  for (const point of floorData) {
    const dayTs = normalizeToInterval(point.timestamp, interval);
    const existing = merged.get(dayTs);
    if (existing) {
      existing.floorPrice = point.floorPrice;
      existing.minimumCashOutPrice = point.minimumCashOutPrice;
      existing.cashOutChangeReason = point.cashOutChangeReason;
      existing.totalSupply = point.totalSupply;
      existing.totalBalance = point.totalBalance;
      existing.cashOutTaxRate = point.cashOutTaxRate;
    } else {
      merged.set(dayTs, {
        timestamp: dayTs,
        floorPrice: point.floorPrice,
        minimumCashOutPrice: point.minimumCashOutPrice,
        cashOutChangeReason: point.cashOutChangeReason,
        totalSupply: point.totalSupply,
        totalBalance: point.totalBalance,
        cashOutTaxRate: point.cashOutTaxRate,
      });
    }
  }

  const sorted = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);

  let lastAmmPrice: number | undefined;
  let lastIssuancePrice: number | undefined;
  let lastFloorPrice: number | undefined;
  let lastTotalSupply: string | undefined;
  let lastTotalBalance: string | undefined;
  let lastCashOutTaxRate: number | undefined;

  for (const point of sorted) {
    if (point.issuancePrice !== undefined) {
      lastIssuancePrice = point.issuancePrice;
    } else if (lastIssuancePrice !== undefined) {
      point.issuancePrice = lastIssuancePrice;
    }

    if (point.ammPrice !== undefined) {
      lastAmmPrice = point.ammPrice;
    } else if (lastAmmPrice !== undefined) {
      point.ammPrice = lastAmmPrice;
    }

    if (point.floorPrice !== undefined) {
      lastFloorPrice = point.floorPrice;
      lastTotalSupply = point.totalSupply;
      lastTotalBalance = point.totalBalance;
      lastCashOutTaxRate = point.cashOutTaxRate;
    } else if (lastFloorPrice !== undefined) {
      point.floorPrice = lastFloorPrice;
      point.totalSupply = lastTotalSupply;
      point.totalBalance = lastTotalBalance;
      point.cashOutTaxRate = lastCashOutTaxRate;
    }

    if (point.issuancePrice !== undefined && point.cashOutTaxRate !== undefined) {
      point.minimumCashOutPrice = minimumCashOutPriceAtIssuancePrice(
        point.issuancePrice,
        point.cashOutTaxRate,
      );
    }
  }

  return sorted;
}

function visibleAmmSeries(points: PriceDataPoint[], start: number, end: number): PriceDataPoint[] {
  const sorted = points
    .filter(
      (point) =>
        point.ammPrice !== undefined &&
        Number.isFinite(point.ammPrice) &&
        point.ammPrice > 0 &&
        point.timestamp <= end,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const before = sorted.filter((point) => point.timestamp < start).at(-1);
  const visible = sorted.filter((point) => point.timestamp >= start);
  const output = before ? [{ ...before, timestamp: start }, ...visible] : visible.slice();
  const latest = output.at(-1);
  if (latest && latest.timestamp < end) {
    output.push({ timestamp: end, ammPrice: latest.ammPrice });
  }
  return output;
}

function normalizeToInterval(timestamp: number, interval: number): number {
  return Math.floor(timestamp / interval) * interval;
}
