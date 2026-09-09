"use client";

import { cn } from "@/lib/utils";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  axisTickCountForWidth,
  buildStepPoints,
  chartDateLabel,
  formatPrice,
  rateAtTime,
  type ResolvedStage,
} from "./chartUtils";

/**
 * SVG scaffold for the stepped issuance-price schedule chart (website/ parity:
 * issuanceChartSvg + mountChart): light horizontal gridlines, stage-boundary
 * dividers, the "Now" marker, the price ladder polyline, hover crosshair, and
 * scale/date labels. Pure SVG — no chart library. Styled to match
 * TokenPriceChart's quiet chrome: no card box, thin non-scaling strokes,
 * dashed gridlines, muted HTML labels.
 */

const ISSUANCE_COLOR = "#4FA270"; // melon-600
const NOW_COLOR = "#EE6F3A"; // peel-400

// Plot area gutters inside a 320×140 viewBox. Text lives in HTML overlays so
// the gutters only pad the plot itself.
const VW = 320;
const DEFAULT_VH = 140;
const PL = 0;
const PR = 0;
const PT = 4;
const PB = 4;

export type ChartGeom = {
  /** Time → x in viewBox units. */
  X: (t: number) => number;
  /** Price → y in viewBox units, clamped to the plot area. */
  Y: (v: number) => number;
  /** X at min(now, t1). */
  nowX: number;
  /** The vertical scale's top value (max issuance price in the window). */
  maxV: number;
};

/**
 * A quiet range picker in the same voice as MarketPriceViewToggle: a naked
 * select with a chevron, taking one text line instead of a row of pills.
 */
