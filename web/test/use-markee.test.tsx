import { MARKEE_SENT_UNCHECKED, useMarkee } from "@/hooks/useMarkee";
import { registerFlowChoiceHandler } from "@/lib/flow-choice";
import { writeHolds } from "@/lib/write-hold";
import {
  checkedItLabel,
  SAVED_ATTEMPT_CHECK_LINE,
  SAVED_ATTEMPT_CHECK_WARNING,
  WRITE_HOLD_HASHED_EXIT_LINE,
  WRITE_HOLD_UNCHECKED_LINE,
} from "@bananapus/nana-sdk-core/review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { TransactionNotFoundError, zeroAddress, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: "0x823b92d6a4b2AED4b15675c7917c9f922ea8ADAD" as Address,
  options: undefined as
    | undefined
    | {
        beforeSubmission: () => Promise<void>;
        reverify: () => Promise<void>;
        onSubmissionRejected: () => Promise<void>;
      },
  write: vi.fn(),
  receipt: vi.fn(),
  readBoard: vi.fn(),
  readWallet: vi.fn(),
  readMessage: vi.fn(),
  decodeMessage: vi.fn(),
  decodeBoard: vi.fn(),
  activity: vi.fn(),
  readContract: vi.fn(),
  getTransaction: vi.fn(),
  getEnsAddress: vi.fn(),
  getCode: vi.fn(),
  getChainId: vi.fn(),
  chainReceipt: vi.fn(),
  settleFailure: vi.fn(),
  dismissed: false,
}));
const boardAddress = "0x1111111111111111111111111111111111111111" as Address;
const messageAddress = "0x2222222222222222222222222222222222222222" as Address;
const pool = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account }),
  usePublicClient: () => client,
}));
const client = {
  readContract: mocks.readContract,
  getTransaction: mocks.getTransaction,
  getEnsAddress: mocks.getEnsAddress,
  getCode: mocks.getCode,
  getChainId: mocks.getChainId,
  // The reads the SDK's write hold makes.
  getTransactionReceipt: mocks.chainReceipt,
  getTransactionCount: vi.fn(async () => 3),
  getBlockNumber: async () => 100n,
  getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
    number: blockNumber ?? 100n,
    hash: `0x${"bb".repeat(32)}`,
  }),
};
/**
 * Core's run as Markee sees it: its gates, then `write` as the wallet, then the hash handed back
 * before the receipt. A throw from `write` is a failure with its own line.
 */
vi.mock("@/hooks/useReviewedAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
  useReviewedAction: () => ({
    run: async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
      const { coreKept, coreUnsent } = await import("./support/reviewed-action");
      const call = action.calls[0]!;
      mocks.options = {
        reverify: () => action.reverify!(call, 0, undefined),
        beforeSubmission: async () => {
          await action.beforeWallet!(call, 0);
        },
        onSubmissionRejected: async () => {
          await coreUnsent(action.locks, () => action.onUnsent!(call, 0));
        },
      };
      let sent: Hex;
      try {
        sent = await mocks.write({ ...call, address: call.to, account: action.account });
      } catch (cause) {
        return { status: "failed", error: (cause as Error).message, failure: cause };
      }
      await coreKept(action.locks, () =>
        action.onSubmitted!(call, 0, sent, { safe: false, adopted: false }),
      );
      // The confirm closed while the step's hold followed it: the run's wait ends null.
      if (mocks.dismissed) return null;
      return { status: "done", hashes: [sent], receipts: [] };
    },
    following: false,
    dismiss: () => true,
  }),
}));
vi.mock("@/lib/markee", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/markee")>();
  return {
    ...original,
    readMarkeeBoard: mocks.readBoard,
    readMarkeeExitBoard: vi.fn(async (_client: unknown, address: Address) => ({ address })),
    readMarkeeWallet: mocks.readWallet,
    readMarkeeMessage: mocks.readMessage,
    decodeMarkeeCreated: mocks.decodeMessage,
    decodeBoardCreated: mocks.decodeBoard,
    readMarkeeFactory: vi.fn(async () => ({ minimumMonthlyRate: 1n })),
  };
});
vi.mock("@/lib/waitForReceipt", () => ({ waitForReceiptWithRetry: mocks.receipt }));
vi.mock("@/lib/transaction-activity", () => ({
  contractTransactionKey: (_account: string, _chain: number, call: { data: string }) => call.data,
  recordTransactionActivity: vi.fn(),
  updateTransactionActivity: vi.fn(),
  refreshTransactionActivities: vi.fn(() => []),
  requireTransactionActivityPersistence: vi.fn(),
  releaseTransactionActivityVerification: vi.fn(),
  settleTransactionActivityFailure: mocks.settleFailure,
  transactionActivityForHash: mocks.activity,
}));
const walletState = {
  ethBalance: 10n ** 18n,
  ethxBalance: 0n,
  flowRate: 0n,
  backerMarkee: zeroAddress,
  deposit: 0n,
  allowance: 10n ** 18n,
  pool,
  cfaAgreement: pool,
  gdaAgreement: pool,
};
const boardState = {
  address: boardAddress,
  message: "Live",
  minimumMonthlyRate: 1n,
  maxMessageLength: 280n,
  beneficiaryBps: 6200n,
  effectiveTopRate: 0n,
};

