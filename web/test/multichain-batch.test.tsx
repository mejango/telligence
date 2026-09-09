import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import {
  batchCallKey,
  createMultichainBatch,
  findPendingBatch,
  makeBatchRounds,
  readMultichainBatches,
  saveMultichainBatch,
  type MultichainCall,
} from "@/lib/multichain-batch";
import { recordTransactionActivity } from "@/lib/transaction-activity";
import { act, renderHook } from "@testing-library/react";
import { parseAbi, type Address, type Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TARGET = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;
const ABI = parseAbi(["function distribute(uint256 projectId)"]);
const call = (chainId: number, id = 1n): MultichainCall => ({
  chainId,
  address: TARGET,
  abi: ABI,
  functionName: "distribute",
  args: [id],
  recoveryScope: `distribution:${chainId}:${id}`,
});
const mocks = vi.hoisted(() => ({
  safe: false,
  account: "0x1111111111111111111111111111111111111111",
  chainId: 1,
  quote: vi.fn(),
  pay: vi.fn(),
  wait: vi.fn(),
  choose: vi.fn(),
  write: vi.fn(),
  verify: vi.fn(),
  estimate: vi.fn(),
  review: vi.fn(),
  transaction: vi.fn(),
  receipt: vi.fn(),
  block: vi.fn(),
  options: {} as { reverify?: () => Promise<void>; beforeSubmission?: () => Promise<void> },
}));
vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: mocks.account, chainId: mocks.chainId }),
  getPublicClient: () => ({
    estimateContractGas: mocks.estimate,
    call: mocks.verify,
    getTransaction: mocks.transaction,
    getTransactionReceipt: mocks.receipt,
    getBlock: mocks.block,
    waitForTransactionReceipt: mocks.receipt,
  }),
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.pay }),
  waitForRelayrBundle: mocks.wait,
  requireRelayrRecoveryScopeAvailable: vi.fn(),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => mocks.safe,
  submittedViaSafe: () => mocks.safe,
  useWriteContract: (options: typeof mocks.options) => {
    mocks.options = options;
    return {
      writeContractAsync: async (variables: { chainId: number }) => {
        // The reviewed direct wrapper switches to each destination before its
        // final source/account checks and wallet submission.
        mocks.chainId = variables.chainId;
        await options.reverify?.();
        await options.beforeSubmission?.();
        return mocks.write(variables);
      },
    };
  },
}));
vi.mock("@/lib/transaction-review", () => ({
  requireTransactionReview: mocks.review,
  chooseRelayrPayment: mocks.choose,
}));

beforeEach(() => {
  window.localStorage.clear();
  mocks.safe = false;
  mocks.account = ACCOUNT;
  mocks.chainId = 1;
  mocks.review.mockResolvedValue(undefined);
  mocks.estimate.mockResolvedValue(100000n);
  mocks.verify.mockResolvedValue({ data: "0x" });
  mocks.choose.mockResolvedValue({ chain: 1 });
  mocks.pay.mockResolvedValue(HASH);
  mocks.write.mockResolvedValue(HASH);
  const frozen = createMultichainBatch(ACCOUNT, "fixture", "Fixture", [call(1)], "direct").calls[0];
  mocks.transaction.mockResolvedValue({
    hash: HASH,
    from: ACCOUNT,
    to: TARGET,
    input: frozen.data,
    value: 0n,
    blockHash: HASH,
    blockNumber: 1n,
  });
  mocks.receipt.mockResolvedValue({
    transactionHash: HASH,
    status: "success",
    blockHash: HASH,
    blockNumber: 1n,
    logs: [],
  });
  mocks.block.mockResolvedValue({ hash: HASH });
  mocks.quote.mockImplementation(async (requests: MultichainCall[]) => ({
    bundle_uuid: `bundle-${mocks.quote.mock.calls.length}`,
    payment_info: [{ chain: requests[0].chainId }],
    requests,
  }));
  mocks.wait.mockImplementation(async (uuid: string) => {
    const index = Number(uuid.split("-")[1]) - 1;
    const requests = mocks.quote.mock.calls[index][0] as MultichainCall[];
    return {
      transactions: requests.map((request) => ({
        request: { chain: request.chainId },
        status: { data: { hash: HASH } },
      })),
    };
  });
});

