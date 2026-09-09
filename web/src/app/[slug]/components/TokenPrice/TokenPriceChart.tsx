"use client";

import { ChartSkeleton } from "@/components/loading/LoadingSkeletons";
import {
  CartesianChart,
  type ChartBar,
  type ChartReferenceLine,
  type ChartSeries,
} from "@/components/ui/chart";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  MarketPriceViewToggle,
  type MarketPriceView,
} from "@/components/ui/market-price-view-toggle";
import { RangeOption, RangeSelector } from "@/components/ui/range-selector";
import { formatClock, formatMonthDay, formatMonthYear } from "@/lib/date";
import { shouldShowCashOutAsymptote } from "@/lib/minimumCashOutPrice";
import { useJBTokenContext } from "@/lib/nana/project";
import { formatDecimals } from "@/lib/number";
import { bucketPoolReserves } from "@/lib/priceSeries";
import { cachedQuery } from "@/lib/query-persist";
import { parseTimeRange, TimeRange } from "@/lib/timeRange";
import { formatTokenSymbol } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChartToggleButton } from "./ChartToggleButton";
import { getTokenPriceChartData } from "./getTokenPriceChartData";
import { POOL_PAIR_FILL, POOL_TOKEN_FILL, PriceChartTooltip } from "./PriceChartTooltip";
import { priceConcept } from "./priceConcepts";

const TIME_RANGES: RangeOption<TimeRange>[] = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "3m", label: "3 months" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "All" },
];

const NOW_COLOR = "#EE6F3A"; // peel-400
const PRICE_REFRESH_MS = 15_000;
const POOL_RESERVE_BARS = 48;

