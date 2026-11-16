import { readLoanSource } from "@/lib/loanTransactions";
import { getRevnetLoanContract } from "@bananapus/nana-sdk-core";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";

// REVLoans prices a loan in its TERMINAL's accounting context for the source token
// (`accountingContextForTokenOf(revnetId, token)`), and an existing loan fixes both its
// revnet (`revnetIdOfLoanWith`) and its token (`loanOf(...).sourceToken`). The indexer's
// token, decimals and currency are never trusted for that.

const TERMINAL = "0x5555555555555555555555555555555555555555";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH = "0x000000000000000000000000000000000000EEEe";
const LOANS = getRevnetLoanContract(6, 8453);

type Call = { address: string; functionName: string; args?: readonly unknown[] };

function client(answers: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      readContract: async (call: Call) => {
        calls.push(call);
        const answer = answers[call.functionName];
        if (!answer) throw new Error(`unexpected read ${call.functionName}`);
        return answer(call);
      },
    } as unknown as PublicClient,
  };
}

const usdcContext = { token: USDC, decimals: 6, currency: 909516616 };
const ethContext = { token: ETH, decimals: 18, currency: 61166 };

describe("readLoanSource", () => {
  it("prices a new loan in the terminal's context for the preferred token", async () => {
    const { client: c, calls } = client({
      TERMINAL: () => TERMINAL,
      accountingContextsOf: () => [ethContext, usdcContext],
      accountingContextForTokenOf: () => usdcContext,
    });
    await expect(
      readLoanSource(c, { chainId: 8453, revnetId: 3n, preferredToken: USDC }),
    ).resolves.toEqual({ revnetId: 3n, token: USDC, decimals: 6, currency: 909516616 });
    expect(calls[0]).toMatchObject({ address: LOANS, functionName: "TERMINAL" });
    expect(calls.at(-1)).toMatchObject({
      address: TERMINAL,
      functionName: "accountingContextForTokenOf",
      args: [3n, USDC],
    });
  });

  it("takes the revnet's first context when the preferred token is not one of its own", async () => {
    const { client: c } = client({
      TERMINAL: () => TERMINAL,
      accountingContextsOf: () => [ethContext],
      accountingContextForTokenOf: () => ethContext,
    });
    await expect(
      readLoanSource(c, { chainId: 8453, revnetId: 3n, preferredToken: USDC }),
    ).resolves.toMatchObject({ token: ETH, decimals: 18, currency: 61166 });
  });

  it("takes an existing loan's revnet and source token from the loans contract", async () => {
    const { client: c, calls } = client({
      TERMINAL: () => TERMINAL,
      revnetIdOfLoanWith: () => 9n,
      loanOf: () => ({ amount: 1n, collateral: 1n, sourceToken: USDC }),
      accountingContextForTokenOf: () => usdcContext,
    });
    await expect(
      readLoanSource(c, { chainId: 8453, revnetId: 7n, loanId: 9_000_000_000_001n }),
    ).resolves.toEqual({ revnetId: 9n, token: USDC, decimals: 6, currency: 909516616 });
    expect(calls.at(-1)).toMatchObject({ args: [9n, USDC] });
  });

  it("fails closed when the terminal does not account for the token", async () => {
    const { client: c } = client({
      TERMINAL: () => TERMINAL,
      revnetIdOfLoanWith: () => 9n,
      loanOf: () => ({ amount: 0n, collateral: 0n, sourceToken: USDC }),
      accountingContextForTokenOf: () => ({ token: ETH, decimals: 0, currency: 0 }),
    });
    await expect(readLoanSource(c, { chainId: 8453, revnetId: 9n, loanId: 1n })).rejects.toThrow();
  });

  it("fails closed when the revnet has no accounting context", async () => {
    const { client: c } = client({
      TERMINAL: () => TERMINAL,
      accountingContextsOf: () => [],
    });
    await expect(readLoanSource(c, { chainId: 8453, revnetId: 3n })).rejects.toThrow();
  });

  it("fails closed when a read fails, never defaulting a decimal", async () => {
    const { client: c } = client({
      TERMINAL: () => {
        throw new Error("node down");
      },
    });
    await expect(readLoanSource(c, { chainId: 8453, revnetId: 3n })).rejects.toThrow("node down");
  });
});
