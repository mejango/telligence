import { fmtUnits } from "@/app/[slug]/components/v6/owners/settlement/lib";
import { compactTokenAmount, exactNumber, formatPriceValue } from "@/lib/number";
import { formatShare } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("shared number formatting", () => {
  it("abbreviates a dense-list token amount and keeps every digit for the hover", () => {
    expect(compactTokenAmount(1130130258069698905346873n, 18, "REV")).toEqual({
      text: "1.13M REV",
      title: "1,130,130.258069698905346873 REV",
    });
    expect(compactTokenAmount(75107100000000000000n, 18, "REV").text).toBe("75.11 REV");
    expect(compactTokenAmount(201370113n, 6, "USDC").text).toBe("201.37 USDC");
    expect(compactTokenAmount(12300000000000000n, 18, "ETH").text).toBe("0.0123 ETH");
    expect(compactTokenAmount(10000000000000n, 18).text).toBe("0.00001");
    expect(compactTokenAmount(0n, 18, "REV").text).toBe("0 REV");
  });

  it("keeps a decimal string's exact digits instead of float noise", () => {
    expect(exactNumber("1130130.258069698905346873")).toBe("1,130,130.258069698905346873");
    expect(exactNumber("12.500")).toBe("12.5");
  });

  it("prints prices without an exponent and never rounds a real one to zero", () => {
    expect(formatPriceValue(5.36e-6)).toBe("0.00000536");
    expect(formatPriceValue(4.2e-9)).toBe("0.0000000042");
    expect(formatPriceValue(0.00176056)).toBe("0.00176056");
    expect(formatPriceValue(0.0001)).toBe("0.0001");
    expect(formatPriceValue(1234.56789)).toBe("1,234.5679");
    expect(formatPriceValue(0)).toBe("0");
    expect(fmtUnits(5360000000000n, 18)).toBe("0.00000536");
  });

  it("floors a real share that rounds to nothing", () => {
    expect(formatShare(15_775n, 100_000n)).toBe("15.775%");
    expect(formatShare(1n, 10n ** 18n)).toBe("<0.001%");
    expect(formatShare(0n, 100n)).toBe("0%");
    expect(formatShare(5n, 0n)).toBe("0%");
  });
});
