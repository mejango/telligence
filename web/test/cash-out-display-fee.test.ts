import { applyNanaFee, netCashOutValue } from "@/lib/feeHelpers";
import { describe, expect, it } from "vitest";

describe("cash-out display fee math (mirrors JBMultiTerminal._cashOutTokensOf)", () => {
  it("charges floor(reclaim / 40) on the whole reclaim when the cash-out tax is nonzero", () => {
    // 1-wei-sensitive case: floor(1001 / 40) = 25 -> net 976, while the old
    // x975/1000 approximation floors to 975.
    expect(netCashOutValue({ reclaimAmount: 1_001n, cashOutTaxRate: 1n, feeFreeSurplus: 0n })).toBe(
      976n,
    );
    expect((1_001n * 975n) / 1_000n).toBe(975n);

    // Below 40 wei the protocol fee floors to zero.
    expect(
      netCashOutValue({ reclaimAmount: 39n, cashOutTaxRate: 5_000n, feeFreeSurplus: 0n }),
    ).toBe(39n);
  });

  it("charges the fee only up to feeFreeSurplusOf when the cash-out tax is zero", () => {
    // feeFreeSurplus < reclaim: fee = floor(400 / 40) = 10.
    expect(
      netCashOutValue({ reclaimAmount: 1_000n, cashOutTaxRate: 0n, feeFreeSurplus: 400n }),
    ).toBe(990n);
    // reclaim <= feeFreeSurplus: fee on the whole reclaim.
    expect(netCashOutValue({ reclaimAmount: 300n, cashOutTaxRate: 0n, feeFreeSurplus: 400n })).toBe(
      293n,
    );
  });

  it("applies the flat fee with the contract's floor division", () => {
    expect(applyNanaFee(10_000n)).toBe(9_750n);
    expect(applyNanaFee(1_001n)).toBe(976n);
  });
});
