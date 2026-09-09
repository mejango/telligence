"use client";

import { ChartSkeleton } from "@/components/loading/LoadingSkeletons";
import { CartesianChart } from "@/components/ui/chart";
import {
  MarketPriceViewToggle,
  type MarketPriceView,
} from "@/components/ui/market-price-view-toggle";
import { SkeletonLines } from "@/components/ui/skeleton";
import { formatClock, formatMonthDay, formatMonthYear, formatShortDateTime } from "@/lib/date";
import { formatDecimals } from "@/lib/number";
import { smoothPriceSeries } from "@/lib/priceSeries";
import { cachedQuery } from "@/lib/query-persist";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { chainName, chainProjectsKey, type ChainProject } from "../settlement/lib";
import { getMarketPriceHistory } from "./getMarketPriceHistory";
import { fetchAmmStates, type PoolSnapshot } from "./lib";

/**
 * Owners → Market, top card: the pool price on its own terms. The Overview
 * chart anchors its scale to the issuance ladder, which flattens real market
 * movement; this one scales to the trades themselves.
 */

const DAY = 86_400;
const PRICE_REFRESH_MS = 15_000;

const RANGES = [
  { label: "1D", seconds: DAY },
  { label: "7D", seconds: 7 * DAY },
  { label: "30D", seconds: 30 * DAY },
  { label: "3M", seconds: 91 * DAY },
  { label: "1Y", seconds: 365 * DAY },
  { label: "All", seconds: 0 },
] as const;

const LINE = "var(--chart-4)";

function formatPrice(price: number): string {
  if (!isFinite(price) || price <= 0) return "—";
  if (price < 0.0001) return price.toExponential(2);
  return Intl.NumberFormat("en", { maximumFractionDigits: price >= 1 ? 4 : 8 }).format(price);
}

function formatTick(timestamp: number, span: number): string {
  const date = new Date(timestamp * 1000);
  if (span <= 7 * DAY) return formatClock(date);
  if (span <= 91 * DAY) return formatMonthDay(date);
  return formatMonthYear(date);
}

