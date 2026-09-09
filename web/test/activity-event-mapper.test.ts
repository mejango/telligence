import { combinedDescription } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import {
  groupSameTxEvents,
  isProjectFeedActivityEvent,
  mapActivityEvents,
  projectFeedTokenContext,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { formatUsd } from "@/app/[slug]/components/v6/extras/projectPayers";
import { exactNumber, formatCompact } from "@/lib/number";
import { describe, expect, it } from "vitest";

const EMPTY_EVENTS = {
  payEvent: null,
  cashOutTokensEvent: null,
  addToBalanceEvent: null,
  mintTokensEvent: null,
  manualMintTokensEvent: null,
  autoIssueEvent: null,
  deployErc20Event: null,
  projectCreateEvent: null,
  projectTransferEvent: null,
  operatorPermissionsSetEvent: null,
  rulesetQueuedEvent: null,
  swapEvent: null,
  buybackPoolEvent: null,
};

function payItem(overrides: Partial<ActivityEventItem> = {}): ActivityEventItem {
  return {
    id: "pay-1",
    chainId: 1,
    timestamp: 1_700_000_000,
    txHash: "0xaaa",
    ...EMPTY_EVENTS,
    payEvent: {
      id: "pay-event-1",
      amount: "2000000",
      beneficiary: "0x1111111111111111111111111111111111111111",
      memo: "gm",
      timestamp: 1_700_000_000,
      feeFromProject: null,
      newlyIssuedTokenCount: "3000000000000000000",
      from: "0x2222222222222222222222222222222222222222",
      txHash: "0xaaa",
      amountUsd: "0",
      caller: "0x2222222222222222222222222222222222222222",
      distributionFromProjectId: null,
      projectId: 3,
      project: null,
    },
    ...overrides,
  };
}

describe("mapActivityEvents", () => {
  it("keeps holder permission grants out of project feeds", () => {
    expect(isProjectFeedActivityEvent(payItem())).toBe(true);
    expect(
      isProjectFeedActivityEvent({
        ...payItem(),
        payEvent: null,
        operatorPermissionsSetEvent: {},
      } as ActivityEventItem),
    ).toBe(false);
  });

  it("denominates amounts with the context's symbol and decimals", () => {
    const events = mapActivityEvents([payItem()], () => ({ tokenSymbol: "USDC", decimals: 6 }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "in",
      chainId: 1,
      txHash: "0xaaa",
      baseAmount: "2",
      baseTokenSymbol: "USDC",
      tokenCount: "3",
      memo: "gm",
    });
  });

  it("skips rows when the context resolver returns null (project-feed behavior)", () => {
    expect(mapActivityEvents([payItem()], () => null)).toHaveLength(0);
  });

  it("keeps rows and omits the symbol when the context has none (account-feed behavior)", () => {
    const events = mapActivityEvents([payItem()], () => ({ tokenSymbol: null, decimals: null }));

    expect(events).toHaveLength(1);
    expect(events[0].baseTokenSymbol).toBeUndefined();
    // Unknown decimals means the raw amount CANNOT be scaled — assuming 18 would be off by
    // 1e12 on a 6-decimal token. The row stays (the activity happened) but carries no
    // amount, rather than showing an invented magnitude.
    expect(events[0].baseAmount).toBeUndefined();
  });

  it("still shows USD when the accounting context is unknown but the indexer priced it", () => {
    // The honest denomination for a chain whose accounting context isn't known: the USD
    // figure is scale-independent, so it survives where a token amount cannot.
    const priced = payItem();
    priced.payEvent = { ...priced.payEvent!, amountUsd: "1000000000000000000" };
    const events = mapActivityEvents([priced], () => ({
      tokenSymbol: null,
      decimals: null,
      denominateInUsd: true,
    }));

    expect(events).toHaveLength(1);
    expect(events[0].baseAmount).toBe("$1.00");
    // No decimals ⇒ no raw accounting amount to reveal on hover.
    expect(events[0].exactAmount).toBeUndefined();
  });

  it("suppresses mintTokensEvent rows already covered by a pay in the same tx", () => {
    const mint: ActivityEventItem = {
      id: "mint-1",
      chainId: 1,
      timestamp: 1_700_000_001,
      txHash: "0xaaa",
      ...EMPTY_EVENTS,
      mintTokensEvent: {
        id: "mint-event-1",
        txHash: "0xaaa",
        timestamp: 1_700_000_001,
        from: "0x2222222222222222222222222222222222222222",
        caller: "0x2222222222222222222222222222222222222222",
        beneficiary: "0x1111111111111111111111111111111111111111",
        beneficiaryTokenCount: "1000000000000000000",
        memo: null,
      },
    };
    const standaloneMint: ActivityEventItem = {
      ...mint,
      id: "mint-2",
      txHash: "0xbbb",
      mintTokensEvent: { ...mint.mintTokensEvent!, txHash: "0xbbb" },
    };

    const events = mapActivityEvents([payItem(), mint, standaloneMint], () => ({
      tokenSymbol: "ETH",
      decimals: 18,
    }));

    expect(events.map((event) => event.id)).toEqual(["pay-1", "mint-2"]);
  });

  it("includes a buyback swap and attributes it to the payer, not PoolManager", () => {
    const swap: ActivityEventItem = {
      id: "swap-1",
      chainId: 8453,
      timestamp: 1_785_598_771,
      txHash: "0xf20d5fb96401564562feca7e95f4eb055a1a3377b915dfc4b9bac6376c7a3ffb",
      ...EMPTY_EVENTS,
      swapEvent: {
        txHash: "0xf20d5fb96401564562feca7e95f4eb055a1a3377b915dfc4b9bac6376c7a3ffb",
        timestamp: 1_785_598_771,
        direction: "buy",
        terminalTokenAmount: "50000000",
        projectTokenAmount: "468829854500197524612724",
        caller: "0x498581ff718922c3f8e6a244956af099b2652b2b",
        from: "0x823b92d6a4b2aed4b15675c7917c9f922ea8adad",
      },
    };

    expect(mapActivityEvents([swap], () => ({ tokenSymbol: "USDC", decimals: 6 }))).toEqual([
      expect.objectContaining({
        id: "swap-1",
        type: "swapBuy",
        beneficiary: "0x823b92d6a4b2aed4b15675c7917c9f922ea8adad",
        baseAmount: "50",
        baseTokenSymbol: "USDC",
        tokenCount: "469k",
      }),
    ]);
  });

  it("keeps the buyback remint row when the pay itself issued nothing, tagged with the reserve", () => {
    const buybackPay = payItem({
      payEvent: { ...payItem().payEvent!, newlyIssuedTokenCount: "0" },
    });
    const swap: ActivityEventItem = {
      ...payItem({ payEvent: null }),
      id: "swap-1",
      swapEvent: {
        txHash: "0xaaa",
        timestamp: 1_700_000_000,
        direction: "buy",
        terminalTokenAmount: "20000000",
        projectTokenAmount: "28406000000000000000000",
        caller: "0x498581ff718922c3f8e6a244956af099b2652b2b",
        from: "0x823b92d6a4b2aed4b15675c7917c9f922ea8adad",
      },
    };
    const remint: ActivityEventItem = {
      ...payItem({ payEvent: null }),
      id: "mint-1",
      mintTokensEvent: {
        id: "mint-event-1",
        txHash: "0xaaa",
        timestamp: 1_700_000_000,
        from: "0x2222222222222222222222222222222222222222",
        caller: "0x2222222222222222222222222222222222222222",
        beneficiary: "0x1111111111111111111111111111111111111111",
        beneficiaryTokenCount: "17043000000000000000000",
        memo: null,
      },
    };

    const events = mapActivityEvents([buybackPay, swap, remint], () => ({
      tokenSymbol: "USDC",
      decimals: 6,
    }));

    expect(events.map((event) => event.id)).toEqual(["pay-1", "swap-1", "mint-1"]);
    expect(events[2].detail).toBe("after the 40% split");

    // The remint can also arrive indexed as a manual mint (a direct
    // mintTokensOf call) — same reserve tagging applies.
    const manualRemint: ActivityEventItem = {
      ...payItem({ payEvent: null }),
      id: "manual-1",
      manualMintTokensEvent: remint.mintTokensEvent,
    };
    const manualEvents = mapActivityEvents([buybackPay, swap, manualRemint], () => ({
      tokenSymbol: "USDC",
      decimals: 6,
    }));
    const manualRow = manualEvents.find((event) => event.id === "manual-1");
    expect(manualRow?.detail).toBe("after the 40% split");
    expect(manualRow?.tokenCount).toBe("17k");
  });

  it("pairs each remint with its own swap when one tx holds two buyback pays", () => {
    const swapOf = (id: string, projectTokenAmount: string): ActivityEventItem => ({
      ...payItem({ payEvent: null }),
      id,
      swapEvent: {
        txHash: "0xaaa",
        timestamp: 1_700_000_000,
        direction: "buy",
        terminalTokenAmount: "1",
        projectTokenAmount,
        caller: "0x498581ff718922c3f8e6a244956af099b2652b2b",
        from: "0x823b92d6a4b2aed4b15675c7917c9f922ea8adad",
      },
    });
    const mintOf = (id: string, beneficiaryTokenCount: string): ActivityEventItem => ({
      ...payItem({ payEvent: null }),
      id,
      mintTokensEvent: {
        id: `${id}-event`,
        txHash: "0xaaa",
        timestamp: 1_700_000_000,
        from: "0x2222222222222222222222222222222222222222",
        caller: "0x2222222222222222222222222222222222222222",
        beneficiary: "0x1111111111111111111111111111111111111111",
        beneficiaryTokenCount,
        memo: null,
      },
    });

    // 100 → 62 and 200 → 124 are both a 38% reserve; pairing every mint with
    // the last swap read the first one as 69%.
    const events = mapActivityEvents(
      [
        swapOf("swap-1", "100000000000000000000"),
        mintOf("mint-1", "62000000000000000000"),
        swapOf("swap-2", "200000000000000000000"),
        mintOf("mint-2", "124000000000000000000"),
      ],
      () => ({ tokenSymbol: "ETH", decimals: 18 }),
    );

    expect(events.find((event) => event.id === "mint-1")?.detail).toBe("after the 38% split");
    expect(events.find((event) => event.id === "mint-2")?.detail).toBe("after the 38% split");

    // The indexer returns a tx's events in no particular order: pairing goes
    // by amount rank, so a shuffled tx labels every remint the same way.
    const shuffled = mapActivityEvents(
      [
        mintOf("mint-1", "62000000000000000000"),
        swapOf("swap-2", "200000000000000000000"),
        mintOf("mint-2", "124000000000000000000"),
        swapOf("swap-1", "100000000000000000000"),
      ],
      () => ({ tokenSymbol: "ETH", decimals: 18 }),
    );
    expect(shuffled.find((event) => event.id === "mint-1")?.detail).toBe("after the 38% split");
    expect(shuffled.find((event) => event.id === "mint-2")?.detail).toBe("after the 38% split");
  });

  it("reads a fan-out (two pays in one tx) as the payer's total and who got what", () => {
    const payer = "0x2222222222222222222222222222222222222222";
    const other = "0x3333333333333333333333333333333333333333";
    const payOf = (id: string, beneficiary: string, amount: string): ActivityEventItem =>
      payItem({
        id,
        payEvent: {
          ...payItem().payEvent!,
          beneficiary,
          amount,
          from: payer,
          newlyIssuedTokenCount: "0",
        },
      });
    const swapOf = (id: string, projectTokenAmount: string): ActivityEventItem => ({
      ...payItem({ payEvent: null }),
      id,
      swapEvent: {
        txHash: "0xaaa",
        timestamp: 1_700_000_000,
        direction: "buy",
        terminalTokenAmount: "1",
        projectTokenAmount,
        caller: payer,
        from: payer,
      },
    });
    const mintOf = (
      id: string,
      beneficiary: string,
      beneficiaryTokenCount: string,
    ): ActivityEventItem => ({
      ...payItem({ payEvent: null }),
      id,
      mintTokensEvent: {
        id: `${id}-event`,
        txHash: "0xaaa",
        timestamp: 1_700_000_000,
        from: payer,
        caller: payer,
        beneficiary,
        beneficiaryTokenCount,
        memo: null,
      },
    });

    const [row] = groupSameTxEvents(
      mapActivityEvents(
        [
          payOf("pay-1", other, "4000000000000000"),
          swapOf("swap-1", "100000000000000000000"),
          mintOf("mint-1", other, "62000000000000000000"),
          payOf("pay-2", payer, "6000000000000000"),
          swapOf("swap-2", "200000000000000000000"),
          mintOf("mint-2", payer, "124000000000000000000"),
        ],
        () => ({ tokenSymbol: "ETH", decimals: 18 }),
      ),
    );

    // The row is the payment: the payer and the total, not the first payee and its share.
    expect(row.beneficiary).toBe(payer);
    expect(row.baseAmount).toBe("0.01");
    expect(combinedDescription(row, "ART")).toBe(
      "0x3333…3333 got 62 ART after the 38% split and 0x2222…2222 got 124 ART after the 38% split",
    );
  });
});

// A reserved distribution: the total plus one receipt per split, all in one
// tx. The row leads with the total and lists the recipients, largest first.
describe("reserved distributions", () => {
  const distribution: ActivityEventItem = {
    ...payItem({ payEvent: null }),
    id: "reserved-1",
    txHash: "0xreserved",
    sendReservedTokensToSplitsEvent: {
      txHash: "0xreserved",
      timestamp: 1_700_000_000,
      from: "0x2222222222222222222222222222222222222222",
      tokenCount: "3600000000000000000000000",
    },
  };
  const toAddress: ActivityEventItem = {
    ...payItem({ payEvent: null }),
    id: "split-1",
    txHash: "0xreserved",
    sendReservedTokensToSplitEvent: {
      id: "split-event-1",
      txHash: "0xreserved",
      timestamp: 1_700_000_000,
      from: "0x2222222222222222222222222222222222222222",
      tokenCount: "600000000000000000000000",
      beneficiary: "0x3333333333333333333333333333333333333333",
      splitProjectId: 0,
    },
  };
  const toProject: ActivityEventItem = {
    ...payItem({ payEvent: null }),
    id: "split-2",
    txHash: "0xreserved",
    sendReservedTokensToSplitEvent: {
      id: "split-event-2",
      txHash: "0xreserved",
      timestamp: 1_700_000_000,
      from: "0x2222222222222222222222222222222222222222",
      tokenCount: "3000000000000000000000000",
      beneficiary: "0x0000000000000000000000000000000000000000",
      splitProjectId: 7,
    },
  };
  const context = () => ({ tokenSymbol: "ETH", decimals: 18 });

  it("folds into one row: the total as headline, a fragment per recipient", () => {
    const rows = groupSameTxEvents(
      mapActivityEvents([toAddress, distribution, toProject], context),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "reserved",
      tokenCount: "3.6M",
      beneficiary: "0x2222222222222222222222222222222222222222",
    });
    expect(rows[0].also?.map((entry) => entry.id)).toEqual(["split-2", "split-1"]);
    expect(combinedDescription(rows[0], "ART")).toBe(
      "3M ART to project #7 and 600k ART to 0x3333…3333",
    );
  });

  it('keeps a receipt without its distribution as a "received" line', () => {
    const [row] = mapActivityEvents([toAddress], context);
    expect(row.type).toBe("reservedSplit");
    expect(combinedDescription(row, "ART")).toBe("received 600k ART from a reserved split");
  });
});

