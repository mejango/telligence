import { describe, expect, it } from "vitest";

import {
  describeAddLiquidityPlan,
  liquidityFormView,
} from "@/app/[slug]/components/v6/owners/market/formView";

// The add-liquidity form's entire decision surface, as one pure function.
// Amounts mode: both amounts editable, the range is solved. Range mode: the
// range is editable, the last-touched amount drives and the other follows.

const REFERENCE = { cashOut: 6.68961e-8, issuance: 0.0016 };
const PRICE = 0.00001;

const base = {
  tokenText: "",
  pairText: "",
  minText: "",
  maxText: "",
  driver: "token" as const,
  price: PRICE,
  reference: REFERENCE,
  tokenSymbol: "MARKEE",
  pairSymbol: "ETH",
};

describe("liquidityFormView — amounts mode", () => {
  it("solves the range from both amounts and leads the summary with them", () => {
    const view = liquidityFormView({
      ...base,
      mode: "amounts",
      tokenText: "100000",
      pairText: "0.08",
    });
    expect(view.ready).toBe(true);
    expect(view.anchor).toBe("ceiling");
    expect(view.maxPrice).toBe(REFERENCE.issuance);
    expect(view.minPrice).toBeGreaterThan(REFERENCE.cashOut);
    expect(view.minPrice).toBeLessThan(PRICE);
    expect(view.tokenAmount).toBe(100000);
    expect(view.pairAmount).toBe(0.08);
    expect(view.summary).toContain("100000 MARKEE");
    expect(view.summary).toContain("0.08 ETH");
    expect(view.note).toContain("issuance");
  });

  it("anchors at the cash-out floor when the token side fits", () => {
    const view = liquidityFormView({
      ...base,
      mode: "amounts",
      tokenText: "1000",
      pairText: "0.08",
    });
    expect(view.ready).toBe(true);
    expect(view.anchor).toBe("floor");
    expect(view.minPrice).toBe(REFERENCE.cashOut);
    expect(view.note).toContain("cash-out");
  });

  it("prompts for amounts when both fields are empty", () => {
    const view = liquidityFormView({ ...base, mode: "amounts" });
    expect(view.ready).toBe(false);
    expect(view.summary).toBeNull();
    expect(view.note).toContain("Enter");
  });

  it("supports a single-sided pair deposit and says what it means", () => {
    const view = liquidityFormView({
      ...base,
      mode: "amounts",
      tokenText: "",
      pairText: "0.08",
    });
    expect(view.ready).toBe(true);
    expect(view.maxPrice).toBe(PRICE);
    expect(view.note).toContain("below the current price");
  });

  it("rejects unparseable amounts", () => {
    const view = liquidityFormView({
      ...base,
      mode: "amounts",
      tokenText: "abc",
      pairText: "0.08",
    });
    expect(view.ready).toBe(false);
  });
});

describe("liquidityFormView — range mode", () => {
  const inRange = { minText: "0.000005", maxText: "0.00002" };

  it("derives the pair amount when the token amount drives", () => {
    const view = liquidityFormView({
      ...base,
      mode: "range",
      ...inRange,
      tokenText: "1000",
      driver: "token",
    });
    expect(view.ready).toBe(true);
    expect(view.derived).toBe("pair");
    expect(view.pairAmount).toBeGreaterThan(0);
    expect(view.tokenAmount).toBe(1000);
    expect(view.disabled).toEqual({ token: false, pair: false });
  });

  it("derives the token amount when the pair amount drives", () => {
    const view = liquidityFormView({
      ...base,
      mode: "range",
      ...inRange,
      pairText: "0.08",
      driver: "pair",
    });
    expect(view.ready).toBe(true);
    expect(view.derived).toBe("token");
    expect(view.tokenAmount).toBeGreaterThan(0);
  });

  it("disables the token side when the range sits entirely below the current price", () => {
    const view = liquidityFormView({
      ...base,
      mode: "range",
      minText: "0.000001",
      maxText: "0.000005",
      pairText: "0.08",
      driver: "pair",
    });
    expect(view.disabled).toEqual({ token: true, pair: false });
    expect(view.tokenAmount).toBe(0);
    expect(view.derived).toBeNull();
    expect(view.ready).toBe(true);
    expect(view.note).toContain("only takes ETH");
  });

  it("disables the pair side when the range sits entirely above the current price", () => {
    const view = liquidityFormView({
      ...base,
      mode: "range",
      minText: "0.00002",
      maxText: "0.00004",
      tokenText: "1000",
      driver: "token",
    });
    expect(view.disabled).toEqual({ token: false, pair: true });
    expect(view.pairAmount).toBe(0);
    expect(view.ready).toBe(true);
    expect(view.note).toContain("only takes MARKEE");
  });

  it("is not ready without a valid range", () => {
    const view = liquidityFormView({
      ...base,
      mode: "range",
      minText: "0.00002",
      maxText: "0.000005",
      tokenText: "1000",
    });
    expect(view.ready).toBe(false);
  });

  it("is not ready when the driving amount is empty", () => {
    const view = liquidityFormView({
      ...base,
      mode: "range",
      ...inRange,
      driver: "token",
    });
    expect(view.ready).toBe(false);
  });
});

