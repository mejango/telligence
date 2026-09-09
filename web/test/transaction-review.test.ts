import type { ChainPayment } from "@/lib/nana/types";
import {
  buildTransactionReviewPrompt,
  chooseRelayrPayment,
  registerTransactionReviewHandler,
  requireContractTransactionReview,
  requireTransactionReview,
  transactionReviewJson,
  type ContractTransactionReviewCall,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_ACCOUNT, TEST_BENEFICIARY } from "./fixtures/revnet";

const TOKEN: Address = "0x0000000000000000000000000000000000001000";
const VALUE = 123n;

function transferCall(): ContractTransactionReviewCall {
  return {
    chainId: 1,
    address: TOKEN,
    abi: erc20Abi,
    functionName: "transfer",
    args: [TEST_BENEFICIARY, VALUE],
    account: TEST_ACCOUNT,
  };
}

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe("transaction review fail-closed boundary", () => {
  it("refuses a transaction when no review surface is registered", async () => {
    await expect(requireContractTransactionReview(transferCall())).rejects.toThrow(
      "Transaction review is unavailable",
    );
  });

  it("refuses an empty review and a review the user closes", async () => {
    unregister = registerTransactionReviewHandler(async () => false);

    await expect(requireTransactionReview({ calls: [] })).rejects.toThrow(
      "There is no transaction to review",
    );
    await expect(requireContractTransactionReview(transferCall())).rejects.toThrow(
      "Review closed. Nothing was sent.",
    );
  });

  it("shows the exact chain, target, sender, value, selector, and arguments", async () => {
    let reviewed: TransactionReviewRequest | undefined;
    unregister = registerTransactionReviewHandler(async (request) => {
      reviewed = request;
      return true;
    });

    await requireContractTransactionReview(transferCall(), {
      title: "Review transfer",
      label: "Transfer project token",
      contractName: "ERC20",
    });

    const expectedData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [TEST_BENEFICIARY, VALUE],
    });
    expect(expectedData.slice(0, 10)).toBe("0xa9059cbb");
    expect(reviewed).toMatchObject({ title: "Review transfer" });
    expect(reviewed?.calls).toEqual([
      expect.objectContaining({
        chainId: 1,
        to: TOKEN,
        from: TEST_ACCOUNT,
        value: undefined,
        data: expectedData,
        functionName: "transfer",
        args: [TEST_BENEFICIARY, VALUE],
        label: "Transfer project token",
        contractName: "ERC20",
      }),
    ]);
  });

  it("serializes the exact zero Safe transaction gas envelope", async () => {
    let reviewed: TransactionReviewRequest | undefined;
    unregister = registerTransactionReviewHandler(async (request) => {
      reviewed = request;
      return true;
    });
    const call = { ...transferCall(), safeTxGas: 0n };

    await requireContractTransactionReview(call);

    expect(reviewed?.calls[0].safeTxGas).toBe(0n);
    expect(JSON.parse(transactionReviewJson(reviewed!)).safeTxGas).toBe("0x0");
  });

  it("detects any calldata mutation which occurs while the review is open", async () => {
    const call = transferCall();
    unregister = registerTransactionReviewHandler(async () => {
      call.args = [TEST_BENEFICIARY, VALUE + 1n];
      return true;
    });

    await expect(requireContractTransactionReview(call)).rejects.toThrow(
      "Transaction data changed after review",
    );
  });
});