describe("projectFeedTokenContext", () => {
  const payOnChain = (chainId: number, amountUsd: string) =>
    payItem({
      chainId,
      payEvent: { ...payItem().payEvent!, amountUsd },
    });

  it("keeps token denomination when every chain shares one accounting token kind", () => {
    const projects = [
      { chainId: 1, tokenSymbol: "ETH", decimals: 18 },
      { chainId: 8453, tokenSymbol: "ETH", decimals: 18 },
    ];

    const events = mapActivityEvents(
      [payOnChain(1, "5250000000000000000")],
      projectFeedTokenContext(projects),
    );

    expect(events).toHaveLength(1);
    expect(events[0].baseTokenSymbol).toBe("ETH");
    expect(events[0].baseAmount).not.toContain("$");
  });

  it("denominates flow amounts in indexed USD when chains disagree on the accounting token", () => {
    const projects = [
      { chainId: 1, tokenSymbol: "ETH", decimals: 18 },
      { chainId: 8453, tokenSymbol: "USDC", decimals: 6 },
    ];

    // 18-decimal fixed-point USD: $5.25
    const events = mapActivityEvents(
      [payOnChain(1, "5250000000000000000")],
      projectFeedTokenContext(projects),
    );

    expect(events).toHaveLength(1);
    expect(events[0].baseAmount).toBe("$5.25");
    expect(events[0].baseTokenSymbol).toBeUndefined();
  });

  it("falls back to the chain's token when the indexed USD amount is unavailable", () => {
    const projects = [
      { chainId: 1, tokenSymbol: "ETH", decimals: 18 },
      { chainId: 8453, tokenSymbol: "USDC", decimals: 6 },
    ];

    const events = mapActivityEvents([payOnChain(1, "0")], projectFeedTokenContext(projects));

    expect(events).toHaveLength(1);
    expect(events[0].baseTokenSymbol).toBe("ETH");
  });

  it("uses reclaimAmountUsd for cash outs in USD mode", () => {
    const projects = [
      { chainId: 1, tokenSymbol: "ETH", decimals: 18 },
      { chainId: 8453, tokenSymbol: "USDC", decimals: 6 },
    ];
    const cashOut: ActivityEventItem = {
      id: "cashout-1",
      chainId: 1,
      timestamp: 1_700_000_002,
      txHash: "0xccc",
      ...EMPTY_EVENTS,
      cashOutTokensEvent: {
        id: "cashout-event-1",
        timestamp: 1_700_000_002,
        txHash: "0xccc",
        from: "0x2222222222222222222222222222222222222222",
        beneficiary: "0x1111111111111111111111111111111111111111",
        reclaimAmount: "1000000000000000000",
        reclaimAmountUsd: "250500000000000000000",
        cashOutCount: "1000000000000000000",
        metadata: "0x",
        project: null,
      },
    };

    const events = mapActivityEvents([cashOut], projectFeedTokenContext(projects));

    expect(events).toHaveLength(1);
    // Cents matter up to $1,000 now — at $250.50 they still carry meaning.
    expect(events[0].baseAmount).toBe("$250.50");
    expect(events[0].baseTokenSymbol).toBeUndefined();
  });
});

