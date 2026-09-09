// The price chart's Y axis is the ruleset's BASE CURRENCY — what the project denominates
// issuance in, and what the protocol prices against (JBTerminalStore converts every payment
// into `ruleset.baseCurrency()` before applying the weight, JBTerminalStore.sol:1165-1175).
// Issuance (1/weight) is therefore exact and needs no conversion; the AMM and cash-out series
// are accounting-token denominated and must be converted ONTO that axis. Mixing the two — the
// bug this replaced — draws a USD-per-token line against a USDC-per-token line on one axis.
import {
  accountingIsAxisUnit,
  baseIsUsd,
  rateAt,
  toBaseAxis,
  usdPerAccountingTokenFrom,
} from "@/lib/baseCurrencyRate";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { BASE_CURRENCY_ETH, BASE_CURRENCY_USD, tokenCurrencyId } from "@bananapus/nana-sdk-core/v6";
import { describe, expect, it } from "vitest";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("accountingIsAxisUnit", () => {
  it("needs no conversion for an ETH-base project with a native terminal", () => {
    expect(accountingIsAxisUnit(BASE_CURRENCY_ETH, NATIVE_TOKEN)).toBe(true);
    expect(accountingIsAxisUnit(BASE_CURRENCY_ETH, NATIVE_TOKEN.toLowerCase())).toBe(true);
  });

  it("needs no conversion when the base currency IS the accounting token", () => {
    expect(accountingIsAxisUnit(tokenCurrencyId(USDC), USDC)).toBe(true);
  });

  it("requires conversion for a USD-base project with an ETH terminal", () => {
    // The first-class "price issuance in dollars, hold ETH" revnet configuration.
    expect(accountingIsAxisUnit(BASE_CURRENCY_USD, NATIVE_TOKEN)).toBe(false);
    expect(baseIsUsd(BASE_CURRENCY_USD)).toBe(true);
  });

  it("requires conversion for an ETH-base project with a USDC terminal", () => {
    expect(accountingIsAxisUnit(BASE_CURRENCY_ETH, USDC)).toBe(false);
  });

  it("treats an unknown base currency as not-on-axis", () => {
    expect(accountingIsAxisUnit(undefined, NATIVE_TOKEN)).toBe(false);
  });
});

describe("usdPerAccountingTokenFrom", () => {
  // Shapes taken from live V6 mainnet pay events.
  const ethEvents = [
    { timestamp: 1781814155, amount: "100000000000000", amountUsd: "171100000000000000" },
    { timestamp: 1781827379, amount: "1000000000000000", amountUsd: "1707000000000000000" },
  ];

  it("derives USD per accounting token from amount and amountUsd", () => {
    const [first, second] = usdPerAccountingTokenFrom(ethEvents, 18);
    expect(first.rate).toBeCloseTo(1711, 0);
    expect(second.rate).toBeCloseTo(1707, 0);
  });

  it("drops points whose USD valuation is missing", () => {
    // Live data really does this: a 20 USDC payment reported amountUsd: 0. Trusting it
    // would produce a rate of zero and blank every converted price.
    const points = usdPerAccountingTokenFrom(
      [{ timestamp: 1781815043, amount: "20000000", amountUsd: "0" }],
      6,
    );
    expect(points).toEqual([]);
  });

  it("drops zero-amount points and returns ascending timestamps", () => {
    const points = usdPerAccountingTokenFrom(
      [
        { timestamp: 300, amount: "1000000000000000000", amountUsd: "2000000000000000000" },
        { timestamp: 100, amount: "0", amountUsd: "5000000000000000000" },
        { timestamp: 200, amount: "1000000000000000000", amountUsd: "1000000000000000000" },
      ],
      18,
    );
    expect(points.map((p) => p.timestamp)).toEqual([200, 300]);
  });
});

describe("rateAt", () => {
  const points = [
    { timestamp: 100, rate: 10 },
    { timestamp: 200, rate: 20 },
  ];

  it("carries the last observed rate forward", () => {
    expect(rateAt(points, 150)).toBe(10);
    expect(rateAt(points, 200)).toBe(20);
    expect(rateAt(points, 10_000)).toBe(20);
  });

  it("never carries a rate backward — that would restate history", () => {
    expect(rateAt(points, 99)).toBeNull();
    expect(rateAt([], 150)).toBeNull();
  });
});

describe("toBaseAxis", () => {
  it("converts an accounting-denominated price onto the axis", () => {
    // 0.0005 ETH per token at 1700 USD/ETH = 0.85 USD per token.
    expect(toBaseAxis(0.0005, 1700)).toBeCloseTo(0.85, 10);
  });

  it("omits the point rather than guessing when no rate is known", () => {
    expect(toBaseAxis(0.0005, null)).toBeUndefined();
    expect(toBaseAxis(undefined, 1700)).toBeUndefined();
  });
});
