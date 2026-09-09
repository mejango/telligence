import { decodeRulesetMetadata } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("decodeRulesetMetadata", () => {
  it("decodes bit 79 as scopeCashOutsToLocalBalances (true = local-chain balance only)", () => {
    const decoded = decodeRulesetMetadata(1n << 79n);

    expect(decoded.scopeCashOutsToLocalBalances).toBe(true);
    // The field name must not carry the inverted legacy meaning.
    expect("useTotalSurplusForCashOuts" in decoded).toBe(false);
  });

  it("keeps bit 79 clear of its neighbors", () => {
    expect(decodeRulesetMetadata(0n).scopeCashOutsToLocalBalances).toBe(false);
    // holdFees (78) and useDataHookForPay (80) set; 79 clear.
    const decoded = decodeRulesetMetadata((1n << 78n) | (1n << 80n));
    expect(decoded.scopeCashOutsToLocalBalances).toBe(false);
    expect(decoded.holdFees).toBe(true);
    expect(decoded.useDataHookForPay).toBe(true);
  });
});
