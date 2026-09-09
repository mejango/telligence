import { getStartTimeForRange, getTimeRangeConfig, parseTimeRange } from "@/lib/timeRange";
import { describe, expect, it, vi } from "vitest";

describe("short price-chart ranges", () => {
  it("accepts one- and six-hour URLs with minute-scale buckets", () => {
    expect(parseTimeRange("1h")).toBe("1h");
    expect(parseTimeRange("6h")).toBe("6h");
    // Nothing in the URL means a quarter, which is the range the selector
    // shows as active — the two defaults have to agree or the chart renders
    // one range with another highlighted.
    expect(parseTimeRange(null)).toBe("3m");
    expect(parseTimeRange("nonsense")).toBe("3m");
    expect(getTimeRangeConfig("1h")).toEqual({ seconds: 3600, interval: 60 });
    expect(getTimeRangeConfig("6h")).toEqual({ seconds: 21_600, interval: 300 });
  });

  it("starts each short range at the requested lookback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T15:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    expect(getStartTimeForRange("1h")).toBe(now - 3600);
    expect(getStartTimeForRange("6h")).toBe(now - 21_600);
    vi.useRealTimers();
  });
});