describe("durable multichain batch journal", () => {
  it("preserves all allocations in explicit rounds with one call per chain", () => {
    expect(
      makeBatchRounds([call(1, 1n), call(10, 1n), call(1, 2n), call(10, 2n), call(1, 3n)]).map(
        (round) => round.indices,
      ),
    ).toEqual([[0, 1], [2, 3], [4]]);
  });
  it("restores exact bigint arguments and prevents overlapping changed selections", () => {
    const job = createMultichainBatch(
      ACCOUNT,
      "credits",
      "Claim credits",
      [call(1), call(10)],
      "relayr",
    );
    saveMultichainBatch(job);
    expect(findPendingBatch(ACCOUNT, "credits")?.calls[0].args).toEqual([1n]);
    expect(() =>
      createMultichainBatch(ACCOUNT, "another-ui", "Changed", [call(10)], "relayr"),
    ).toThrow(/Resume the saved/);
    expect(batchCallKey([call(1, 2n)])).not.toBe(job.key);
  });
  it("does not treat corrupt recovery data as an empty journal", () => {
    localStorage.setItem("revnet:multichain-batches:v1", "bad JSON");
    expect(() => readMultichainBatches()).toThrow(/recovery data is unavailable/);
  });
});

describe("wallet-action:multichain-batch — reviewed selected-call orchestration", () => {
  it("routes all four supported testnet destinations through one reviewed Relayr round", async () => {
    const chainIds = [11155111, 11155420, 84532, 421614];
    mocks.choose.mockResolvedValue({ chain: 11155111 });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "testnet-auto",
        label: "Distribute",
        calls: chainIds.map((chainId, index) => call(chainId, BigInt(index + 10))),
      });
      expect(completed.status).toBe("success");
      expect(completed.hashes.map((row) => row.callIndex)).toEqual([0, 1, 2, 3]);
    });
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.quote.mock.calls[0][0].map((request: MultichainCall) => request.chainId)).toEqual(
      chainIds,
    );
    expect(mocks.choose).toHaveBeenCalledWith([{ chain: 11155111 }], 1);
    expect(mocks.pay).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].route).toBe("relayr");
  });

  it("rejects a fresh mixed mainnet/testnet EOA batch before review, publication, or saving", async () => {
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "mixed-family",
          label: "Distribute",
          calls: [call(1), call(11155111)],
        }),
      ).rejects.toThrow(/Mainnet and testnet transactions cannot share/);
    });
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()).toEqual([]);
  });

  it("resumes an older direct testnet job without switching transport or replaying its completed call", async () => {
    const originalHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "old-testnet-direct",
      "Claim",
      [call(11155111, 21n), call(11155420, 32n)],
      "direct",
    );
    batch.calls[0].state = "success";
    batch.calls[0].hash = originalHash;
    saveMultichainBatch(batch);
    mocks.transaction.mockResolvedValue({
      hash: HASH,
      from: ACCOUNT,
      to: TARGET,
      input: batch.calls[1].data,
      value: 0n,
      blockHash: HASH,
      blockNumber: 1n,
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "old-testnet-direct",
        label: "Claim",
        calls: [],
      });
      expect(completed).toEqual({
        status: "success",
        hashes: [
          { chainId: 11155111, callIndex: 0, hash: originalHash },
          { chainId: 11155420, callIndex: 1, hash: HASH },
        ],
      });
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 11155420, args: [32n] }),
    );
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].route).toBe("direct");
  });

  it("resumes a paid testnet Relayr round without funding again or replaying confirmed allocations", async () => {
    const originalHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "testnet-paid",
      "Distribute",
      [call(11155111, 1n), call(11155420, 1n), call(11155111, 2n)],
      "relayr",
    );
    batch.calls[0].state = "success";
    batch.calls[0].hash = originalHash;
    batch.calls[1].state = "success";
    batch.calls[1].hash = originalHash;
    batch.rounds[0].state = "success";
    batch.rounds[1].state = "pending";
    batch.rounds[1].bundleUuid = "saved-testnet-paid";
    saveMultichainBatch(batch);
    mocks.wait.mockResolvedValue({
      transactions: [{ request: { chain: 11155111 }, status: { data: { hash: HASH } } }],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "testnet-paid",
        label: "Distribute",
        calls: [],
      });
      expect(completed.status).toBe("success");
      expect(completed.hashes.map((row) => row.callIndex)).toEqual([0, 1, 2]);
    });
    expect(mocks.wait).toHaveBeenCalledExactlyOnceWith("saved-testnet-paid");
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].route).toBe("relayr");
  });

  it("keeps fresh testnet Safe batches on the staged proposal route", async () => {
    mocks.safe = true;
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      expect(
        (
          await result.current.runBatch({
            scope: "testnet-safe",
            label: "Distribute",
            calls: [call(11155111), call(11155420)],
          })
        ).status,
      ).toBe("pending");
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ chainId: 11155111 }),
    );
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0]).toMatchObject({
      route: "direct",
      calls: [{ state: "safe" }, { state: "ready" }],
    });
  });

  it("keeps a soft-failed direct recipient result pending and never repeats its transaction", async () => {
    const topic = `0x${"ef".repeat(32)}` as Hash;
    mocks.receipt.mockResolvedValue({
      transactionHash: HASH,
      status: "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [{ address: TARGET, topics: [topic], data: "0x" }],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "soft-failure",
          label: "Distribute",
          calls: [{ ...call(1), rejectEvents: [{ topic, address: TARGET }] }],
        }),
      ).rejects.toThrow(/incomplete recipient/);
    });
    expect(readMultichainBatches()[0].calls[0]).toMatchObject({ state: "submitted", hash: HASH });
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "soft-failure", label: "Distribute", calls: [] }),
      ).rejects.toThrow(/incomplete recipient/);
    });
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("resumes original quote funding after reload during an unpaid wallet review", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "funding-review",
      "Distribute",
      [call(1), call(10)],
      "relayr",
    );
    batch.rounds[0].state = "funding";
    batch.rounds[0].bundleUuid = "bundle-1";
    saveMultichainBatch(batch);
    recordTransactionActivity({
      id: "relayr:bundle-1",
      kind: "relayr-bundle",
      title: "Unpaid quote",
      status: "pending",
      message: "Funding review open",
      bundleUuid: "bundle-1",
      relayrPaymentStatus: "unfunded",
      account: ACCOUNT,
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      expect(
        (await result.current.runBatch({ scope: "funding-review", label: "Distribute", calls: [] }))
          .status,
      ).toBe("success");
    });
    expect(mocks.pay).toHaveBeenCalledOnce();
    expect(mocks.choose).toHaveBeenCalledOnce();
  });
  it("executes all selected allocations, with one chosen funding payment for each explicit round", async () => {
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "auto",
        label: "Distribute",
        calls: [call(1, 1n), call(10, 1n), call(1, 2n)],
      });
      expect(completed.status).toBe("success");
      expect(completed.hashes.map((row) => row.callIndex)).toEqual([0, 1, 2]);
    });
    expect(
      mocks.quote.mock.calls.map((args) => args[0].map((row: MultichainCall) => row.chainId)),
    ).toEqual([[1, 10], [1]]);
    expect(mocks.pay).toHaveBeenCalledTimes(2);
    expect(mocks.choose).toHaveBeenCalledTimes(2);
  });
  it("resumes the frozen paid round without paying again or replaying the completed round", async () => {
    mocks.wait
      .mockImplementationOnce(async () => ({
        transactions: [
          { request: { chain: 1 }, status: { data: { hash: HASH } } },
          { request: { chain: 10 }, status: { data: { hash: HASH } } },
        ],
      }))
      .mockRejectedValueOnce(new Error("destination RPC unavailable"))
      .mockResolvedValue({
        transactions: [{ request: { chain: 1 }, status: { data: { hash: HASH } } }],
      });
    const first = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        first.result.current.runBatch({
          scope: "auto",
          label: "Distribute",
          calls: [call(1, 1n), call(10, 1n), call(1, 2n)],
        }),
      ).rejects.toThrow(/RPC unavailable/);
    });
    first.unmount();
    const second = renderHook(() => useMultichainBatch());
    expect(second.result.current.getPendingBatch("auto")?.completed).toBe(2);
    await act(async () => {
      expect(
        (await second.result.current.runBatch({ scope: "auto", label: "Distribute", calls: [] }))
          .status,
      ).toBe("success");
    });
    expect(mocks.pay).toHaveBeenCalledTimes(2);
    expect(mocks.quote).toHaveBeenCalledTimes(2);
  });
  it("keeps an unknown direct wallet result locked across reload", async () => {
    mocks.write.mockRejectedValue(new Error("RPC connection lost after send"));
    const first = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        first.result.current.runBatch({ scope: "one", label: "Distribute", calls: [call(1)] }),
      ).rejects.toThrow(/connection lost/);
    });
    first.unmount();
    const second = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        second.result.current.runBatch({ scope: "one", label: "Distribute", calls: [] }),
      ).rejects.toThrow(/unknown result/);
    });
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("stops after the first Safe proposal without proposing other chains", async () => {
    mocks.safe = true;
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      expect(
        (
          await result.current.runBatch({
            scope: "safe",
            label: "Distribute",
            calls: [call(1), call(10)],
          })
        ).status,
      ).toBe("pending");
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].calls.map((row) => row.state)).toEqual(["safe", "ready"]);
  });
  it("never sends when the recovery journal cannot be persisted", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "no-storage", label: "Distribute", calls: [call(1)] }),
      ).rejects.toThrow(/saved for recovery/);
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
