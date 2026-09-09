import type { Ruleset } from "@/app/[slug]/terms/getRulesets";
import { resolveProjectBaseToken } from "@/hooks/useProjectBaseToken";
import { isUsd, toBaseCurrencyId } from "@/lib/currency";
import {
  applyNanaFee,
  applyRevFee,
  generateFeeData,
  netLoanProceeds,
  revFeeApplies,
} from "@/lib/feeHelpers";
import { calculatePriceAtTimestamp } from "@/lib/issuancePrice";
import { getTokenConfigForChain, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { ETH_CURRENCY_ID, NATIVE_TOKEN, USD_CURRENCY_ID } from "@bananapus/nana-sdk-core";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: vi.fn() }));

describe("contract-derived monetary display math", () => {
  it("applies the Revnet and Juicebox cash-out fees in integer arithmetic", () => {
    expect(applyRevFee(10_000n)).toBe(9_750n);
    expect(applyNanaFee(10_000n)).toBe(9_750n);
    expect(applyRevFee(1n)).toBe(0n);
  });

  it("shows minimum-fee loan proceeds instead of gross principal", () => {
    expect(netLoanProceeds(1_000_000n)).toBe(940_000n);
    expect(netLoanProceeds(4_001n)).toBe(3_761n);
  });

  it("derives issuance price after complete ruleset cycles", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        start: 1_000,
        duration: 100,
        weight: "1000000000000000000000",
        weightCutPercent: 0.1,
        baseCurrency: 2,
      },
    ];

    expect(calculatePriceAtTimestamp(999, rulesets)).toBeUndefined();
    expect(calculatePriceAtTimestamp(1_000, rulesets)).toBeCloseTo(1 / 1_000);
    expect(calculatePriceAtTimestamp(1_250, rulesets)).toBeCloseTo(1 / 810);
  });

  it("returns no price for a zero issuance weight", () => {
    expect(
      calculatePriceAtTimestamp(1_000, [
        {
          id: 1,
          start: 1_000,
          duration: 0,
          weight: "0",
          weightCutPercent: 0,
          baseCurrency: 2,
        },
      ]),
    ).toBeUndefined();
  });

  it("keeps base-currency ids distinct from token-keyed accounting currencies", () => {
    expect(toBaseCurrencyId(1)).toBe(ETH_CURRENCY_ID);
    expect(toBaseCurrencyId(61166)).toBe(ETH_CURRENCY_ID);
    expect(toBaseCurrencyId(2)).toBe(USD_CURRENCY_ID(6));
    expect(toBaseCurrencyId(123456)).toBe(123456);
    expect(isUsd("usdc")).toBe(true);
    expect(isUsd("ETH")).toBe(false);
  });

  it("preserves custom token address, decimals, and currency from indexed contract data", () => {
    const token = "0x000000000000000000000000000000000000cafe" as Address;
    const config = getTokenConfigForChain(
      {
        suckerGroup: {
          projects: {
            items: [{ chainId: 8453, token, currency: "123456", decimals: 8 }],
          },
        },
      },
      8453,
    );

    expect(config).toEqual({ token, currency: 123456, decimals: 8, symbol: "TOKEN" });
    expect(getTokenSymbolFromAddress(token)).toBe("TOKEN");
    expect(getTokenSymbolFromAddress(NATIVE_TOKEN)).toBe("ETH");
  });

  it("renders a custom accounting context in its own symbol and denomination", () => {
    const token = "0x000000000000000000000000000000000000cafe" as Address;
    expect(
      resolveProjectBaseToken({
        token,
        tokenSymbol: "DAI",
        decimals: 18,
        currency: "12648430",
      }),
    ).toEqual({
      address: token,
      symbol: "DAI",
      decimals: 18,
      currency: 12648430,
      isNative: false,
    });
  });

  it("returns a harmless zero-cost chart for invalid loan input", () => {
    expect(generateFeeData({ grossBorrowedEth: Number.NaN, prepaidPercent: "0" })).toEqual([
      { year: 0, totalCost: 0 },
      { year: 10, totalCost: 0 },
    ]);
  });

  it("keeps loan costs bounded and monotonic over the displayed ten-year horizon", () => {
    const points = generateFeeData({ grossBorrowedEth: 100, prepaidPercent: "0" });

    expect(points[0]).toEqual({ year: 0, totalCost: 100 });
    expect(points.at(-1)).toMatchObject({ year: 10 });
    expect(points.at(-1)?.totalCost).toBeGreaterThan(points[0].totalCost);
    // The contract rejects prepaid fee percents below MIN_PREPAID_FEE_PERCENT = 25 permil
    // (REVLoans.sol:1339-1343), so "0" carries the 2.5% minimum: prepaid = 2.5 and the ramp
    // (REVLoansSourceFees.sol:43-53) reaches 100% of `loan.amount - prepaid` = 97.5 at
    // liquidation. Max unlock cost = 100 + 97.5 = 197.5.
    expect(points.at(-1)?.totalCost).toBeCloseTo(197.5, 10);
    expect(
      points.every((point, index) => index === 0 || point.totalCost >= points[index - 1].totalCost),
    ).toBe(true);
  });

  it("prices the prepaid fee in permil of the borrowed amount, per the contract's linear map", () => {
    // 50% prepaid = MAX_PREPAID_FEE_PERCENT = 500 permil: prepaid = 50, so the decaying
    // portion is `loan.amount - prepaid` = 50 and the max unlock cost is 150 — not the
    // 195 that a basis-point denominator would produce.
    const maxed = generateFeeData({ grossBorrowedEth: 100, prepaidPercent: "50" });
    expect(maxed.at(-1)?.totalCost).toBeCloseTo(150, 10);

    // The default 2.5% is exactly the contract minimum: 25 permil buys a 6-month window
    // (REVLoans.sol:1367-1368 — 25/500 of the 120-month liquidation duration), inside which
    // the unlock cost stays flat at the borrowed amount.
    const min = generateFeeData({ grossBorrowedEth: 100, prepaidPercent: "2.5" });
    expect(min.find((point) => point.year === 0.5)?.totalCost).toBe(100);
    expect(min.find((point) => point.year === 0.75)?.totalCost).toBeGreaterThan(100);
    expect(min.at(-1)?.totalCost).toBeCloseTo(197.5, 10);
  });
});

// REVOwner is what charges the revnet cash-out fee, and it skips the fee hook entirely on a
// zero-tax cash-out: "Zero-tax ordinary cash-outs do not add the revnet fee hook"
// (REVOwner.sol:303). Applying it unconditionally under-quoted every zero-tax revnet — and
// every plain project, which has no REVOwner at all — by 2.5%.
describe("revFeeApplies", () => {
  it("charges the fee on a revnet with a nonzero cash-out tax", () => {
    expect(revFeeApplies(true, 2_000n)).toBe(true);
  });

  it("skips the fee when the cash-out tax is zero", () => {
    expect(revFeeApplies(true, 0n)).toBe(false);
  });

  it("skips the fee for a project that is not a revnet", () => {
    expect(revFeeApplies(false, 2_000n)).toBe(false);
  });

  it("suppresses the fee while either input is still loading", () => {
    // A quote that is too high is the safer error for someone deciding whether to cash out.
    expect(revFeeApplies(undefined, 2_000n)).toBe(false);
    expect(revFeeApplies(true, undefined)).toBe(false);
  });
});
