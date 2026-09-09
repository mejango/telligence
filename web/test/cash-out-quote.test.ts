import {
  cashOutDisplayUnit,
  cashOutExecutionErrorMessage,
  cashOutPoolBufferBps,
  contractCashOutQuote,
  exitFloorQuote,
  resolveCashOutChainId,
} from "@/lib/cashOutQuote";
import type { CashOutRoute } from "@bananapus/nana-sdk-core/v6";
import { describe, expect, it } from "vitest";

describe("wallet-action:cash-out — contract-derived cash-out quote", () => {
  it("defaults one available chain and drops a stale remembered selection", () => {
    expect(resolveCashOutChainId([8453], undefined)).toBe("8453");
    expect(resolveCashOutChainId([8453], "1")).toBe("8453");
    expect(resolveCashOutChainId([1, 8453], "8453")).toBe("8453");
    expect(resolveCashOutChainId([1, 8453], "10")).toBeUndefined();
  });

  it("explains the buyback slippage selector", () => {
    expect(
      cashOutExecutionErrorMessage(new Error("cashOutTokensOf reverted with signature 0xe2d708a9")),
    ).toMatch(/pool moved below your protected minimum/i);
  });

  it("explains terminal minimum failures and ignores unrelated errors", () => {
    expect(
      cashOutExecutionErrorMessage(new Error("cashOutTokensOf reverted with signature 0x6b2bb382")),
    ).toMatch(/project cash-out fell below your protected minimum/i);
    expect(cashOutExecutionErrorMessage(new Error("wallet disconnected"))).toBeNull();
  });

  it("reports the SDK buyback quote buffer in display basis points", () => {
    expect(cashOutPoolBufferBps(undefined)).toBeNull();

    const route: CashOutRoute = {
      route: "amm",
      expectedReturn: 16_419_630n,
      minimumReturn: 15_840_000n,
      terminalMinimum: 0n,
      metadata: "0xabcdef",
      treasuryGross: 1_546_940n,
      treasuryProtocolFee: 38_673n,
      treasuryNet: 1_508_267n,
      buyback: {
        hook: "0x4444444444444444444444444444444444444444",
        minimumSwapAmountOut: 16_000_000n,
        cashOutCountToSell: 164_939n,
        netDirectCashOutAmount: 1_508_267n,
        twapTick: 0,
        twapLiquidity: 1n,
        poolId: `0x${"11".repeat(32)}`,
        rawSwapQuote: 16_419_630n,
        hasUserSpecifiedMinimumSwapAmountOut: false,
      },
    };

    expect(cashOutPoolBufferBps(route)).toBe(256);
  });

  it("matches the contract's zero and full-supply branches", () => {
    expect(
      contractCashOutQuote({
        surplus: 100n,
        cashOutCount: 0n,
        totalSupply: 0n,
        cashOutTaxRate: 0n,
      }),
    ).toBe(0n);
    expect(
      contractCashOutQuote({
        surplus: 100n,
        cashOutCount: 100n,
        totalSupply: 100n,
        cashOutTaxRate: 5_000n,
      }),
    ).toBe(100n);
    expect(
      contractCashOutQuote({
        surplus: 100n,
        cashOutCount: 50n,
        totalSupply: 100n,
        cashOutTaxRate: 10_000n,
      }),
    ).toBe(0n);
  });

  it("uses exact contract integer ordering for proportional and taxed quotes", () => {
    expect(
      contractCashOutQuote({
        surplus: 1_000_000n,
        cashOutCount: 20n,
        totalSupply: 100n,
        cashOutTaxRate: 0n,
      }),
    ).toBe(200_000n);
    // base=200,000; numerator=5,000 + (5,000*20/100)=6,000.
    expect(
      contractCashOutQuote({
        surplus: 1_000_000n,
        cashOutCount: 20n,
        totalSupply: 100n,
        cashOutTaxRate: 5_000n,
      }),
    ).toBe(120_000n);
  });

  it("includes pending reserved tokens before applying the full-supply branch", () => {
    expect(
      exitFloorQuote({
        mintedSupply: 100n,
        pendingReservedTokens: 100n,
        surplus: 1_000n,
        cashOutTaxRate: 0n,
        tokenDecimals: 0,
      }),
    ).toEqual({ cashOutCount: 1n, reclaimAmount: 5n });

    expect(
      contractCashOutQuote({
        surplus: 1_000n,
        cashOutCount: 100n,
        totalSupply: 200n,
        cashOutTaxRate: 0n,
      }),
    ).toBe(500n);
  });

  it("quotes an explicit sub-token unit without nonlinear extrapolation", () => {
    const supply = 50_000_000_000_000_000n; // 0.05 tokens at 18 decimals.
    expect(cashOutDisplayUnit(supply, 18)).toBe(10_000_000_000_000_000n);
    expect(
      exitFloorQuote({
        mintedSupply: supply,
        pendingReservedTokens: 0n,
        surplus: 5_000n,
        cashOutTaxRate: 0n,
        tokenDecimals: 18,
      }),
    ).toEqual({ cashOutCount: 10_000_000_000_000_000n, reclaimAmount: 1_000n });
  });

  it("distinguishes a loaded zero surplus from unavailable state", () => {
    expect(
      exitFloorQuote({
        mintedSupply: 10n ** 18n,
        pendingReservedTokens: 0n,
        surplus: 0n,
        cashOutTaxRate: 2_000n,
        tokenDecimals: 18,
      }),
    ).toEqual({ cashOutCount: 10n ** 18n, reclaimAmount: 0n });
    expect(
      exitFloorQuote({
        mintedSupply: 0n,
        pendingReservedTokens: 0n,
        surplus: 1_000n,
        cashOutTaxRate: 0n,
        tokenDecimals: 18,
      }),
    ).toBeNull();
  });

  it("fails closed for values the contract cannot accept", () => {
    expect(() =>
      contractCashOutQuote({
        surplus: 1n,
        cashOutCount: 1n,
        totalSupply: 1n,
        cashOutTaxRate: 10_001n,
      }),
    ).toThrow(/outside contract bounds/u);
    expect(() => cashOutDisplayUnit(1n, 37)).toThrow(/decimals/u);
  });
});
