import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRulesets: vi.fn(),
  getV4AmmPriceHistory: vi.fn(),
}));
vi.mock("@/app/[slug]/terms/getRulesets", () => ({ getRulesets: mocks.getRulesets }));
vi.mock("@/app/[slug]/components/TokenPrice/getV4AmmPriceHistory", () => ({
  getV4AmmPriceHistory: mocks.getV4AmmPriceHistory,
}));
vi.mock("@/app/[slug]/components/TokenPrice/getFloorPriceHistory", () => ({
  getFloorPriceHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/token", () => ({ getTokenAddress: vi.fn() }));
vi.mock("@/lib/cashOutTax", () => ({ getCurrentCashOutTax: vi.fn() }));
vi.mock("@/lib/baseCurrencyRate", () => ({
  accountingIsAxisUnit: () => true,
  baseIsUsd: () => false,
  fetchLiveBasePerAccountingToken: vi.fn(),
  fetchPayEventRates: vi.fn(),
  rateAt: () => null,
  toBaseAxis: () => undefined,
}));

import { getTokenPriceChartData } from "@/app/[slug]/components/TokenPrice/getTokenPriceChartData";
import { getMarketPriceHistory } from "@/app/[slug]/components/v6/owners/market/getMarketPriceHistory";
import type { JBChainId } from "@bananapus/nana-sdk-core";

const valid = {
  projectId: "42",
  chainId: 8453 as JBChainId,
  range: "7d" as const,
  suckerGroupId: "group-1",
  baseToken: { address: "0x000000000000000000000000000000000000EEEe", symbol: "ETH", decimals: 18 },
};
const pool = {
  projectId: "42",
  chainId: 8453 as JBChainId,
  poolId: `0x${"ab".repeat(32)}`,
  pairDecimals: 18,
};

beforeEach(() => {
  mocks.getRulesets.mockResolvedValue([]);
  mocks.getV4AmmPriceHistory.mockResolvedValue({ data: [], hasPool: false, reserves: [] });
});

describe("chart server action guards", () => {
  it.each([
    { projectId: "0" },
    { projectId: "-1" },
    { projectId: "1e3" },
    { projectId: "1".repeat(80) },
    { chainId: 1337 },
    { chainId: "8453" },
    { range: "2y" },
    { range: "" },
    { suckerGroupId: 1 },
    { suckerGroupId: "x".repeat(201) },
    { baseToken: { address: "0x1234", symbol: "ETH", decimals: 18 } },
    { baseToken: { address: valid.baseToken.address, symbol: "ETH", decimals: 1.5 } },
    { baseToken: { address: valid.baseToken.address, symbol: "ETH", decimals: 100 } },
  ])("returns null for invalid chart input %j without any upstream read", async (patch) => {
    expect(await getTokenPriceChartData({ ...valid, ...(patch as object) })).toBeNull();
    expect(mocks.getRulesets).not.toHaveBeenCalled();
  });

  it.each([
    { projectId: "0" },
    { chainId: 1337 },
    { poolId: "0x1234" },
    { poolId: `0x${"ab".repeat(32)}z` },
    { pairDecimals: -1 },
    { pairDecimals: NaN },
  ])("returns no market history for invalid input %j", async (patch) => {
    expect(await getMarketPriceHistory({ ...pool, ...(patch as object) })).toEqual([]);
    expect(mocks.getV4AmmPriceHistory).not.toHaveBeenCalled();
  });

  it("still reads valid market history", async () => {
    mocks.getV4AmmPriceHistory.mockResolvedValue({
      data: [{ timestamp: 1, ammPrice: 2 }],
      hasPool: true,
      reserves: [],
    });
    expect(await getMarketPriceHistory(pool)).toEqual([{ timestamp: 1, price: 2 }]);
  });
});