// NUMBER PRESENTATION POLICY (lib/number.ts): abbreviate to three significant figures in
// dense lists, never 0-decimal, and always keep the exact value one hover away.
describe("formatCompact / exactNumber", () => {
  it("keeps three significant figures across the ladder", () => {
    expect(formatCompact(1_234_567_890)).toBe("1.23B");
    expect(formatCompact(12_345_678)).toBe("12.3M");
    expect(formatCompact(123_456)).toBe("123k");
    expect(formatCompact(1_234)).toBe("1.23k");
  });

  it("never collapses an order of magnitude the way a 0-decimal ladder does", () => {
    // The old formatter rendered both of these "12k".
    expect(formatCompact(12_300)).not.toBe(formatCompact(12_900));
  });

  it("shows a tiny amount's first significant figure instead of rounding it to 0", () => {
    expect(formatCompact(0.000004586733)).toBe("0.000005");
    expect(formatCompact(0.00004)).toBe("0.00004");
    expect(formatCompact(0.0000099)).toBe("0.00001");
    expect(formatCompact(0)).toBe("0");
  });

  it("leaves sub-thousand values unsuffixed and trims trailing zeros", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1.5)).toBe("1.5");
    expect(formatCompact(0)).toBe("0");
  });

  it("handles negatives symmetrically", () => {
    expect(formatCompact(-12_345)).toBe("-12.3k");
  });

  it("exactNumber reveals the grouped, unabbreviated value for the hover", () => {
    expect(exactNumber(1_234_567.25)).toBe("1,234,567.25");
    expect(exactNumber(0.5)).toBe("0.5");
  });
});

describe("formatUsd", () => {
  it("keeps cents below $1,000 and drops them above", () => {
    expect(formatUsd(340.5)).toBe("$340.50");
    expect(formatUsd(12_345.67)).toBe("$12,346");
  });

  it("floors a real sub-cent amount instead of rendering $0.00", () => {
    // "$0.00" reads as "nothing happened" for a payment that did happen.
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