export function ChartRangeSelect({
  ranges,
  value,
  onChange,
}: {
  ranges: readonly { label: string; value: number }[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="relative inline-flex shrink-0 items-center text-teal-700">
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Time range"
        className="cursor-pointer appearance-none border-0 bg-none bg-transparent p-0 pr-4 text-xs font-medium text-current [field-sizing:content] hover:underline focus:border-0 focus:ring-0 focus-visible:!outline-none focus-visible:underline"
      >
        {ranges.map((range) => (
          <option key={range.label} value={range.value}>
            {range.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="pointer-events-none absolute right-0 h-3 w-3"
      >
        <path
          d="m2.5 4.25 3.5 3.5 3.5-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function StepChartBase({
  resolved,
  t0,
  t1,
  now,
  symbol,
  baseSymbol,
  ariaLabel,
  showNowMarker = true,
  header,
  renderSeries,
  renderOverlay,
  viewHeight = DEFAULT_VH,
}: {
  resolved: ResolvedStage[];
  t0: number;
  t1: number;
  now: number;
  symbol: string;
  baseSymbol: string;
  ariaLabel: string;
  /** Whether to draw the Now marker (e.g. only inside a projected window). */
  showNowMarker?: boolean;
  /** Rendered above the plot (summary tiles, range pills). */
  header?: ReactNode;
  /** Extra series drawn after the stage boundaries, behind the Now marker. */
  renderSeries?: (geom: ChartGeom) => ReactNode;
  /** Extra marks drawn after the hover crosshair. */
  renderOverlay?: (geom: ChartGeom) => ReactNode;
  /** viewBox height; the chart keeps full width, so smaller = shorter. */
  viewHeight?: number;
}) {
  const VH = viewHeight;
  const [hoverT, setHoverT] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);

  // Price points: invert the rate steps; rate 0 → null (no mint price).
  const points = useMemo(
    () =>
      buildStepPoints(resolved, t0, t1).map(
        ([t, rate]) => [t, rate > 0 ? 1 / rate : null] as [number, number | null],
      ),
    [resolved, t0, t1],
  );
  const maxV = points.reduce((m, [, v]) => (v !== null && v > m ? v : m), 0);

  useLayoutEffect(() => {
    const element = plotRef.current;
    if (!element) return;

    const updateWidth = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setPlotWidth(width);
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [maxV, resolved.length]);

  if (resolved.length === 0 || maxV <= 0) {
    return <p className="mt-3 text-xs text-zinc-500">No issuance to chart.</p>;
  }

  const X = (t: number) => PL + ((VW - PL - PR) * (t - t0)) / (t1 - t0);
  const Y = (v: number) => PT + (VH - PT - PB) * (1 - Math.max(0, Math.min(1, v / maxV)));
  /** viewBox x → CSS percentage, for constant-size HTML overlays. */
  const pct = (x: number) => `${((x / VW) * 100).toFixed(2)}%`;

  // The ladder breaks where there is no issuance (rate 0) instead of drawing
  // a line at a price that does not exist.
  const path = points
    .map(([t, v], i) =>
      v === null
        ? ""
        : `${i === 0 || points[i - 1][1] === null ? "M" : "L"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`,
    )
    .join(" ");

  const t = Math.min(t1, Math.max(t0, hoverT ?? Math.min(now, t1)));
  const rate = rateAtTime(resolved, t);
  const price = rate > 0 ? 1 / rate : null;
  const span = t1 - t0;
  const nowX = X(Math.min(now, t1));
  const geom: ChartGeom = { X, Y, nowX, maxV };
  const axisTickCount = axisTickCountForWidth(plotWidth);
  const axisTimes = Array.from(
    { length: axisTickCount },
    (_, i) => t0 + ((t1 - t0) * i) / (axisTickCount - 1),
  );

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const viewX = ((e.clientX - rect.left) / rect.width) * VW;
    const frac = Math.min(1, Math.max(0, (viewX - PL) / (VW - PL - PR)));
    setHoverT(t0 + frac * (t1 - t0));
  };

  return (
    <div className="mt-3 w-full">
      {header}
      <div className="relative mt-2">
        <div ref={plotRef} className="relative">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            className="h-auto w-full cursor-crosshair touch-none"
            role="img"
            aria-label={ariaLabel}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHoverT(null)}
          >
            {/* Horizontal gridlines only, like TokenPriceChart's CartesianGrid. */}
            {[0, 1, 2, 3, 4].map((i) => {
              const y = PT + ((VH - PT - PB) * i) / 4;
              return (
                <line
                  key={i}
                  x1={PL}
                  y1={y}
                  x2={VW - PR}
                  y2={y}
                  stroke="#CCCCCC"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {/* The y-axis border anchors the plot's left edge. */}
            <line
              x1={PL}
              y1={PT}
              x2={PL}
              y2={VH - PB}
              stroke="#CCCCCC"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {/* Stage boundaries */}
            {resolved.map((s, i) =>
              i > 0 && s.start > t0 && s.start < t1 ? (
                <line
                  key={s.start}
                  x1={X(s.start)}
                  y1={PT}
                  x2={X(s.start)}
                  y2={VH - PB}
                  stroke="#A5E0BD"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
            {renderSeries?.(geom)}
            {/* Now marker */}
            {showNowMarker ? (
              <line
                x1={nowX}
                y1={PT}
                x2={nowX}
                y2={VH - PB}
                stroke={NOW_COLOR}
                strokeWidth="2"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {/* The price ladder */}
            <path
              d={path}
              fill="none"
              stroke={ISSUANCE_COLOR}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Crosshair guides + inspected point while hovering */}
            {hoverT !== null && price !== null ? (
              <>
                <line
                  x1={X(t)}
                  y1={VH - PB}
                  x2={X(t)}
                  y2={Y(price)}
                  stroke={ISSUANCE_COLOR}
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={PL}
                  y1={Y(price)}
                  x2={X(t)}
                  y2={Y(price)}
                  stroke={ISSUANCE_COLOR}
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={X(t)} cy={Y(price)} r="2.5" fill={ISSUANCE_COLOR} />
              </>
            ) : null}
            {renderOverlay?.(geom)}
          </svg>
          {/* Constant-size labels overlay the plot as HTML so they don't scale
              with the svg. */}
          {(() => {
            // Lay the stage/Now labels out with collision handling: a stage
            // label sits to the RIGHT of its boundary — inside the stage it
            // names — flipping left only near the plot's right edge, and a
            // label that would overlap an earlier one drops to a second row.
            const markers = [
              ...resolved
                .map((stage, i) => ({ x: X(stage.start), label: `Stage ${i + 1}`, now: false, i }))
                .filter(
                  ({ i, x }) => i > 0 && resolved[i].start > t0 && resolved[i].start < t1 && x >= 0,
                ),
              ...(showNowMarker ? [{ x: nowX, label: "Now", now: true, i: -1 }] : []),
            ].sort((a, b) => a.x - b.x);
            const CHAR_PX = 9.6; // text-base mono, close enough for layout
            const rowEnds: number[] = [];
            return markers.map((marker) => {
              const side = marker.x / VW > 0.85 ? "left" : "right";
              const anchorPx = plotWidth > 0 ? (marker.x / VW) * plotWidth : marker.x;
              const widthPx = marker.label.length * CHAR_PX + 8;
              const startPx = side === "right" ? anchorPx + 8 : anchorPx - 8 - widthPx;
              let row = 0;
              while (row < rowEnds.length && startPx < rowEnds[row] + 6) row += 1;
              rowEnds[row] = startPx + widthPx;
              return (
                <span
                  key={marker.now ? "now" : marker.label}
                  className={cn(
                    "pointer-events-none absolute leading-none text-base",
                    side === "left" && "-translate-x-full",
                    marker.now ? "font-semibold text-[#EE6F3A]" : "font-medium text-[#3D7955]",
                  )}
                  style={{
                    top: `${row * 20}px`,
                    left: `calc(${pct(marker.x)} ${side === "right" ? "+" : "-"} 8px)`,
                  }}
                >
                  {marker.label}
                </span>
              );
            });
          })()}
        </div>
      </div>
      <div className="relative mt-1 h-5 text-sm text-[#666666]">
        {axisTimes.map((timestamp, i) => (
          <span
            key={timestamp}
            className={cn(
              "absolute top-0 whitespace-nowrap",
              i === 0 ? "" : i === axisTimes.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
            )}
            data-slot="issuance-x-tick"
            style={{ left: `${(i / (axisTimes.length - 1)) * 100}%` }}
          >
            {new Date(timestamp * 1000).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-sm text-zinc-500" aria-live="polite">
        <span className="text-zinc-600">{chartDateLabel(t, span)}</span>
        {" — "}
        {price !== null ? (
          <>
            <span className="font-medium text-zinc-600 tabular-nums">
              {formatPrice(price)} {baseSymbol}
            </span>{" "}
            per {symbol}
          </>
        ) : (
          "no issuance"
        )}
      </p>
    </div>
  );
}