beforeEach(() => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => callback({}),
    },
  });
  localStorage.clear();
  mocks.getEnsAddress.mockResolvedValue("0x6b92c73682f0e1fac35A18ab17efa5e77DDE9fE1");
  mocks.getCode.mockResolvedValue("0x1234");
  mocks.getChainId.mockResolvedValue(8453);
  mocks.account = "0x823b92d6a4b2AED4b15675c7917c9f922ea8ADAD";
  mocks.readBoard.mockResolvedValue(boardState);
  mocks.readWallet.mockResolvedValue(walletState);
  mocks.readContract.mockResolvedValue(pool);
  mocks.readMessage.mockImplementation(async () => {
    const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
    return { owner: saved.account, message: saved.message, name: "" };
  });
  mocks.decodeMessage.mockReturnValue(messageAddress);
  mocks.decodeBoard.mockReturnValue({ board: boardAddress });
  mocks.getTransaction.mockImplementation(async () => {
    const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
    return {
      hash,
      from: saved.account,
      to: saved.pending.target,
      input: saved.pending.data,
      value: BigInt(saved.pending.value),
    };
  });
  mocks.activity.mockReturnValue(undefined);
  mocks.chainReceipt.mockReset().mockRejectedValue(new Error("Receipt not found"));
  mocks.settleFailure.mockReset();
  mocks.receipt.mockResolvedValue({ transactionHash: hash, status: "success", logs: [] });
  mocks.write.mockImplementation(async () => {
    await mocks.options!.reverify();
    await mocks.options!.beforeSubmission();
    return hash;
  });
});

/** The chain shows the saved submission mined at `hash`, its receipt a success. */
function chainMined() {
  const receipt = {
    status: "success",
    transactionHash: hash,
    from: mocks.account,
    to: boardAddress,
    blockNumber: 9n,
    blockHash: `0x${"bb".repeat(32)}`,
    transactionIndex: 0,
    logs: [],
  };
  mocks.getTransaction.mockImplementation(async () => {
    const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
    return {
      hash,
      from: saved.account,
      to: saved.pending.target,
      input: saved.pending.data,
      value: BigInt(saved.pending.value),
      nonce: 3,
      blockNumber: 9n,
      blockHash: receipt.blockHash,
      transactionIndex: 0,
    };
  });
  mocks.chainReceipt.mockResolvedValue(receipt);
  mocks.receipt.mockResolvedValue(receipt);
}

