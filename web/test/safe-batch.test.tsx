import type { ReviewModel } from "@bananapus/nana-sdk-core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  encodeFunctionData,
  parseAbi,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerReviews, loadCoreReview, stopAnswering } from "./support/core-review";

const mocks = vi.hoisted(() => ({
  config: { id: "test-config", chains: [{ id: 8453, name: "Base" }] },
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 8453 as number | undefined,
    connector: { id: "safe", name: "Safe" } as { id: string; name: string } | undefined,
  },
  sendCalls: vi.fn(),
  walletLoaded: vi.fn(),
  simulateCalls: vi.fn(),
  request: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useAccount: () => ({ address: mocks.account.address }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => mocks.account,
  getWalletClient: async () => {
    await mocks.walletLoaded();
    const { viemWallet } = await import("./support/viem-wallet");
    return viemWallet({ sendCalls: mocks.sendCalls }, () => mocks.account.chainId);
  },
  switchChain: async (_config: unknown, { chainId }: { chainId: number }) => {
    mocks.account.chainId = chainId;
  },
  getPublicClient: () => ({
    chain: { id: 8453 },
    simulateCalls: mocks.simulateCalls,
    request: mocks.request,
    getChainId: async () => 8453,
    getBlockNumber: async () => 100n,
    getTransactionCount: async () => 0,
    // The node has no receipt for a safeTxHash.
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      throw new TransactionReceiptNotFoundError({ hash });
    },
    // A safeTxHash is never a transaction, so tracking polls the Safe service.
    getTransaction: async ({ hash }: { hash: Hex }) => {
      throw new TransactionNotFoundError({ hash });
    },
  }),
}));

import { useReviewedAction } from "@/hooks/useReviewedAction";
import { reviewedCall } from "@/lib/reviewed-call";
import { transactionActivitySnapshot } from "@/lib/transaction-activity";
import { clearViewAs, setViewAs } from "@/lib/view-as";

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const TOKEN = "0x0000000000000000000000000000000000001000" as Address;
const SPENDER = "0x0000000000000000000000000000000000002000" as Address;
const SAFE_TX_HASH = `0x${"ab".repeat(32)}` as Hex;
const ERC20 = parseAbi(["function approve(address spender, uint256 amount)"]);
let nonce = 0n;
// Distinct amounts per test so the duplicate guard sees a fresh batch each time.
const calls = () => {
  nonce += 1n;
  return [
    reviewedCall({
      chainId: 8453,
      address: TOKEN,
      abi: ERC20,
      functionName: "approve",
      args: [SPENDER, nonce],
    }),
    reviewedCall({
      chainId: 8453,
      address: SPENDER,
      abi: ERC20,
      functionName: "approve",
      args: [TOKEN, nonce * 2n],
      value: 1n,
    }),
  ];
};
const encoded = (batch: ReturnType<typeof calls>) =>
  batch.map((call) => ({
    to: call.to,
    value: call.value ?? 0n,
    data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: call.args as never }),
  }));

let seen: ReviewModel | null;
let approve: boolean;

beforeEach(async () => {
  await loadCoreReview();
  stopAnswering();
  window.localStorage.clear();
  clearViewAs();
  seen = null;
  approve = true;
  mocks.account.address = ACCOUNT;
  mocks.account.chainId = 8453;
  mocks.account.connector = { id: "safe", name: "Safe" };
  mocks.sendCalls.mockReset().mockResolvedValue({ id: SAFE_TX_HASH });
  mocks.walletLoaded.mockReset();
  mocks.simulateCalls
    .mockReset()
    .mockResolvedValue({ results: [{ status: "success" }, { status: "success" }] });
  mocks.request.mockReset().mockResolvedValue("0x");
  answerReviews(async (model) => {
    seen = model;
    return approve;
  });
});

/** The Safe batch a flow runs: every call reviewed once, proposed together. */
async function proposeBatch(batch: ReturnType<typeof calls>, account: Address = ACCOUNT) {
  const { result } = renderHook(() => useReviewedAction(), { wrapper });
  let outcome!: Awaited<ReturnType<typeof result.current.run>>;
  await act(async () => {
    outcome = await result.current.run({
      account,
      title: "Make the market",
      calls: batch,
      // A batch of several calls resumes as one action.
      scope: `market-batch:${batch[0]!.args![1]}`,
      batch: true,
    });
  });
  return outcome;
}

