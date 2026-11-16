// The market floor is what one token reclaims in the holder's hands: net of the revnet's own
// fee and the protocol fee, the number the cash out review shows. The gross overstated it.
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  taxRate: 2000,
  feeTerminal: true as boolean | "fail",
  quotes: [] as Record<string, unknown>[],
  reads: [] as string[],
}));

vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      sdk.reads.push(functionName);
      return 7n;
    },
  }),
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (original) => ({
  ...(await original<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getCurrentRuleset: async () => ({
    ruleset: { weight: 0n },
    metadata: { cashOutTaxRate: sdk.taxRate, baseCurrency: 1 },
  }),
  revnetCashOutFeeTerminalExists: async () => {
    if (sdk.feeTerminal === "fail") throw new Error("rpc down");
    return sdk.feeTerminal;
  },
  getCashOutQuote: async (_client: unknown, args: Record<string, unknown>) => {
    sdk.quotes.push(args);
    return { reclaimAmount: 10n ** 18n, reclaimAmountAfterFee: 9n * 10n ** 17n };
  },
}));

import {
  fetchAmmReferences,
  type PoolSnapshot,
} from "@/app/[slug]/components/v6/owners/market/lib";

const pool = {
  chainId: 8453 as JBChainId,
  pair: {
    addr: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
    currency: 61166,
  },
} as unknown as PoolSnapshot;
const floor = async () =>
  (await fetchAmmReferences([{ chainId: 8453 as JBChainId, projectId: 3n, hook: null, pool }]))[0]
    .reference.cashOut;

describe("the market floor", () => {
  beforeEach(() => {
    sdk.taxRate = 2000;
    sdk.feeTerminal = true;
    sdk.quotes.length = 0;
    sdk.reads.length = 0;
  });

  it("is the reclaim after both fees, not the gross", async () => {
    expect(await floor()).toBe(0.9);
    expect(sdk.quotes[0]).toMatchObject({ cashOutTaxRate: 2000n, revnetFeeApplies: true });
    expect(sdk.quotes[0].feeFreeSurplus).toBeUndefined();
    expect(sdk.reads).toEqual([]);
  });

  it("leaves the revnet fee out when REVOwner skips it, and reads the fee-free surplus at zero tax", async () => {
    sdk.feeTerminal = false;
    await floor();
    expect(sdk.quotes[0]).toMatchObject({ revnetFeeApplies: false });
    sdk.taxRate = 0;
    sdk.feeTerminal = true;
    await floor();
    expect(sdk.quotes[1]).toMatchObject({
      cashOutTaxRate: 0n,
      revnetFeeApplies: false,
      feeFreeSurplus: 7n,
    });
    expect(sdk.reads).toEqual(["feeFreeSurplusOf"]);
  });

  it("assumes the fee when the fee terminal cannot be read", async () => {
    sdk.feeTerminal = "fail";
    await floor();
    expect(sdk.quotes[0]).toMatchObject({ revnetFeeApplies: true });
  });
});