describe("wallet-action:markee-rent reviewed Markee execution", () => {
  it("does not create a board from another admin", async () => {
    mocks.account = messageAddress;
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("selected Markee admin");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("creates a board only from its real decoded receipt", async () => {
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.boardAddress).toBe(boardAddress);
    expect(mocks.decodeBoard).toHaveBeenCalled();
    expect(localStorage.getItem("revnet:markee-rent:board:v1")).toBe(boardAddress);
  });
  it("keeps the created message on a later submission failure, and holds unknown wallet outcomes", async () => {
    mocks.write.mockImplementationOnce(async () => {
      await mocks.options!.beforeSubmission();
      return hash;
    });
    mocks.write.mockImplementationOnce(async () => {
      await mocks.options!.beforeSubmission();
      throw new Error("Wallet transport lost");
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.board).toBeDefined());
    await act(() => result.current.takeover("Real message", "0.001"));
    expect(result.current.error).toBe("Wallet transport lost");
    const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
    expect(saved.messageAddress).toBe(messageAddress);
    expect(saved.pending.kind).toBe("start");
    expect(saved.pending.hash).toBeUndefined();
    await act(() => result.current.takeover("Real message", "0.001"));
    expect(mocks.write).toHaveBeenCalledTimes(2);
    // Nothing shows what became of the lost reply: the SDK's check, never a resend.
    await act(() => result.current.recover());
    expect(result.current.error).toBe(SAVED_ATTEMPT_CHECK_LINE);
  });
  it("keeps a sent step saved, never cancelled, when its confirm closes before its result", async () => {
    mocks.dismissed = true;
    try {
      mocks.write.mockImplementationOnce(async () => {
        await mocks.options!.beforeSubmission();
        return hash;
      });
      const { result } = renderHook(() => useMarkee(boardAddress));
      await waitFor(() => expect(result.current.board).toBeDefined());
      await act(() => result.current.takeover("Real message", "0.001"));
      expect(result.current.error).toBe(MARKEE_SENT_UNCHECKED);
      const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
      expect(saved.pending.hash).toBe(hash);
      expect(mocks.write).toHaveBeenCalledTimes(1);
    } finally {
      mocks.dismissed = false;
    }
  });
  it("rechecks a saved creation receipt without broadcasting again", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        message: "Saved",
        pending: {
          kind: "message",
          id: "saved",
          target: boardAddress,
          data: "0x1234",
          value: "0",
          hash,
        },
      }),
    );
    chainMined();
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(() => result.current.recover());
    expect(result.current.pending).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).messageAddress).toBe(
      messageAddress,
    );
  });
  it("does not treat an unexecuted Safe proposal as a creation receipt", async () => {
    mocks.activity.mockReturnValue({ kind: "safe", status: "safe-proposed" });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("waiting in your Safe");
    expect(result.current.boardAddress).toBeUndefined();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("does not permit new backing while an earlier stream is active", async () => {
    mocks.readWallet.mockResolvedValue({ ...walletState, flowRate: 1n });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.takeover("New", "0.001"));
    expect(result.current.error).toContain("Stop your current backing");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("holds a saved receipt whose sender differs from the reviewed account", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        message: "Saved",
        pending: {
          kind: "message",
          id: "saved",
          target: boardAddress,
          data: "0x1234",
          value: "0",
          hash,
        },
      }),
    );
    mocks.getTransaction.mockResolvedValue({
      hash,
      from: messageAddress,
      to: boardAddress,
      input: "0x1234",
      value: 0n,
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(() => result.current.recover());
    // It can't be shown as this submission: the SDK's check, and the submission kept.
    expect(result.current.error).toBe(SAVED_ATTEMPT_CHECK_LINE);
    expect(
      JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending,
    ).toBeDefined();
    expect(mocks.decodeMessage).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not release another submission when recovery changes during a late receipt", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        pending: {
          kind: "board",
          id: "saved",
          target: boardAddress,
          data: "0x1234",
          value: "0",
          hash,
        },
      }),
    );
    mocks.decodeBoard.mockImplementation(() => {
      localStorage.setItem(
        "revnet:markee-rent:recovery:v1",
        JSON.stringify({
          account: mocks.account,
          pending: {
            kind: "board",
            id: "other",
            target: boardAddress,
            data: "0x1234",
            value: "0",
            hash,
          },
        }),
      );
      return { board: boardAddress };
    });
    chainMined();
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(() => result.current.recover());
    expect(result.current.error).toContain("changed during verification");
    expect(localStorage.getItem("revnet:markee-rent:board:v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending.id).toBe(
      "other",
    );
  });
  it("refuses setup when ENS beneficiary changes", async () => {
    mocks.getEnsAddress.mockResolvedValue(messageAddress);
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("no longer resolves");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("requires a stopped stream before deposit withdrawal", async () => {
    mocks.readWallet.mockResolvedValue({ ...walletState, flowRate: 1n, deposit: 10n });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.withdraw());
    expect(result.current.error).toContain("Stop backing");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("clears stale board and wallet data when a refresh fails", async () => {
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    mocks.readBoard.mockRejectedValue(new Error("Base RPC failed"));
    mocks.readWallet.mockRejectedValue(new Error("Base RPC failed"));
    await act(() => result.current.refresh());
    expect(result.current.board).toBeUndefined();
    expect(result.current.wallet).toBeUndefined();
    expect(result.current.error).toBe("Base RPC failed");
  });
  it("keeps the frozen initiating account in every takeover call", async () => {
    const initial = mocks.account;
    mocks.write.mockImplementation(async (request: { account: string; functionName: string }) => {
      expect(request.account).toBe(initial);
      await mocks.options!.beforeSubmission();
      if (request.functionName === "createMarkee") mocks.account = messageAddress;
      return hash;
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.takeover("Frozen account", "0.001"));
    expect(mocks.write).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.write.mock.calls) expect(request.account).toBe(initial);
  });
  it("wallet-action:markee-rent executes a real new takeover with tagged host operations and exact funding", async () => {
    mocks.write.mockImplementation(async (request: { functionName: string }) => {
      await mocks.options!.reverify();
      await mocks.options!.beforeSubmission();
      if (request.functionName === "batchCall") {
        const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
        mocks.readWallet.mockResolvedValue({
          ...walletState,
          flowRate: BigInt(saved.pending.rate),
          backerMarkee: messageAddress,
        });
      }
      return hash;
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    const funding = result.current.quoteFunding("0.001")!;
    await act(() => result.current.takeover("Live advertisement", "0.001"));
    expect(result.current.error).toBeUndefined();
    expect(result.current.pending).toBe(false);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    const batch = mocks.write.mock.calls[1][0];
    expect(batch.account).toBe(mocks.account);
    expect(batch.chainId).toBe(8453);
    expect(batch.value).toBe(funding.wrapValue);
    expect(batch.args[0].map((op: { operationType: number }) => op.operationType)).toEqual([
      301, 301, 201, 201,
    ]);
  });
  it("stops active backing and verifies zero stream rate", async () => {
    mocks.readWallet.mockResolvedValue({ ...walletState, flowRate: 10n });
    mocks.write.mockImplementation(async () => {
      await mocks.options!.beforeSubmission();
      mocks.readWallet.mockResolvedValue(walletState);
      return hash;
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.stop());
    expect(result.current.error).toBeUndefined();
    expect(result.current.wallet?.flowRate).toBe(0n);
    expect(mocks.write.mock.calls[0][0].functionName).toBe("batchCall");
  });
  it("withdraws a stopped backing buffer and verifies zero deposit", async () => {
    mocks.readWallet.mockResolvedValue({ ...walletState, deposit: 10n });
    mocks.write.mockImplementation(async () => {
      await mocks.options!.beforeSubmission();
      mocks.readWallet.mockResolvedValue(walletState);
      return hash;
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.withdraw());
    expect(result.current.error).toBeUndefined();
    expect(result.current.wallet?.deposit).toBe(0n);
    expect(mocks.write.mock.calls[0][0].functionName).toBe("withdrawDeposit");
  });
  it("holds malformed recovery instead of authorizing another wallet write", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        pending: { kind: "message", id: "bad", hash: "0xnotahash" },
      }),
    );
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("storage is invalid");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuses beneficiary drift during final review before submission", async () => {
    mocks.getEnsAddress
      .mockResolvedValueOnce("0x6b92c73682f0e1fac35A18ab17efa5e77DDE9fE1")
      .mockResolvedValue(messageAddress);
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("no longer resolves");
    expect(localStorage.getItem("revnet:markee-rent:recovery:v1")).toBeNull();
  });
  it("refuses fee drift before authorizing message creation", async () => {
    mocks.write.mockImplementation(async () => {
      mocks.readBoard.mockResolvedValue({
        ...boardState,
        factoryConfig: { beneficiaryBps: 5000n },
      });
      await mocks.options!.reverify();
      await mocks.options!.beforeSubmission();
      return hash;
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.takeover("Review fee", "0.001"));
    expect(result.current.error).toContain("split changed");
    expect(localStorage.getItem("revnet:markee-rent:recovery:v1")).toBeNull();
  });
  it("requires a rate above the current leading advertisement", async () => {
    mocks.readBoard.mockResolvedValue({ ...boardState, effectiveTopRate: 10n ** 18n });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.takeover("Too low", "0.001"));
    expect(result.current.error).toContain("higher than");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("updates existing backing with the same message and verifies the new rate", async () => {
    mocks.readWallet.mockResolvedValue({
      ...walletState,
      flowRate: 10n,
      backerMarkee: messageAddress,
      deposit: 100n,
    });
    mocks.write.mockImplementation(async () => {
      await mocks.options!.reverify();
      await mocks.options!.beforeSubmission();
      const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
      mocks.readWallet.mockResolvedValue({
        ...walletState,
        flowRate: BigInt(saved.pending.rate),
        backerMarkee: messageAddress,
      });
      return hash;
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.updateStream("0.001"));
    expect(result.current.error).toBeUndefined();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.decodeMessage).not.toHaveBeenCalled();
    expect(result.current.wallet?.backerMarkee).toBe(messageAddress);
  });
  it("associates an exact missing wallet hash before resuming verification", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        message: "Saved",
        pending: { kind: "message", id: "saved", target: boardAddress, data: "0x1234", value: "0" },
      }),
    );
    chainMined();
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(() => result.current.recover(hash));
    expect(result.current.error).toBeUndefined();
    expect(result.current.pending).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuses a mismatched supplied transaction hash without releasing the hold", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        pending: { kind: "stop", id: "saved", target: boardAddress, data: "0x1234", value: "0" },
      }),
    );
    mocks.getTransaction.mockResolvedValue({
      hash,
      from: messageAddress,
      to: boardAddress,
      input: "0x1234",
      value: 0n,
    });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(() => result.current.recover(hash));
    expect(result.current.error).toBe(SAVED_ATTEMPT_CHECK_LINE);
    expect(
      JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending.hash,
    ).toBeUndefined();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("allows stopping after mutable board payment policy changes", async () => {
    mocks.readWallet.mockResolvedValue({ ...walletState, flowRate: 10n });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    mocks.readBoard.mockRejectedValue(new Error("Beneficiary changed"));
    mocks.write.mockImplementation(async () => {
      await mocks.options!.reverify();
      await mocks.options!.beforeSubmission();
      mocks.readWallet.mockResolvedValue(walletState);
      return hash;
    });
    await act(() => result.current.stop());
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending,
    ).toBeUndefined();
  });
  it("releases only the matching hashless intent on an authoritative wallet rejection", async () => {
    mocks.write.mockImplementation(async () => {
      await mocks.options!.beforeSubmission();
      await mocks.options!.onSubmissionRejected!();
      throw new Error("Wallet rejected");
    });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toBe("Wallet rejected");
    expect(result.current.pending).toBe(false);
    expect(
      JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending,
    ).toBeUndefined();
  });
  it("runs actions in a browser without Web Locks", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error ?? "").not.toContain("Web Locks");
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("writes nothing to the Markee journal once its lock passed to another tab", async () => {
    const { LockLostError } = await import("@bananapus/nana-sdk-core/review/locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (name: string, _options: unknown, callback: (lock: object) => unknown) =>
          callback({
            name,
            mode: "exclusive",
            signal: AbortSignal.abort(),
            held: async () => false,
            assertHeld: async () => {
              throw new LockLostError(name);
            },
          }),
      },
    });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(localStorage.getItem("revnet:markee-rent:recovery:v1")).toBeNull();
    expect(localStorage.getItem("revnet:markee-rent:board:v1")).toBeNull();
  });
  it("saves the wallet's hash once the lock is free again when the lock lapsed while the wallet was open", async () => {
    const { lapsingLocksForTests } = await import("@bananapus/nana-sdk-core/testing");
    const { locks, lapse } = lapsingLocksForTests();
    Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
    mocks.write.mockImplementationOnce(async () => {
      await mocks.options!.reverify();
      await mocks.options!.beforeSubmission();
      lapse();
      return hash;
    });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending.hash).toBe(
        hash,
      ),
    );
  });
  it("releases the step once the lock is free again when the wallet said no after the lock lapsed", async () => {
    const { lapsingLocksForTests } = await import("@bananapus/nana-sdk-core/testing");
    const { locks, lapse } = lapsingLocksForTests();
    Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
    mocks.write.mockImplementationOnce(async () => {
      await mocks.options!.reverify();
      await mocks.options!.beforeSubmission();
      lapse();
      await mocks.options!.onSubmissionRejected();
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1") ?? "{}").pending,
      ).toBeUndefined(),
    );
  });
  it("refuses a lifecycle already owned by another tab", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: null) => Promise<void>,
        ) => callback(null),
      },
    });
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("Another tab");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rechecks a board created in another tab before preparing creation", async () => {
    const { result } = renderHook(() => useMarkee());
    await waitFor(() => expect(result.current.loading).toBe(false));
    localStorage.setItem("revnet:markee-rent:board:v1", boardAddress);
    await act(() => result.current.createBoard());
    expect(result.current.error).toContain("already configured");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuses payment when a saved advertisement owner changes", async () => {
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        message: "Saved",
        messageAddress,
      }),
    );
    mocks.readMessage.mockResolvedValue({ owner: pool, message: "Saved", name: "" });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.wallet).toBeDefined());
    await act(() => result.current.takeover("Saved", "0.001"));
    expect(result.current.error).toContain("ownership or text changed");
    expect(mocks.decodeMessage).not.toHaveBeenCalled();
    expect(localStorage.getItem("revnet:markee-rent:recovery:v1")).not.toContain("pending");
  });
  it.each([
    { remaining: 10n ** 18n - 1000n, sufficient: true },
    { remaining: 0n, sufficient: false },
  ])(
    "checks real buffer coverage after deferred review with remaining ETHx $remaining",
    async ({ remaining, sufficient }) => {
      const initial = {
        ...walletState,
        ethxBalance: 10n ** 18n,
        flowRate: 10n,
        backerMarkee: messageAddress,
        deposit: 100n,
      };
      mocks.readWallet.mockResolvedValue(initial);
      let releaseReview: (() => void) | undefined;
      mocks.write.mockImplementation(async (request: { value: bigint }) => {
        expect(request.value).toBe(0n);
        await new Promise<void>((resolve) => {
          releaseReview = resolve;
        });
        await mocks.options!.reverify();
        await mocks.options!.beforeSubmission();
        const saved = JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!);
        mocks.readWallet.mockResolvedValue({
          ...initial,
          ethxBalance: remaining,
          flowRate: BigInt(saved.pending.rate),
        });
        return hash;
      });
      const { result } = renderHook(() => useMarkee(boardAddress));
      await waitFor(() => expect(result.current.wallet).toBeDefined());
      let action: Promise<void>;
      act(() => {
        action = result.current.updateStream("0.001");
      });
      await waitFor(() => expect(releaseReview).toBeDefined());
      mocks.readWallet.mockResolvedValue({ ...initial, ethxBalance: remaining });
      await act(async () => {
        releaseReview!();
        await action;
      });
      if (sufficient) {
        expect(result.current.error).toBeUndefined();
        expect(result.current.wallet?.ethxBalance).toBe(remaining);
        expect(result.current.pending).toBe(false);
      } else {
        expect(result.current.error).toContain("Stream funding changed");
        expect(localStorage.getItem("revnet:markee-rent:recovery:v1")).toBeNull();
        expect(mocks.receipt).not.toHaveBeenCalled();
      }
    },
  );
});

