import type { ChartTooltipSeries } from "@/components/ui/chart";
import { formatClock, formatShortDate } from "@/lib/date";
import { formatCompact, formatDecimals } from "@/lib/number";
import { poolReservesAt, type PoolReservePoint } from "@/lib/priceSeries";
import { TimeRange } from "@/lib/timeRange";
import { JB_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { formatUnits } from "viem";

type PriceTooltipDatum = {
  timestamp: number;
  totalSupply?: string;
  totalBalance?: string;
  cashOutTaxRate?: number;
  cashOutChangeReason?: string;
};

// The pool's reserves, as two tints of the pool line: the pair side darker, the token side lighter.
// The bars are translucent over the page; the tooltip sits on near-black, so its squares carry
// the colour the bars actually show — the same tint composited onto the page background.
const POOL_PAIR_TINT = 30;
const POOL_TOKEN_TINT = 14;
export const POOL_PAIR_FILL = `color-mix(in srgb, var(--chart-4) ${POOL_PAIR_TINT}%, transparent)`;
export const POOL_TOKEN_FILL = `color-mix(in srgb, var(--chart-4) ${POOL_TOKEN_TINT}%, transparent)`;
const PAGE_BACKGROUND = "var(--color-melon-25, #F6FEF9)";
const POOL_PAIR_SWATCH = `color-mix(in srgb, var(--chart-4) ${POOL_PAIR_TINT}%, ${PAGE_BACKGROUND})`;
const POOL_TOKEN_SWATCH = `color-mix(in srgb, var(--chart-4) ${POOL_TOKEN_TINT}%, ${PAGE_BACKGROUND})`;

interface Props {
  datum: PriceTooltipDatum;
  series: readonly ChartTooltipSeries<PriceTooltipDatum>[];
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  range: TimeRange;
  /** The pool's reserves over time; the tooltip shows what it held at the hovered moment. */
  poolReserves?: readonly PoolReservePoint[];
  projectTokenSymbol?: string;
}

export function PriceChartTooltip({
  datum,
  series,
  baseTokenSymbol,
  baseTokenDecimals,
  range,
  poolReserves = [],
  projectTokenSymbol,
}: Props) {
  const reserves = poolReservesAt(poolReserves, datum.timestamp);
  const hasFloorPrice = series.some((entry) => entry.key === "floorPrice");
  const showFloorDebug = hasFloorPrice && datum.totalSupply && datum.totalBalance;

  const formattedDate =
    range === "1d"
      ? `${formatShortDate(datum.timestamp * 1000)} ${formatClock(datum.timestamp * 1000)}`
      : formatShortDate(datum.timestamp * 1000);

  return (
    <div className="w-max bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 text-sm">
      <div className="font-medium mb-2 text-zinc-300">{formattedDate}</div>
      {series.map((entry) => (
        <div key={entry.key} className="flex items-center gap-2 whitespace-nowrap">
          <span
            className="w-2 h-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="shrink-0 text-zinc-400">{entry.label}:</span>
          <span className="shrink-0 font-mono text-white">
            {formatDecimals(entry.value, 6)} {baseTokenSymbol}
          </span>
        </div>
      ))}
      {reserves && (reserves.tokenAmount > 0 || reserves.pairAmount > 0) ? (
        <div className="mt-2 flex justify-between gap-4 whitespace-nowrap border-t border-zinc-700 pt-2 text-xs text-zinc-500">
          <span>Pool liquidity:</span>
          <span className="flex items-center gap-1.5 font-mono">
            <span className="h-2 w-2 shrink-0" style={{ backgroundColor: POOL_TOKEN_SWATCH }} />
            {formatCompact(reserves.tokenAmount)} {projectTokenSymbol ?? "tokens"} +{" "}
            <span className="h-2 w-2 shrink-0" style={{ backgroundColor: POOL_PAIR_SWATCH }} />
            {formatCompact(reserves.pairAmount)} {baseTokenSymbol}
          </span>
        </div>
      ) : null}
      {showFloorDebug && (
        <div className="mt-2 pt-2 border-t border-zinc-700 text-xs text-zinc-500 space-y-1">
          <div className="flex justify-between gap-4 whitespace-nowrap">
            <span>Total Supply:</span>
            <span className="font-mono">
              {formatCompact(formatUnits(BigInt(datum.totalSupply!), JB_TOKEN_DECIMALS))}
            </span>
          </div>
          <div className="flex justify-between gap-4 whitespace-nowrap">
            <span>Total Balance:</span>
            <span className="font-mono">
              {formatCompact(formatUnits(BigInt(datum.totalBalance!), baseTokenDecimals))}{" "}
              {baseTokenSymbol}
            </span>
          </div>
          <div className="flex justify-between gap-4 whitespace-nowrap">
            <span>Cash Out Tax:</span>
            <span className="font-mono">{((datum.cashOutTaxRate ?? 0) / 100).toFixed(2)}%</span>
          </div>
        </div>
      )}
      {hasFloorPrice && datum.cashOutChangeReason ? (
        <p className="mt-2 max-w-72 border-t border-zinc-700 pt-2 text-xs leading-relaxed text-zinc-300">
          {datum.cashOutChangeReason}
        </p>
      ) : null}
    </div>
  );
}