describe("one Safe proposal for a whole flow", () => {
  it("wallet-action:safe-batch reviews every call in order, sends them as one batch, and tracks the proposal", async () => {
    const batch = calls();
    const outcome = await proposeBatch(batch);

    expect(outcome).toMatchObject({ status: "proposed", safeTxHash: SAFE_TX_HASH });
    const expected = encoded(batch);
    expect(seen!.calls.map(({ to, value, data }) => ({ to, value, data }))).toEqual(expected);
    expect(mocks.sendCalls).toHaveBeenCalledOnce();
    expect(
      mocks.sendCalls.mock.calls[0]![0].calls.map(
        ({ to, value, data }: { to: Address; value: bigint; data: Hex }) => ({ to, value, data }),
      ),
    ).toEqual(expected);
    // One row for the one proposal, holding every call it must run.
    const rows = transactionActivitySnapshot().filter((row) => row.hash === SAFE_TX_HASH);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "safe", status: "safe-proposed" });
    expect(rows[0]!.safeProposal).toMatchObject({
      safe: ACCOUNT,
      calls: expected.map((call) => ({ ...call, value: String(call.value) })),
      batch: true,
    });

    // The same batch again is the pending proposal, not a second one: its hold refuses it.
    const again = await proposeBatch(batch);
    expect(again).toMatchObject({ status: "failed" });
    expect(mocks.sendCalls).toHaveBeenCalledOnce();
  });

  it("sends nothing when the review is closed", async () => {
    approve = false;
    const outcome = await proposeBatch(calls());
    expect(outcome?.status).not.toBe("proposed");
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });

  it.each(["account", "view-as"] as const)(
    "refuses a changed %s after the batch review",
    async (change) => {
      stopAnswering();
      answerReviews(async () => {
        if (change === "account") mocks.account.address = TOKEN;
        else setViewAs(TOKEN);
        return true;
      });
      const outcome = await proposeBatch(calls());
      expect(outcome).toMatchObject({ status: "failed" });
      expect(mocks.sendCalls).not.toHaveBeenCalled();
    },
  );

  it.each(["connector", "view-as"] as const)(
    "refuses a %s change while the wallet loads, before the wallet opens",
    async (change) => {
      mocks.walletLoaded.mockImplementation(() => {
        if (change === "connector") mocks.account.connector = { id: "safe-2", name: "Safe" };
        else setViewAs(TOKEN);
      });
      const outcome = await proposeBatch(calls());
      expect(mocks.walletLoaded).toHaveBeenCalled();
      expect(outcome).toMatchObject({ status: "failed" });
      expect(mocks.sendCalls).not.toHaveBeenCalled();
    },
  );

  it("shows an acquisition refusal and releases the exact SDK batch hold before a same-call retry", async () => {
    const batch = calls();
    mocks.walletLoaded.mockRejectedValueOnce(new Error("Wallet provider acquisition failed."));
    await expect(proposeBatch(batch)).resolves.toMatchObject({
      status: "failed",
      error: "Your wallet could not be reached. Nothing was sent; try again.",
    });
    expect(mocks.sendCalls).not.toHaveBeenCalled();
    mocks.walletLoaded.mockResolvedValue(undefined);
    await expect(proposeBatch(batch)).resolves.toMatchObject({
      status: "proposed",
      safeTxHash: SAFE_TX_HASH,
    });
    expect(mocks.sendCalls).toHaveBeenCalledOnce();
  });

  it("keeps a run's wallet check when a later run on the same hook ends first", async () => {
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    const run = (batch: ReturnType<typeof calls>) =>
      result.current.run({
        account: ACCOUNT,
        title: "Make the market",
        calls: batch,
        scope: `market-batch:${batch[0]!.args![1]}`,
        batch: true,
      });
    let release!: () => void;
    const loading = new Promise<void>((resolve) => (release = resolve));
    let atWallet!: () => void;
    const waiting = new Promise<void>((resolve) => (atWallet = resolve));
    mocks.walletLoaded.mockImplementationOnce(async () => {
      atWallet();
      await loading;
      setViewAs(TOKEN);
    });
    let first!: Promise<unknown>;
    await act(async () => {
      first = run(calls());
      await waiting;
      // The later run is closed at its review and ends while the first waits on the wallet.
      approve = false;
      await run(calls());
      release();
      await expect(first).resolves.toMatchObject({ status: "failed" });
    });
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });

  it("refuses a batch built for another account, such as a mint to the account that reviewed it", async () => {
    const other = "0x000000000000000000000000000000000000bEEF" as Address;
    const outcome = await proposeBatch(calls(), other);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(seen).toBeNull();
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });
});
