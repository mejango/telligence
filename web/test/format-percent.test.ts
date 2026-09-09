import { formatAdaptivePercent } from "@/lib/formatPercent";
import { describe, expect, it } from "vitest";

describe("formatAdaptivePercent", () => {
  it("keeps ordinary percentages compact", () => {
    expect(formatAdaptivePercent(38)).toBe("38");
    expect(formatAdaptivePercent(7.5)).toBe("7.5");
  });

  it("never rounds a non-zero issuance cut to zero", () => {
    expect(formatAdaptivePercent(0.0009496)).toBe("0.0009496");
  });
});
