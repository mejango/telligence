"use client";

import { cn } from "@/lib/utils";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/**
 * A small, app-owned SVG chart primitive.
 *
 * It deliberately owns only the behavior shared by Revnet's charts:
 * responsive geometry, axes, reference bands/lines, pointer inspection and
 * keyboard inspection. Domain-specific formatting and tooltip content stay
 * with each chart.
 */

export type ChartDatum = Record<string, unknown>;

export type ChartSeries<T extends ChartDatum> = {
  key: string;
  label: string;
  color: string;
  value: (datum: T) => number | undefined;
  curve?: "linear" | "monotone";
  dash?: string;
  width?: number;
  opacity?: number;
  area?: {
    color?: string;
    opacityFrom?: number;
    opacityTo?: number;
  };
};

type ChartBand = {
  key: string;
  x1: number;
  x2: number;
  fill: string;
};

/**
 * One stacked bar on its own hidden scale, sized against the tallest bar; context under the
 * series rather than a plotted value. Segments stack from the plot's bottom edge, in order.
 */
export type ChartBar = {
  key: string;
  x: number;
  segments: readonly { value: number; fill: string }[];
};

export type ChartReferenceLine = {
  key: string;
  x: number;
  color: string;
  dash?: string;
  width?: number;
  label?: string;
  labelColor?: string;
  labelSide?: "left" | "right";
};

export type ChartTooltipSeries<T extends ChartDatum> = {
  key: string;
  label: string;
  color: string;
  value: number;
  datum: T;
};

type ChartTooltipContext<T extends ChartDatum> = {
  datum: T;
  index: number;
  series: ChartTooltipSeries<T>[];
};

type Dimensions = {
  width: number;
  height: number;
};

type Margin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const FALLBACK_SIZE: Dimensions = { width: 800, height: 320 };
const DEFAULT_MARGIN: Margin = { top: 24, right: 20, bottom: 36, left: 76 };

export type CartesianChartProps<T extends ChartDatum> = {
  data: readonly T[];
  xValue: (datum: T) => number;
  series: readonly ChartSeries<T>[];
  ariaLabel: string;
  description: string;
  className?: string;
  margin?: Partial<Margin>;
  xDomain?: readonly [number, number];
  yDomain?: readonly [number, number];
  xTicks?: readonly number[];
  yTicks?: readonly number[];
  xTickCount?: number;
  yTickCount?: number;
  showYTickLabels?: boolean;
  formatXTick?: (value: number) => string;
  formatYTick?: (value: number) => string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  grid?: "horizontal" | "both" | "none";
  bands?: readonly ChartBand[];
  bars?: readonly ChartBar[];
  /** The tallest bar's share of the plot height. */
  barsHeight?: number;
  referenceLines?: readonly ChartReferenceLine[];
  tooltip: (context: ChartTooltipContext<T>) => ReactNode;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
  initialIndex?: number;
};