describe("Relayr funding selection", () => {
  const payment: ChainPayment = {
    chain: 8453,
    amount: "0x1",
    calldata: "0x12345678",
    payment_deadline: "2030-01-01T00:00:00Z",
    target: TOKEN,
    token: "0x0000000000000000000000000000000000000000",
  };

  it("rejects an empty quote before opening a review", async () => {
    await expect(chooseRelayrPayment([])).rejects.toThrow(
      "Relayr did not return a payment option.",
    );
  });

  it("requires an available review surface even for one preferred payment", async () => {
    await expect(chooseRelayrPayment([payment], payment.chain)).rejects.toThrow(
      "Transaction review is unavailable",
    );
  });

  it("does not use the preferred chain or first quote without a selection", async () => {
    unregister = registerTransactionReviewHandler(async () => true);

    await expect(chooseRelayrPayment([payment], payment.chain)).rejects.toThrow(
      "Choose a quoted Relayr payment before continuing.",
    );
  });

  it("returns the quoted option chosen by the user on another chain", async () => {
    const alternate = { ...payment, chain: 10 } as const;
    unregister = registerTransactionReviewHandler(async (request) => {
      expect(request.calls).toEqual([]);
      expect(request.relayrPaymentSelection?.preferredChainId).toBe(payment.chain);
      request.relayrPaymentSelection?.select(alternate);
      return true;
    });

    await expect(chooseRelayrPayment([payment, alternate], payment.chain)).resolves.toBe(alternate);
  });

  it("rejects an option outside the quote", async () => {
    unregister = registerTransactionReviewHandler(async (request) => {
      request.relayrPaymentSelection?.select({ ...payment, amount: "0x2" });
      return true;
    });

    await expect(chooseRelayrPayment([payment])).rejects.toThrow(
      "Choose a quoted Relayr payment before continuing.",
    );
  });

  it("rejects cancellation even after choosing a payment", async () => {
    unregister = registerTransactionReviewHandler(async (request) => {
      request.relayrPaymentSelection?.select(payment);
      return false;
    });

    await expect(chooseRelayrPayment([payment])).rejects.toThrow(
      "Review closed. Nothing was sent.",
    );
  });
});

describe("portable transaction review payload", () => {
  const data = "0xa9059cbb00000000" as Hex;
  const request: TransactionReviewRequest = {
    kind: "authorization",
    authorization: { deadline: 123n },
    calls: [
      {
        chainId: 1,
        from: TEST_ACCOUNT,
        to: TOKEN,
        value: 15n,
        data,
      },
    ],
  };

  it("serializes bigints and a single resulting call without losing precision", () => {
    expect(JSON.parse(transactionReviewJson(request))).toEqual({
      authorization: { deadline: "123" },
      resultingCall: {
        chainId: 1,
        from: TEST_ACCOUNT,
        to: TOKEN,
        value: "0xf",
        data,
      },
    });
  });

  it("builds an audit prompt containing the exact payload and canonical source guidance", () => {
    const prompt = buildTransactionReviewPrompt(request);

    expect(prompt).toContain(transactionReviewJson(request));
    expect(prompt).toContain("https://github.com/Bananapus/version-6");
    expect(prompt).toContain(`https://etherscan.io/address/${TOKEN}`);
    expect(prompt).toContain("SAFE TO SIGN / DO NOT SIGN / NEEDS MORE INFO");
  });

  it("wraps multiple calls without changing their order", () => {
    const json = JSON.parse(
      transactionReviewJson({ calls: [request.calls[0], { ...request.calls[0], chainId: 10 }] }),
    );

    expect(json.transactions.map((call: { chainId: number }) => call.chainId)).toEqual([1, 10]);
  });
});

import { buildTransactionDebugPrompt as buildDebugPrompt } from "@/lib/transaction-review";

describe("buildTransactionDebugPrompt", () => {
  it("links each tx on its own explorer and points at the Etherscan debugger skill", () => {
    const prompt = buildDebugPrompt([
      { chainId: 1, txHash: "0xabc" },
      { chainId: 8453, txHash: "0xdef" },
    ]);
    expect(prompt).toContain("https://etherscan.io/tx/0xabc");
    expect(prompt).toContain("https://basescan.org/tx/0xdef");
    expect(prompt).toContain("etherscan-transaction-debugger");
    expect(prompt).toContain("Bananapus/version-6");
  });
});