interface Props {
  projectId: string;
  chainId: JBChainId;
  suckerGroupId: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

export function TokenPriceChart({
  projectId,
  chainId,
  suckerGroupId,
  token,
  tokenSymbol,
  tokenDecimals,
}: Props) {
  const searchParams = useSearchParams();
  const range = parseTimeRange(searchParams.get("range"));

  const { data, isLoading } = useQuery(
    cachedQuery({
      queryKey: ["chartData", projectId, chainId, suckerGroupId, range],
      queryFn: () =>
        getTokenPriceChartData({
          projectId,
          chainId,
          range,
          suckerGroupId,
          baseToken: { address: token, symbol: tokenSymbol, decimals: tokenDecimals },
        }),
      placeholderData: keepPreviousData,
      refetchInterval: PRICE_REFRESH_MS,
      refetchOnWindowFocus: true,
    }),
  );

  const [showIssuance, setShowIssuance] = useState(true);
  const [showAmm, setShowAmm] = useState(true);
  const [showFloor, setShowFloor] = useState(true);
  const [marketPriceView, setMarketPriceView] = useState<MarketPriceView>("smooth");

  const chartData =
    marketPriceView === "trades" ? (data?.tradeChartData ?? []) : (data?.chartData ?? []);
  const hasData = chartData.length > 0;

  const hasPool = data?.hasPool ?? false;

  const { token: projectToken } = useJBTokenContext();
  const projectTokenSymbol = formatTokenSymbol(projectToken);
  const hasAmmData = chartData.some((d) => d.ammPrice !== undefined);
  const hasFloorData = chartData.some((d) => d.floorPrice !== undefined);
  const currentPricePoint = [...chartData]
    .reverse()
    .find((point) => point.floorPrice !== undefined && point.minimumCashOutPrice !== undefined);
  const showCashOutAsymptote = shouldShowCashOutAsymptote(
    currentPricePoint?.floorPrice,
    currentPricePoint?.minimumCashOutPrice,
  );
  const firstTimestamp = chartData[0]?.timestamp;
  const lastTimestamp = chartData[chartData.length - 1]?.timestamp;
  const visibleStages =
    firstTimestamp === undefined || lastTimestamp === undefined
      ? []
      : (data?.stages ?? []).filter(
          (stage) => stage.timestamp > firstTimestamp && stage.timestamp < lastTimestamp,
        );
  const todayTimestamp = data?.todayTimestamp;
  const showToday =
    todayTimestamp !== undefined &&
    firstTimestamp !== undefined &&
    lastTimestamp !== undefined &&
    todayTimestamp >= firstTimestamp &&
    todayTimestamp <= lastTimestamp;

  const filteredData = chartData.map((point) => ({
    timestamp: point.timestamp,
    issuancePrice: showIssuance ? point.issuancePrice : undefined,
    ammPrice: showAmm ? point.ammPrice : undefined,
    floorPrice: showFloor ? point.floorPrice : undefined,
    minimumCashOutPrice: showFloor && showCashOutAsymptote ? point.minimumCashOutPrice : undefined,
    cashOutChangeReason: showFloor ? point.cashOutChangeReason : undefined,
    totalSupply: showFloor ? point.totalSupply : undefined,
    totalBalance: showFloor ? point.totalBalance : undefined,
    cashOutTaxRate: showFloor ? point.cashOutTaxRate : undefined,
  }));
  const visibleSeries: ChartSeries<(typeof filteredData)[number]>[] = [];
  if (showIssuance) {
    visibleSeries.push({
      key: "issuancePrice",
      label: "Issuance",
      color: "var(--chart-2)",
      value: (point) => point.issuancePrice,
    });
  }
  if (showAmm && hasAmmData) {
    visibleSeries.push({
      key: "ammPrice",
      label: "Pool",
      color: "var(--chart-4)",
      value: (point) => point.ammPrice,
      curve: marketPriceView === "trades" ? "linear" : "monotone",
      // The price people actually trade at, so it carries the chart; the other two are bounds.
      width: 5,
    });
  }
  if (showFloor && hasFloorData) {
    visibleSeries.push({
      key: "floorPrice",
      label: "Cash out",
      color: "var(--chart-3)",
      value: (point) => point.floorPrice,
    });
    if (showCashOutAsymptote) {
      visibleSeries.push({
        key: "minimumCashOutPrice",
        label: "Cash out asymptote",
        color: "var(--chart-3)",
        value: (point) => point.minimumCashOutPrice,
        curve: "linear",
        dash: "5 4",
        width: 1.3,
        opacity: 0.55,
      });
    }
  }
  const referenceLines: ChartReferenceLine[] = visibleStages.map((stage) => ({
    key: `${stage.name}-${stage.timestamp}`,
    x: stage.timestamp,
    color: "#C6EDD5",
    dash: "3 3",
    width: 2,
    label: stage.name,
    labelColor: "#3D7955",
    labelSide: "right",
  }));
  if (showToday && todayTimestamp !== undefined) {
    referenceLines.push({
      key: "now",
      x: todayTimestamp,
      color: NOW_COLOR,
      dash: "4 4",
      width: 2,
      label: "Now",
      labelColor: NOW_COLOR,
    });
  }
  const reserveBars: ChartBar[] =
    showAmm && firstTimestamp !== undefined && lastTimestamp !== undefined
      ? bucketPoolReserves(
          data?.poolReserves ?? [],
          firstTimestamp,
          lastTimestamp,
          POOL_RESERVE_BARS,
        ).map((bucket) => ({
          key: `reserves-${bucket.timestamp}`,
          x: bucket.timestamp,
          segments: [
            { value: bucket.pairValue, fill: POOL_PAIR_FILL },
            { value: bucket.tokenValue, fill: POOL_TOKEN_FILL },
          ],
        }))
      : [];
  const maxVisiblePrice = filteredData.reduce(
    (max, point) =>
      Math.max(
        max,
        ...visibleSeries.map((series) => {
          const value = series.value(point);
          return value !== undefined && Number.isFinite(value) ? value : 0;
        }),
      ),
    0,
  );

  // The axis unit: 1 → native, 2 → USD, otherwise a token-keyed base currency, which IS the
  // accounting token. Same rule the other clients use.
  const axisSymbol =
    data?.baseCurrency === 2
      ? "USD"
      : data?.baseCurrency === 1
        ? "ETH"
        : (tokenSymbol ?? "the base currency");

  // An always-on methodological caveat, not a problem — so it sits behind an (!) rather than
  // as a banner. The two notices below it stay inline on purpose: those say data is MISSING or
  // a source is DOWN, which the reader has to see without hovering anything.
  const conversionNote = data?.conversionBasis
    ? `Market and cash-out prices are converted from ${tokenSymbol ?? "the accounting token"} into this revnet's issuance currency` +
      (data.conversionBasis === "indexed"
        ? " using indexed payment values, so they are approximate."
        : " at the current exchange rate, so earlier points are approximate.") +
      " The issuance ceiling is natively denominated in it and is exact."
    : null;

  return (
    <div className="w-full">
      <div className="flex w-full flex-wrap items-center justify-between gap-4">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 lg:gap-4">
          <ChartToggleButton
            label="Issuance Price"
            active={showIssuance}
            colorVar="--chart-2"
            note={priceConcept("issuance", { baseSymbol: axisSymbol })}
            onClick={() => setShowIssuance(!showIssuance)}
          />
          <ChartToggleButton
            label="Cash out Price"
            active={showFloor}
            disabled={!hasFloorData}
            colorVar="--chart-3"
            note={priceConcept("cashOut", { baseSymbol: axisSymbol })}
            onClick={() => setShowFloor(!showFloor)}
          />
          {hasPool && (
            <ChartToggleButton
              label="Pool price & liquidity"
              active={showAmm}
              disabled={!hasAmmData}
              colorVar="--chart-4"
              note={
                priceConcept("pool", { baseSymbol: axisSymbol }) +
                (reserveBars.length
                  ? ` The faint bars show what the pool held: ${tokenSymbol} in the darker shade, ${projectTokenSymbol} in the lighter one, both valued in ${tokenSymbol}.`
                  : "")
              }
              onClick={() => setShowAmm(!showAmm)}
            />
          )}
          {conversionNote ? <InfoTip note={conversionNote} /> : null}
        </span>
        <span className="flex flex-wrap items-center gap-4">
          <RangeSelector ranges={TIME_RANGES} defaultValue="3m" />
          {hasPool && hasAmmData ? (
            <MarketPriceViewToggle value={marketPriceView} onChange={setMarketPriceView} />
          ) : null}
        </span>
      </div>
      {(data?.unavailableSources.length ?? 0) > 0 ? (
        <p className="mt-3 text-xs text-amber-700">
          {data!.unavailableSources.join(" and ")} price history is temporarily unavailable.
        </p>
      ) : null}
      {data?.marketSeriesUnavailable ? (
        <p className="mt-3 text-xs text-amber-700">
          Market and cash-out prices can&apos;t be converted into this revnet&apos;s issuance
          currency right now, so only issuance is shown.
        </p>
      ) : null}

      {hasData ? (
        <CartesianChart
          data={filteredData}
          xValue={(point) => point.timestamp}
          series={visibleSeries}
          ariaLabel={`${tokenSymbol} price history`}
          description={`Issuance, ${marketPriceView === "smooth" ? "time-weighted pool" : "every post-trade pool"}, and cash out prices for ${tokenSymbol} over the selected ${range} range.${showCashOutAsymptote ? " The dotted line is the cash-out asymptote." : ""}`}
          className="mt-2 aspect-[4/3] sm:aspect-[2/1] lg:aspect-[5/2] w-full"
          showYTickLabels={false}
          margin={{ left: 1, right: 20, top: 24, bottom: 36 }}
          xDomain={[firstTimestamp ?? 0, lastTimestamp ?? 1]}
          yDomain={[0, maxVisiblePrice > 0 ? maxVisiblePrice * 1.1 : 1]}
          formatXTick={(timestamp) => formatXAxis(timestamp, range)}
          formatYTick={(value) => formatDecimals(value, 6)}
          referenceLines={referenceLines}
          bars={reserveBars}
          tooltip={({ datum, series }) => (
            <PriceChartTooltip
              datum={datum}
              series={series}
              baseTokenSymbol={tokenSymbol}
              baseTokenDecimals={tokenDecimals}
              range={range}
              poolReserves={showAmm ? (data?.poolReserves ?? []) : []}
              projectTokenSymbol={projectTokenSymbol}
            />
          )}
        />
      ) : isLoading ? (
        <ChartSkeleton className="mt-6 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
      ) : (
        <div className="aspect-[4/3] sm:aspect-[2/1] lg:aspect-[5/2] w-full flex items-center justify-center text-zinc-500">
          No price data available
        </div>
      )}
    </div>
  );
}

const formatXAxis = (timestamp: number, range: TimeRange) => {
  const date = new Date(timestamp * 1000);
  if (range === "1h" || range === "6h" || range === "1d" || range === "7d") {
    return formatClock(date);
  }
  if (range === "30d" || range === "3m") {
    return formatMonthDay(date);
  }
  return formatMonthYear(date);
};