export function CartesianChart<T extends ChartDatum>({
  data,
  xValue,
  series,
  ariaLabel,
  description,
  className,
  margin: marginOverrides,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xTickCount = 6,
  yTickCount = 5,
  showYTickLabels = true,
  formatXTick = defaultTickFormatter,
  formatYTick = defaultTickFormatter,
  xAxisLabel,
  yAxisLabel,
  grid = "horizontal",
  bands = [],
  bars = [],
  barsHeight = 0.28,
  referenceLines = [],
  tooltip,
  activeIndex: controlledActiveIndex,
  onActiveIndexChange,
  initialIndex,
}: CartesianChartProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState(FALLBACK_SIZE);
  const [uncontrolledActiveIndex, setUncontrolledActiveIndex] = useState<number | null>(null);
  const [usingKeyboard, setUsingKeyboard] = useState(false);
  const activeIndex =
    controlledActiveIndex !== undefined ? controlledActiveIndex : uncontrolledActiveIndex;
  const descriptionId = `${useId().replace(/:/g, "")}-description`;
  const gradientPrefix = `${useId().replace(/:/g, "")}-gradient`;
  const clipId = `${useId().replace(/:/g, "")}-clip`;

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const margin = {
    ...DEFAULT_MARGIN,
    ...marginOverrides,
  };
  const { width, height } = dimensions;
  const plotLeft = Math.min(margin.left, width * 0.32);
  const plotRight = Math.max(plotLeft + 1, width - margin.right);
  const plotTop = margin.top;
  const plotBottom = Math.max(plotTop + 1, height - margin.bottom);

  const finiteData = useMemo(
    () => data.filter((datum) => Number.isFinite(xValue(datum))),
    [data, xValue],
  );
  const derivedXDomain = useMemo(
    () => xDomain ?? finiteExtent(finiteData.map(xValue), [0, 1]),
    [finiteData, xDomain, xValue],
  );
  const derivedYDomain = useMemo(() => {
    if (yDomain) return ensureDomain(yDomain);
    const values = finiteData.flatMap((datum) =>
      series
        .map((item) => item.value(datum))
        .filter((value): value is number => value !== undefined && Number.isFinite(value)),
    );
    return paddedDomain(finiteExtent(values, [0, 1]));
  }, [finiteData, series, yDomain]);

  const safeXDomain = ensureDomain(derivedXDomain);
  const safeYDomain = ensureDomain(derivedYDomain);
  const scaleX = (value: number) =>
    linearScale(value, safeXDomain[0], safeXDomain[1], plotLeft, plotRight);
  const scaleY = (value: number) =>
    linearScale(value, safeYDomain[0], safeYDomain[1], plotBottom, plotTop);
  const responsiveXTickCount = Math.min(
    xTickCount,
    Math.max(2, Math.floor((plotRight - plotLeft) / 80) + 1),
  );
  const resolvedXTicks = xTicks ?? chartTicks(safeXDomain[0], safeXDomain[1], responsiveXTickCount);
  const resolvedYTicks = yTicks ?? chartTicks(safeYDomain[0], safeYDomain[1], yTickCount);
  const setActiveIndex = (index: number | null) => {
    const bounded =
      index === null || data.length === 0 ? null : Math.max(0, Math.min(data.length - 1, index));
    if (controlledActiveIndex === undefined) setUncontrolledActiveIndex(bounded);
    onActiveIndexChange?.(bounded);
  };

  const inspectAtClientX = (clientX: number, rect: DOMRect) => {
    if (!data.length || rect.width <= 0) return;
    const viewX = ((clientX - rect.left) / rect.width) * width;
    const chartX = linearScale(viewX, plotLeft, plotRight, safeXDomain[0], safeXDomain[1]);
    setUsingKeyboard(false);
    setActiveIndex(findNearestIndex(data, xValue, chartX));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    inspectAtClientX(event.clientX, event.currentTarget.getBoundingClientRect());
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!data.length) return;
    const fallback = initialIndex ?? data.length - 1;
    let next = activeIndex ?? Math.max(0, Math.min(data.length - 1, fallback));
    if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowRight") next += 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = data.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setUsingKeyboard(false);
      setActiveIndex(null);
      return;
    } else {
      return;
    }
    event.preventDefault();
    setUsingKeyboard(true);
    setActiveIndex(next);
  };

  const activeDatum =
    activeIndex !== null && activeIndex >= 0 && activeIndex < data.length
      ? data[activeIndex]
      : undefined;
  const activeSeries = activeDatum
    ? series.flatMap((item) => {
        const value = item.value(activeDatum);
        return value !== undefined && Number.isFinite(value)
          ? [
              {
                key: item.key,
                label: item.label,
                color: item.color,
                value,
                datum: activeDatum,
              },
            ]
          : [];
      })
    : [];
  const activeX = activeDatum ? scaleX(xValue(activeDatum)) : null;
  const activeY =
    activeSeries.length > 0
      ? scaleY(
          activeSeries.reduce(
            (closest, item) =>
              Math.abs(scaleY(item.value) - plotTop) < Math.abs(scaleY(closest) - plotTop)
                ? item.value
                : closest,
            activeSeries[0].value,
          ),
        )
      : plotTop;
  const tooltipStyle: CSSProperties | undefined =
    activeX === null
      ? undefined
      : {
          left: `${(activeX / width) * 100}%`,
          top: `${(activeY / height) * 100}%`,
          transform:
            activeX > width * 0.72
              ? "translate(calc(-100% - 12px), -50%)"
              : "translate(12px, -50%)",
        };

  return (
    <div
      ref={containerRef}
      data-slot="chart"
      className={cn(
        "relative flex touch-pan-y justify-center text-xs outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100",
        className,
      )}
      role="group"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-describedby={descriptionId}
      onFocus={() => {
        if (activeIndex === null && data.length) {
          setUsingKeyboard(true);
          setActiveIndex(initialIndex ?? data.length - 1);
        }
      }}
      onBlur={() => {
        setUsingKeyboard(false);
        setActiveIndex(null);
      }}
      onKeyDown={handleKeyboard}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        if (!usingKeyboard) setActiveIndex(null);
      }}
      onPointerCancel={() => {
        if (!usingKeyboard) setActiveIndex(null);
      }}
    >
      <p id={descriptionId} className="sr-only">
        {description} Use Left and Right Arrow keys to inspect points, Home and End to jump, and
        Escape to close the inspection.
      </p>
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={plotLeft}
              y={plotTop}
              width={plotRight - plotLeft}
              height={plotBottom - plotTop}
            />
          </clipPath>
          {series.map((item, index) =>
            item.area ? (
              <linearGradient
                key={item.key}
                id={`${gradientPrefix}-${index}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={item.area.color ?? item.color}
                  stopOpacity={item.area.opacityFrom ?? 0.3}
                />
                <stop
                  offset="100%"
                  stopColor={item.area.color ?? item.color}
                  stopOpacity={item.area.opacityTo ?? 0.02}
                />
              </linearGradient>
            ) : null,
          )}
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {bands.map((band) => (
            <rect
              key={band.key}
              x={scaleX(band.x1)}
              y={plotTop}
              width={Math.max(0, scaleX(band.x2) - scaleX(band.x1))}
              height={plotBottom - plotTop}
              fill={band.fill}
            />
          ))}

          {grid !== "none"
            ? resolvedYTicks.map((tick) => (
                <line
                  key={`y-grid-${tick}`}
                  x1={plotLeft}
                  y1={scaleY(tick)}
                  x2={plotRight}
                  y2={scaleY(tick)}
                  stroke="currentColor"
                  className="text-zinc-200"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              ))
            : null}
          {/* The y-axis border anchors the plot's left edge. */}
          <line
            x1={plotLeft}
            y1={plotTop}
            x2={plotLeft}
            y2={plotBottom}
            stroke="currentColor"
            className="text-zinc-300"
            strokeWidth="1"
          />
          {grid === "both"
            ? resolvedXTicks.map((tick) => (
                <line
                  key={`x-grid-${tick}`}
                  x1={scaleX(tick)}
                  y1={plotTop}
                  x2={scaleX(tick)}
                  y2={plotBottom}
                  stroke="currentColor"
                  className="text-zinc-200"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              ))
            : null}

          {bars.length > 0
            ? (() => {
                const tallest = Math.max(
                  ...bars.map((bar) => bar.segments.reduce((sum, s) => sum + s.value, 0)),
                );
                if (!(tallest > 0)) return null;
                const unit = ((plotBottom - plotTop) * barsHeight) / tallest;
                // Size from the tightest gap between bars, not their count: a series that
                // starts partway through the domain has fewer bars than slots, and translucent
                // bars wider than a slot overlap into a third shade.
                const xs = bars.map((bar) => scaleX(bar.x)).sort((a, b) => a - b);
                const slot = xs.reduce(
                  (min, x, index) => (index === 0 ? min : Math.min(min, x - xs[index - 1])),
                  plotRight - plotLeft,
                );
                const barWidth = Math.max(1, slot * 0.7);
                return bars.map((bar) => {
                  let top = plotBottom;
                  return (
                    <g key={bar.key}>
                      {bar.segments.map((segment, index) => {
                        const height = Math.max(0, segment.value) * unit;
                        top -= height;
                        return (
                          <rect
                            key={index}
                            x={scaleX(bar.x) - barWidth / 2}
                            y={top}
                            width={barWidth}
                            height={height}
                            fill={segment.fill}
                          />
                        );
                      })}
                    </g>
                  );
                });
              })()
            : null}

          {referenceLines.map((line) => {
            const x = scaleX(line.x);
            return (
              <line
                key={line.key}
                x1={x}
                y1={plotTop}
                x2={x}
                y2={plotBottom}
                stroke={line.color}
                strokeWidth={line.width ?? 2}
                strokeDasharray={line.dash ?? "3 3"}
              />
            );
          })}

          {series.map((item, index) => {
            const points = data.flatMap((datum) => {
              const value = item.value(datum);
              return value !== undefined && Number.isFinite(value)
                ? [{ x: scaleX(xValue(datum)), y: scaleY(value) }]
                : [];
            });
            const path = linePath(points, item.curve ?? "monotone");
            if (!path) return null;
            return (
              <g key={item.key}>
                {item.area ? (
                  <path
                    d={areaPath(path, points, plotBottom)}
                    fill={`url(#${gradientPrefix}-${index})`}
                  />
                ) : null}
                <path
                  d={path}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.width ?? 3}
                  strokeDasharray={item.dash}
                  opacity={item.opacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {activeX !== null ? (
            <line
              x1={activeX}
              y1={plotTop}
              x2={activeX}
              y2={plotBottom}
              stroke="#71717A"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {activeDatum
            ? activeSeries.map((item) => (
                <circle
                  key={item.key}
                  cx={scaleX(xValue(activeDatum))}
                  cy={scaleY(item.value)}
                  r="4"
                  fill={item.color}
                  stroke="white"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : null}
        </g>

        {referenceLines.map((line) => {
          if (!line.label) return null;
          const x = scaleX(line.x);
          const useLeft = line.labelSide === "left" || x > plotRight - 96;
          return (
            <text
              key={`${line.key}-label`}
              x={x + (useLeft ? -8 : 8)}
              y={plotTop + 14}
              fill={line.labelColor ?? line.color}
              fontSize="14"
              fontWeight="500"
              textAnchor={useLeft ? "end" : "start"}
            >
              {line.label}
            </text>
          );
        })}

        {resolvedXTicks.map((tick, index) => (
          <text
            key={`x-tick-${tick}`}
            x={scaleX(tick)}
            y={plotBottom + 22}
            fill="currentColor"
            className="text-zinc-500"
            fontSize="13"
            textAnchor={
              index === 0 ? "start" : index === resolvedXTicks.length - 1 ? "end" : "middle"
            }
          >
            {formatXTick(tick)}
          </text>
        ))}
        {showYTickLabels
          ? resolvedYTicks.map((tick) => (
              <text
                key={`y-tick-${tick}`}
                x={plotLeft - 10}
                y={scaleY(tick) + 4}
                fill="currentColor"
                className="text-zinc-500"
                fontSize="13"
                textAnchor="end"
              >
                {formatYTick(tick)}
              </text>
            ))
          : null}

        {xAxisLabel ? (
          <text
            x={(plotLeft + plotRight) / 2}
            y={height - 4}
            fill="currentColor"
            className="text-zinc-600"
            fontSize="14"
            textAnchor="middle"
          >
            {xAxisLabel}
          </text>
        ) : null}
        {yAxisLabel ? (
          <text
            x={14}
            y={(plotTop + plotBottom) / 2}
            fill="currentColor"
            className="text-zinc-600"
            fontSize="14"
            textAnchor="middle"
            transform={`rotate(-90 14 ${(plotTop + plotBottom) / 2})`}
          >
            {yAxisLabel}
          </text>
        ) : null}
      </svg>

      {activeDatum && activeIndex !== null && activeSeries.length ? (
        <div className="pointer-events-none absolute z-20" style={tooltipStyle}>
          {tooltip({ datum: activeDatum, index: activeIndex, series: activeSeries })}
        </div>
      ) : null}

      <div className="sr-only" aria-live="polite">
        {usingKeyboard && activeDatum && activeIndex !== null && activeSeries.length
          ? `${activeIndex + 1} of ${data.length}. ${formatXTick(
              xValue(activeDatum),
            )}. ${activeSeries.map((item) => `${item.label}: ${item.value}`).join(". ")}`
          : ""}
      </div>
    </div>
  );
}

export function linearScale(
  value: number,
  domainStart: number,
  domainEnd: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  if (!Number.isFinite(value) || domainStart === domainEnd) return (rangeStart + rangeEnd) / 2;
  return rangeStart + ((value - domainStart) / (domainEnd - domainStart)) * (rangeEnd - rangeStart);
}

export function findNearestIndex<T>(
  data: readonly T[],
  xValue: (datum: T) => number,
  target: number,
): number {
  if (!data.length) return -1;
  let closestIndex = 0;
  let closestDistance = Math.abs(xValue(data[0]) - target);
  for (let index = 1; index < data.length; index += 1) {
    const distance = Math.abs(xValue(data[index]) - target);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  return closestIndex;
}

export function chartTicks(min: number, max: number, count = 5): number[] {
  const safeCount = Math.max(2, Math.floor(count));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min];
  return Array.from(
    { length: safeCount },
    (_, index) => min + ((max - min) * index) / (safeCount - 1),
  );
}

export function linePath(
  points: readonly { x: number; y: number }[],
  curve: "linear" | "monotone" = "monotone",
): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (curve === "linear") {
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
  }

  const slopes = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const dx = next.x - point.x;
    return dx === 0 ? 0 : (next.y - point.y) / dx;
  });
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0;
    return (before + after) / 2;
  });
  // Constrain each Hermite segment with the Fritsch-Carlson limiter. Keeping
  // both normalized tangents inside the radius-three circle also keeps the
  // cubic Bezier control values inside the adjacent observations' bounds.
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index];
    if (!Number.isFinite(slope) || slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }

    const before = tangents[index] / slope;
    const after = tangents[index + 1] / slope;
    if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }

    const magnitude = Math.hypot(before, after);
    if (magnitude > 3) {
      const scale = 3 / magnitude;
      tangents[index] = scale * before * slope;
      tangents[index + 1] = scale * after * slope;
    }
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const dx = next.x - point.x;
    path += ` C ${point.x + dx / 3} ${point.y + (tangents[index] * dx) / 3}, ${
      next.x - dx / 3
    } ${next.y - (tangents[index + 1] * dx) / 3}, ${next.x} ${next.y}`;
  }
  return path;
}

function areaPath(
  line: string,
  points: readonly { x: number; y: number }[],
  baseline: number,
): string {
  if (!line || !points.length) return "";
  return `${line} L ${points.at(-1)!.x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

function finiteExtent(
  values: readonly number[],
  fallback: readonly [number, number],
): readonly [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  return [Math.min(...finite), Math.max(...finite)];
}

function ensureDomain(domain: readonly [number, number]): readonly [number, number] {
  const [start, end] = domain;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [0, 1];
  if (start === end) {
    const pad = Math.abs(start) * 0.1 || 1;
    return [start - pad, end + pad];
  }
  return start < end ? domain : [end, start];
}

function paddedDomain(domain: readonly [number, number]): readonly [number, number] {
  const safe = ensureDomain(domain);
  const span = safe[1] - safe[0];
  return [safe[0], safe[1] + span * 0.1];
}

function defaultTickFormatter(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 }).format(value);
}
