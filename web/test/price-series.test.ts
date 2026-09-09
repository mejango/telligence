import { bucketPoolReserves, poolReservesAt, smoothPriceSeries } from "@/lib/priceSeries";
import { describe, expect, it } from "vitest";

describe("smoothPriceSeries", () => {
  it("attenuates a short-lived spike and preserves exact endpoints", () => {
    const smoothed = smoothPriceSeries([
      { timestamp: 0, value: 10 },
      { timestamp: 40, value: 100 },
      { timestamp: 41, value: 10 },
      { timestamp: 100, value: 10 },
    ]);

    expect(smoothed[0]).toEqual({ timestamp: 0, value: 10 });
    expect(smoothed.at(-1)).toEqual({ timestamp: 100, value: 10 });
    expect(Math.max(...smoothed.map((point) => point.value))).toBeLessThan(20);
  });

  it("keeps sparse histories exact", () => {
    const points = [
      { timestamp: 0, value: 10 },
      { timestamp: 100, value: 12 },
    ];
    expect(smoothPriceSeries(points)).toEqual(points);
  });
});

describe("bucketPoolReserves", () => {
  it("resamples onto even buckets, holding the last observation and skipping the pre-pool span", () => {
    const buckets = bucketPoolReserves(
      [
        { timestamp: 70, pairAmount: 3, tokenAmount: 40, pairValue: 3, tokenValue: 4 },
        { timestamp: 50, pairAmount: 1, tokenAmount: 20, pairValue: 1, tokenValue: 2 },
      ],
      0,
      100,
      4,
    );
    expect(buckets).toEqual([
      { timestamp: 37.5, pairAmount: 1, tokenAmount: 20, pairValue: 1, tokenValue: 2 },
      { timestamp: 62.5, pairAmount: 3, tokenAmount: 40, pairValue: 3, tokenValue: 4 },
      { timestamp: 87.5, pairAmount: 3, tokenAmount: 40, pairValue: 3, tokenValue: 4 },
    ]);
  });

  it("shows a change landing in the last half of the final bucket", () => {
    const latest = { timestamp: 99, pairAmount: 9, tokenAmount: 90, pairValue: 9, tokenValue: 9 };
    const buckets = bucketPoolReserves(
      [{ timestamp: 10, pairAmount: 1, tokenAmount: 20, pairValue: 1, tokenValue: 2 }, latest],
      0,
      100,
      4,
    );
    expect(buckets.at(-1)).toEqual({ ...latest, timestamp: 87.5 });
  });
});

describe("poolReservesAt", () => {
  const points = [
    { timestamp: 50, pairAmount: 1, tokenAmount: 20, pairValue: 1, tokenValue: 2 },
    { timestamp: 70, pairAmount: 3, tokenAmount: 40, pairValue: 3, tokenValue: 4 },
  ];
  it("holds the last observation at or before the moment, and nothing before the first", () => {
    expect(poolReservesAt(points, 49)).toBeUndefined();
    expect(poolReservesAt(points, 50)).toBe(points[0]);
    expect(poolReservesAt(points, 69)).toBe(points[0]);
    expect(poolReservesAt(points, 1000)).toBe(points[1]);
  });
});
