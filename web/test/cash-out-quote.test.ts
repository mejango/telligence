import {
  cashOutExecutionErrorMessage,
  cashOutMinimumDropped,
  cashOutPoolBufferBps,
  resolveCashOutChainId,
} from "@/lib/cashOutQuote";
import type { CashOutRoute } from "@bananapus/nana-sdk-core/v6";
import { describe, expect, it } from "vitest";

// SDK 3.4 reads a revert only with its arguments, as a simulation's error carries them.
function revert(selector: string) {
  const word = (value: bigint) => value.toString(16).padStart(64, "0");
  return Object.assign(new Error("cashOutTokensOf reverted"), {
    data: `${selector}${word(1n)}${word(2n)}`,
  });
}

describe("cash-out chain and presentation adapters", () => {
  it("defaults one available chain and drops a stale remembered selection", () => {
    expect(resolveCashOutChainId([8453], undefined)).toBe("8453");
    expect(resolveCashOutChainId([8453], "1")).toBe("8453");
    expect(resolveCashOutChainId([1, 8453], "8453")).toBe("8453");
    expect(resolveCashOutChainId([1, 8453], "10")).toBeUndefined();
  });

  it("explains the buyback slippage selector", () => {
    expect(cashOutExecutionErrorMessage(revert("0xe2d708a9"))).toMatch(
      /pool moved below your protected minimum/i,
    );
  });

  it("explains terminal minimum failures and ignores unrelated errors", () => {
    expect(cashOutExecutionErrorMessage(revert("0x6b2bb382"))).toMatch(
      /project cash-out fell below your protected minimum/i,
    );
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
});

describe("cashOutMinimumDropped", () => {
  it("refuses a send whose minimum is below the reviewed one, or whose reviewed minimum is unread", () => {
    expect(cashOutMinimumDropped(100n, 99n)).toBe(true);
    expect(cashOutMinimumDropped(undefined, 99n)).toBe(true);
    expect(cashOutMinimumDropped(100n, 100n)).toBe(false);
    expect(cashOutMinimumDropped(100n, 101n)).toBe(false);
  });
});
