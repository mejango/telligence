import {
  minimumCashOutPriceAtIssuancePrice,
  shouldShowCashOutAsymptote,
} from "@/lib/minimumCashOutPrice";
import { describe, expect, it } from "vitest";

describe("payment asymptote", () => {
  it("calculates the long-run payment asymptote", () => {
    expect(minimumCashOutPriceAtIssuancePrice(0.1, 2_000)).toBeCloseTo(0.08, 10);
  });

  it("returns zero without an issuance price", () => {
    expect(minimumCashOutPriceAtIssuancePrice(0, 2_000)).toBe(0);
  });

  it("shows the line only when the live quote can fall toward it", () => {
    expect(shouldShowCashOutAsymptote(0.08, 0.06)).toBe(true);
    expect(shouldShowCashOutAsymptote(0.06, 0.06)).toBe(false);
    expect(shouldShowCashOutAsymptote(0.05, 0.06)).toBe(false);
  });
});