describe("a saved Markee submission the chain can't settle", () => {
  const saveHashless = () =>
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        pending: { kind: "stop", id: "saved", target: boardAddress, data: "0x1234", value: "0" },
      }),
    );

  it("offers the SDK's one check for a submission the wallet gave no hash for, and frees the board only on it", async () => {
    const prompt = vi.fn().mockResolvedValue(false);
    registerFlowChoiceHandler(prompt);
    saveHashless();
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(() => result.current.recover());
    expect(prompt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        lines: [SAVED_ATTEMPT_CHECK_LINE, SAVED_ATTEMPT_CHECK_WARNING],
        confirmLabel: checkedItLabel(),
      }),
    );
    expect(result.current.error).toBe(SAVED_ATTEMPT_CHECK_LINE);
    expect(result.current.pending).toBe(true);

    prompt.mockResolvedValue(true);
    await act(() => result.current.recover());
    expect(result.current.error).toBeUndefined();
    expect(result.current.pending).toBe(false);
    expect(
      JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending,
    ).toBeUndefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("offers the hold's warned exit for a sent hash the node hasn't seen for 30 minutes", async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    registerFlowChoiceHandler(prompt);
    // The SDK's write hold took the exact call and the wallet's hash.
    const hold = writeHolds.open({
      chainId: 8453,
      account: mocks.account,
      safe: false,
      call: { to: boardAddress, data: "0x1234", value: 0n },
    });
    await hold.send(client as never, async (gate) => {
      await gate.beforeSend();
      gate.afterSubmit(hash);
    });
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        pending: {
          kind: "stop",
          id: "saved",
          target: boardAddress,
          data: "0x1234",
          value: "0",
          hash,
        },
      }),
    );
    // The node never learns of it.
    mocks.getTransaction.mockRejectedValue(new TransactionNotFoundError({ hash }));
    mocks.receipt.mockRejectedValue(new Error("Receipt not found"));
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await act(() => result.current.recover());
    expect(prompt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        lines: expect.arrayContaining([WRITE_HOLD_UNCHECKED_LINE, WRITE_HOLD_HASHED_EXIT_LINE]),
      }),
    );
    expect(result.current.pending).toBe(false);
    expect(hold.peek()).toMatchObject({ status: "clear" });
    // Its own transaction row no longer waits for verification either.
    expect(mocks.settleFailure).toHaveBeenCalledWith(hash, expect.any(String));
  });

  /** The SDK's hold of the saved stop call. */
  const stopHold = () =>
    writeHolds.open({
      chainId: 8453,
      account: mocks.account,
      safe: false,
      call: { to: boardAddress, data: "0x1234", value: 0n },
    });
  const saveHashed = () =>
    localStorage.setItem(
      "revnet:markee-rent:recovery:v1",
      JSON.stringify({
        account: mocks.account,
        board: boardAddress,
        pending: {
          kind: "stop",
          id: "saved",
          target: boardAddress,
          data: "0x1234",
          value: "0",
          hash,
        },
      }),
    );

  it("attaches a recovered hash under the hold's lock, so an identical send from another tab during recovery is refused", async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    registerFlowChoiceHandler(prompt);
    await stopHold()
      .send(client as never, async (gate) => {
        await gate.beforeSend();
        throw new Error("Wallet transport lost");
      })
      .catch(() => undefined);
    saveHashless();
    // The recovered hash is the exact call, sent at the reserved nonce and still pending.
    mocks.getTransaction.mockResolvedValue({
      hash,
      from: mocks.account,
      to: boardAddress,
      input: "0x1234",
      value: 0n,
      nonce: 3,
      blockNumber: null,
    });
    mocks.receipt.mockRejectedValue(new Error("Receipt not found"));
    // Another tab's controller tries the identical call whenever this one reads the chain.
    const { createWriteHold } = await import("@bananapus/nana-sdk-core/review");
    const otherTab = createWriteHold().open({
      chainId: 8453,
      account: mocks.account,
      safe: false,
      call: { to: boardAddress, data: "0x1234", value: 0n },
    });
    let trying = false;
    const sentByOtherTab: Hex[] = [];
    const attempt = async () => {
      if (trying) return;
      trying = true;
      await otherTab
        .send(client as never, async (gate) => {
          await gate.beforeSend();
          gate.afterSubmit(`0x${"cd".repeat(32)}`);
          sentByOtherTab.push(`0x${"cd".repeat(32)}`);
        })
        .catch(() => undefined);
      trying = false;
    };
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));
    const reads = [client.getTransactionCount, mocks.getTransaction, mocks.getChainId];
    for (const read of reads) {
      const original = read.getMockImplementation()!;
      read.mockImplementation(async (...args: never[]) => {
        await attempt();
        return original(...args);
      });
    }

    await act(() => result.current.recover(hash));
    expect(sentByOtherTab).toEqual([]);
    expect(prompt).not.toHaveBeenCalled();
    expect(stopHold().peek()).toMatchObject({ status: "pending-known-hash", hash });
  });

  it("keeps the hashless recovery and its exit when the hold refuses a supplied hash as an earlier attempt's", async () => {
    await stopHold()
      .send(client as never, async (gate) => {
        await gate.beforeSend();
        throw new Error("Wallet transport lost");
      })
      .catch(() => undefined);
    saveHashless();
    // An earlier identical transaction: below the reserved nonce, mined before the reservation.
    mocks.getTransaction.mockResolvedValue({
      hash,
      from: mocks.account,
      to: boardAddress,
      input: "0x1234",
      value: 0n,
      nonce: 2,
      blockNumber: 90n,
    });
    const prompt = vi.fn().mockResolvedValue(false);
    registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(() => result.current.recover(hash));
    expect(
      JSON.parse(localStorage.getItem("revnet:markee-rent:recovery:v1")!).pending.hash,
    ).toBeUndefined();
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(stopHold().peek()).toMatchObject({ status: "held-no-hash" });
    expect(result.current.pending).toBe(true);
  });

  it("moves a hash saved before the hold held it into the hold, which offers its exit once it goes unseen", async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    registerFlowChoiceHandler(prompt);
    saveHashed();
    mocks.getTransaction.mockRejectedValue(new TransactionNotFoundError({ hash }));
    mocks.receipt.mockRejectedValue(new Error("Receipt not found"));
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(() => result.current.recover());
    expect(prompt).not.toHaveBeenCalled();
    expect(stopHold().peek()).toMatchObject({ hash });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await act(() => result.current.recover());
    expect(prompt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ lines: expect.arrayContaining([WRITE_HOLD_UNCHECKED_LINE]) }),
    );
    expect(result.current.pending).toBe(false);
  });

  it("never retires a transaction that settled when its Markee result can't be verified", async () => {
    const prompt = vi.fn().mockResolvedValue(false);
    registerFlowChoiceHandler(prompt);
    saveHashed();
    const mined = {
      hash,
      from: mocks.account,
      to: boardAddress,
      input: "0x1234",
      value: 0n,
      nonce: 3,
      blockNumber: 9n,
      blockHash: `0x${"bb".repeat(32)}`,
      transactionIndex: 0,
    };
    mocks.getTransaction.mockResolvedValue(mined);
    const receipt = {
      status: "success",
      transactionHash: hash,
      from: mocks.account,
      to: boardAddress,
      blockNumber: 9n,
      blockHash: mined.blockHash,
      transactionIndex: 0,
      logs: [],
    };
    mocks.chainReceipt.mockResolvedValue(receipt);
    mocks.receipt.mockResolvedValue(receipt);
    // The stream still runs: the stop's result can't be verified.
    mocks.readWallet.mockResolvedValue({ ...walletState, flowRate: 10n });
    const { result } = renderHook(() => useMarkee(boardAddress));
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(() => result.current.recover());
    // A settled success always wins: followed with its hash, never an exit or a resend.
    expect(prompt).not.toHaveBeenCalled();
    expect(result.current.error).toContain("went through");
    expect(result.current.pending).toBe(true);

    prompt.mockResolvedValue(true);
    await act(() => result.current.recover());
    expect(prompt).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);
  });
});