function PoolChart({
  pool,
  projectId,
  tokenSymbol,
  chainLabel,
}: {
  pool: PoolSnapshot;
  projectId: bigint;
  tokenSymbol: string;
  chainLabel: string | null;
}) {
  const [rangeSeconds, setRangeSeconds] = useState<number>(
    // Matches the price chart above it: a quarter reads as the project's
    // shape, where a month reads as noise.
    91 * DAY,
  );
  const [marketPriceView, setMarketPriceView] = useState<MarketPriceView>("smooth");

  const { data, isLoading } = useQuery(
    cachedQuery({
      queryKey: ["v6MarketPriceHistory", pool.chainId, pool.poolId],
      staleTime: 60_000,
      retry: 1,
      refetchInterval: PRICE_REFRESH_MS,
      refetchOnWindowFocus: true,
      queryFn: () =>
        getMarketPriceHistory({
          projectId: projectId.toString(),
          chainId: pool.chainId,
          poolId: pool.poolId,
          pairDecimals: pool.pair.decimals,
        }),
    }),
  );

  const live = pool.price ?? 0;
  const now = Math.floor(Date.now() / 1000);
  const observed = data ?? [];
  const first = observed[0]?.timestamp ?? now;
  const t0 = Math.min(now - 1, rangeSeconds === 0 ? first : Math.max(first, now - rangeSeconds));

  // The last observation before the window opens carries the line in at its
  // true level; the live pool price closes it at Now.
  const before = observed.filter((point) => point.timestamp < t0).at(-1);
  const exactPoints = [
    ...(before ? [{ timestamp: t0, price: before.price }] : []),
    ...observed.filter((point) => point.timestamp >= t0),
  ];
  if (live > 0) exactPoints.push({ timestamp: now, price: live });
  const points =
    marketPriceView === "trades"
      ? exactPoints
      : smoothPriceSeries(
          exactPoints.map((point) => ({ timestamp: point.timestamp, value: point.price })),
        ).map((point) => ({ timestamp: point.timestamp, price: point.value }));

  const opening = exactPoints[0]?.price ?? live;
  const change = opening > 0 ? (live - opening) / opening : 0;
  const low = points.reduce((min, point) => Math.min(min, point.price), live || Infinity);
  const high = points.reduce((max, point) => Math.max(max, point.price), live);
  const pad = high > low ? (high - low) * 0.12 : Math.max(high * 0.1, 1e-18);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {chainLabel ? (
            <p className="text-xs uppercase tracking-wide text-zinc-400">{chainLabel}</p>
          ) : null}
          <p className="text-2xl font-medium text-zinc-900">
            {formatPrice(live)}{" "}
            <span className="text-base text-zinc-500">
              {pool.pair.symbol}/{tokenSymbol}
            </span>
          </p>
          {points.length > 1 ? (
            <p
              className={cn(
                "text-sm font-medium",
                change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-zinc-500",
              )}
            >
              {change >= 0 ? "+" : "−"}
              {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 2 : 1)}%
              <span className="ml-1 font-normal text-zinc-400">
                over {rangeSeconds === 0 ? "all time" : "this range"}
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex shrink-0 gap-1 rounded-lg bg-teal-50 p-1">
            {RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                aria-pressed={rangeSeconds === range.seconds}
                onClick={() => setRangeSeconds(range.seconds)}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  rangeSeconds === range.seconds
                    ? "bg-teal-100 text-zinc-900"
                    : "text-zinc-600 hover:bg-teal-100/60 hover:text-zinc-900",
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {exactPoints.length > 1 ? (
        <div className="mt-2 flex justify-end">
          <MarketPriceViewToggle value={marketPriceView} onChange={setMarketPriceView} />
        </div>
      ) : null}

      {isLoading && points.length < 2 ? (
        <ChartSkeleton className="mt-4 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
      ) : points.length < 2 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No trades in this range yet — the price above is the live pool price.
        </p>
      ) : (
        <CartesianChart
          data={points}
          xValue={(point) => point.timestamp}
          series={[
            {
              key: "price",
              label: "Pool price",
              color: LINE,
              value: (point) => point.price,
              curve: marketPriceView === "trades" ? "linear" : "monotone",
              area: { opacityFrom: 0.22, opacityTo: 0 },
            },
          ]}
          ariaLabel={`${tokenSymbol} market price in ${pool.pair.symbol}`}
          description={`${marketPriceView === "smooth" ? "Time-weighted" : "Post-trade"} pool price for ${tokenSymbol} over the selected range.`}
          className="mt-2 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]"
          margin={{ left: 84, right: 20, top: 24, bottom: 36 }}
          xDomain={[t0, now]}
          yDomain={[Math.max(0, low - pad), high + pad]}
          formatXTick={(timestamp) => formatTick(timestamp, now - t0)}
          formatYTick={(value) => formatDecimals(value, 8)}
          tooltip={({ datum }) => (
            <div className="text-xs">
              <p className="font-medium text-zinc-900">
                {formatPrice(datum.price)} {pool.pair.symbol}/{tokenSymbol}
              </p>
              <p className="mt-0.5 text-zinc-500">
                {formatShortDateTime(new Date(datum.timestamp * 1000))}
              </p>
            </div>
          )}
        />
      )}
    </div>
  );
}

export function MarketPriceChart({
  chains,
  tokenSymbol,
}: {
  chains: ChainProject[];
  tokenSymbol: string;
}) {
  // Same key as AmmCard: the pools are read once for the whole subtab.
  const { data, isLoading } = useQuery(
    cachedQuery({
      queryKey: ["v6AmmStates", chainProjectsKey(chains)],
      enabled: chains.length > 0,
      staleTime: 60_000,
      queryFn: () => fetchAmmStates(chains),
    }),
  );

  // A ghost while the pools resolve, so the tab does not reflow when the
  // chart lands. Once resolved, a project with no pool renders nothing.
  if (isLoading) {
    return (
      <div className="border border-teal-200 bg-teal-50 p-4" aria-hidden="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="w-full max-w-xs">
            <SkeletonLines lines={2} />
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg bg-teal-50 p-1">
            {RANGES.map((range) => (
              <div key={range.label} className="h-11 w-11 animate-pulse rounded-md bg-teal-100" />
            ))}
          </div>
        </div>
        <ChartSkeleton className="mt-4 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
      </div>
    );
  }

  const pooled = (data ?? []).filter((state) => state.pool);
  if (pooled.length === 0) return null;

  return (
    <div className="flex flex-col gap-6 border border-teal-200 bg-teal-50 p-4">
      {pooled.map((state) => (
        <PoolChart
          key={state.chainId}
          pool={state.pool!}
          projectId={chains.find((chain) => chain.chainId === state.chainId)?.projectId ?? 0n}
          tokenSymbol={tokenSymbol}
          chainLabel={pooled.length > 1 ? chainName(state.chainId) : null}
        />
      ))}
    </div>
  );
}
