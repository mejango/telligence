import type { ChainPayment } from "@/lib/nana/types";
import {
  buildTransactionDebugPrompt,
  buildTransactionReviewPrompt,
  chooseRelayrPayment,
  preselectedRelayrPayment,
  registerFundingChainSelectionHandler,
  relayrPaymentOptions,
  TransactionReviewCancelledError,
  transactionReviewJson,
  type FundingChainOption,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { type Address, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_ACCOUNT } from "./fixtures/revnet";

const TOKEN: Address = "0x0000000000000000000000000000000000001000";

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe("review prompts use revnet's chain display", () => {
  const request: TransactionReviewRequest = {
    kind: "authorization",
    authorization: { deadline: 123n },
    calls: [
      {
        chainId: 1,
        from: TEST_ACCOUNT,
        to: TOKEN,
        value: 15n,
        data: "0xa9059cbb00000000" as Hex,
      },
    ],
  };

  it("links each target on revnet's explorer and keeps the exact payload", () => {
    const prompt = buildTransactionReviewPrompt(request);

    expect(prompt).toContain(transactionReviewJson(request));
    expect(prompt).toContain(`https://etherscan.io/address/${TOKEN}`);
    expect(prompt).toContain("https://github.com/Bananapus/version-6");
    expect(prompt).toContain("SAFE TO SIGN / DO NOT SIGN / NEEDS MORE INFO");
  });

  it("names chains the way the site does and falls back to the hash without an explorer", () => {
    const prompt = buildTransactionDebugPrompt([
      { chainId: 10, txHash: "0xabc" },
      { chainId: 8453, txHash: "0xdef" },
      { chainId: 999, txHash: "0x123" },
    ]);

    expect(prompt).toContain("- Optimism (chain 10): https://optimistic.etherscan.io/tx/0xabc");
    expect(prompt).toContain("- Base (chain 8453): https://basescan.org/tx/0xdef");
    expect(prompt).toContain("- Chain 999 (chain 999): 0x123");
    expect(prompt).toContain("etherscan-transaction-debugger");
  });
});

describe("Relayr funding selection", () => {
  const payment = (chain: ChainPayment["chain"], amount: bigint): ChainPayment => ({
    chain,
    amount: `0x${amount.toString(16)}`,
    calldata: "0x12345678",
    payment_deadline: "2030-01-01T00:00:00Z",
    target: TOKEN,
    token: "0x0000000000000000000000000000000000000000",
  });
  const base = payment(8453, 10n ** 18n);
  const optimism = payment(10, 123_456_789_012_345n);

  function answer(chainId: number | null) {
    const asked: { options: readonly FundingChainOption[]; initialChainId: number | null }[] = [];
    unregister = registerFundingChainSelectionHandler(async (options, initialChainId) => {
      asked.push({ options, initialChainId });
      return chainId;
    });
    return asked;
  }

  it("labels one option per quoted chain with its fee, keeping the first quote", () => {
    expect(relayrPaymentOptions([base, optimism, payment(8453, 5n)])).toEqual([
      { chainId: 8453, label: "Base (1 ETH)" },
      { chainId: 10, label: "Optimism (~0.000123 ETH)" },
    ]);
  });

  it("rejects an empty quote before asking", async () => {
    const asked = answer(8453);

    await expect(chooseRelayrPayment([])).rejects.toThrow("No payment option is available.");
    expect(asked).toEqual([]);
  });

  it("requires the funding chain picker even for one preferred payment", async () => {
    await expect(chooseRelayrPayment([base], base.chain)).rejects.toThrow(
      "Funding chain selection is unavailable",
    );
  });

  it("preselects the preferred chain and returns the first payment on the chosen one", async () => {
    const asked = answer(10);
    const later = payment(10, 7n);

    await expect(chooseRelayrPayment([base, optimism, later], 8453)).resolves.toBe(optimism);
    expect(asked).toEqual([
      {
        options: [
          { chainId: 8453, label: "Base (1 ETH)" },
          { chainId: 10, label: "Optimism (~0.000123 ETH)" },
        ],
        initialChainId: 8453,
      },
    ]);
  });

  it("preselects a lone quote and nothing when several quotes miss the preferred chain", async () => {
    const asked = answer(8453);

    await chooseRelayrPayment([base], 42161);
    await chooseRelayrPayment([base, optimism], 42161);
    await chooseRelayrPayment([base, optimism]);

    expect(asked.map((question) => question.initialChainId)).toEqual([8453, null, null]);
  });

  it("treats a closed picker as a cancelled review", async () => {
    answer(null);

    await expect(chooseRelayrPayment([base, optimism], 8453)).rejects.toBeInstanceOf(
      TransactionReviewCancelledError,
    );
  });

  it("preselects inline the same way the picker does", () => {
    expect(preselectedRelayrPayment([base, optimism], 10)).toBe(optimism);
    expect(preselectedRelayrPayment([base, payment(8453, 1n)], 42161)).toBe(base);
    expect(preselectedRelayrPayment([base, optimism], 42161)).toBeNull();
    expect(preselectedRelayrPayment([base, optimism])).toBeNull();
    expect(preselectedRelayrPayment([])).toBeNull();
  });
});
