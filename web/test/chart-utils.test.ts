import {
  axisTickCountForWidth,
  buildStepPoints,
  formatRate,
  issuanceBaseCurrencyLabel,
  rateAtTime,
  resolveStages,
} from "@/app/[slug]/components/v6/terms/chartUtils";
import { describe, expect, it } from "vitest";

const DAY = 86_400;

describe("issuance chart projections", () => {
  it("keeps a two-year daily cut discrete and compounds the uint32 cut correctly", () => {
    const resolved = resolveStages([
      {
        start: 0,
        duration: DAY,
        weight: 10_000n * 10n ** 18n,
        weightCutPercent: 9_496,
      },
    ]);

    const points = buildStepPoints(resolved, 0, 730 * DAY + 1);

    expect(points.length).toBeGreaterThan(1_400);
    expect(rateAtTime(resolved, 730 * DAY)).toBeCloseTo(9_930.91, 1);
    expect(points.some(([time]) => time === DAY)).toBe(true);
  });

  it("does not round a visible high issuance rate to a misleading integer", () => {
    expect(formatRate(9_999.90504)).toBe("9,999.91");
  });

  it("labels issuance from the ruleset base currency instead of its payment token", () => {
    expect(issuanceBaseCurrencyLabel(2, "USDC")).toBe("USD");
    expect(issuanceBaseCurrencyLabel(1, "USDC")).toBe("ETH");
    expect(issuanceBaseCurrencyLabel(7, "TOKEN")).toBe("TOKEN");
  });

  it("reduces date ticks to preserve space between labels in narrow charts", () => {
    expect(axisTickCountForWidth(0)).toBe(5);
    expect(axisTickCountForWidth(720)).toBe(5);
    expect(axisTickCountForWidth(448)).toBe(5);
    expect(axisTickCountForWidth(447)).toBe(4);
    expect(axisTickCountForWidth(300)).toBe(3);
    expect(axisTickCountForWidth(200)).toBe(2);
  });
});