describe("liquidityFormView — make-the-market mode", () => {
  it("places each side on its half of the corridor with independent amounts", () => {
    const view = liquidityFormView({
      ...base,
      mode: "market",
      tokenText: "20000000",
      pairText: "8000",
    });
    expect(view.ready).toBe(true);
    expect(view.minPrice).toBe(REFERENCE.cashOut);
    expect(view.maxPrice).toBe(REFERENCE.issuance);
    // Nothing is derived: both amounts are used as typed.
    expect(view.derived).toBeNull();
    expect(view.tokenAmount).toBe(20000000);
    expect(view.pairAmount).toBe(8000);
    expect(view.disabled).toEqual({ token: false, pair: false });
    // The corridor line is the only guidance: the amounts speak for themselves.
    expect(view.summary).toBeNull();
    expect(view.note).toContain("independent");
  });

  it("works with one side only", () => {
    const view = liquidityFormView({ ...base, mode: "market", tokenText: "5" });
    expect(view.ready).toBe(true);
    expect(view.pairAmount).toBe(0);
    expect(view.summary).toBeNull();
  });

  it("disables the side spot has no room for and explains it", () => {
    const view = liquidityFormView({
      ...base,
      mode: "market",
      price: REFERENCE.issuance * 1.1,
      tokenText: "5",
      pairText: "1",
    });
    expect(view.disabled).toEqual({ token: true, pair: false });
    expect(view.tokenAmount).toBe(0);
    expect(view.ready).toBe(true);
    expect(view.note).toContain("at or above the ceiling");
    const tokenOnly = liquidityFormView({
      ...base,
      mode: "market",
      price: REFERENCE.issuance * 1.1,
      tokenText: "5",
    });
    expect(tokenOnly.ready).toBe(false);
    expect(tokenOnly.note).toContain("no room to sell");
  });

  it("is not available without a floor and ceiling", () => {
    const view = liquidityFormView({
      ...base,
      mode: "market",
      reference: { cashOut: null, issuance: null },
      tokenText: "5",
    });
    expect(view.ready).toBe(false);
    expect(view.note).toContain("no floor and ceiling");
  });
});

describe("describeAddLiquidityPlan", () => {
  it("leads with the amounts and demotes ticks to the detail line", () => {
    const text = describeAddLiquidityPlan({
      tokenMaximum: 101_000n * 10n ** 18n,
      pairMaximum: 11182n * 10n ** 12n, // 0.011182 ETH
      tickLower: 108200,
      tickUpper: 115200,
      tokenSymbol: "MARKEE",
      pairSymbol: "ETH",
      pairDecimals: 18,
    });
    expect(text.lead).toBe("Adds up to 101,000 MARKEE + 0.011182 ETH.");
    expect(text.detail).toContain("108200");
    expect(text.detail).toContain("115200");
    expect(text.lead.indexOf("MARKEE")).toBeGreaterThan(-1);
  });
});
