import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import type { RelayrDestinationProgress } from "@/hooks/useReviewedRelayr";
import {
  batchCallKey,
  createMultichainBatch,
  findPendingBatch,
  isReplaceableRoutingDraft,
  makeBatchRounds,
  readMultichainBatches,
  replaceRoutingDraft,
  resetUnsubmittedBatchCall,
  saveMultichainBatch,
  type MultichainBatch,
  type MultichainCall,
} from "@/lib/multichain-batch";
import { pendingRouterCommitment } from "@/lib/pending-router-calls";
import { routerGatewayAbi } from "@/lib/router-gateway-abi";
import {
  contractTransactionKey,
  recordTransactionActivity,
  refreshTransactionActivities,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import {
  SAFE_EXEC_ABI,
  safeProposalFor,
  safeTransactionHash,
} from "@bananapus/nana-sdk-core/safe-service";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Hex } from "viem";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const commitmentData = encodeFunctionData({
  abi: routerGatewayAbi,
  functionName: "pendingCallCommitmentOf",
  args: [HASH],
});
const failureData = encodeFunctionData({
  abi: routerGatewayAbi,
  functionName: "pendingCallFailureOf",
  args: [HASH],
});
const failureSnapshot = encodeFunctionResult({
  abi: routerGatewayAbi,
  functionName: "pendingCallFailureOf",
  result: {
    errorHash: zeroHash,
    count: 0,
    lastFailureAt: 0,
    highestGasLimit: 0n,
  },
});
const retryCall = (chainId: number): MultichainCall => ({
  ...call(chainId),
  gas: 6_600_000n,
  preconditions: [
    { address: TARGET, data: commitmentData, expected: HASH },
    { address: TARGET, data: failureData, expected: failureSnapshot },
  ],
  expectedRouterPending: { gateway: TARGET, pendingCallId: HASH, callHash: HASH },
});
const mocks = vi.hoisted(() => ({
  safe: false,
  account: "0x1111111111111111111111111111111111111111",
  chainId: 1,
  quote: vi.fn(),
  pay: vi.fn(),
  wait: vi.fn(),
  scopeAvailable: vi.fn(),
  scopeSession: vi.fn(),
  releasedUnpaid: vi.fn(),
  choose: vi.fn(),
  write: vi.fn(),
  verify: vi.fn(),
  estimate: vi.fn(),
  simulate: vi.fn(),
  rawCall: vi.fn(),
  review: vi.fn(),
  callReview: vi.fn(),
  transaction: vi.fn(),
  receipt: vi.fn(),
  block: vi.fn(),
  finalGuard: vi.fn(),
  connector: { id: "injected" } as { id: string },
}));
vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({
    address: mocks.account,
    chainId: mocks.chainId,
    connector: mocks.connector,
  }),
  getPublicClient: () => ({
    estimateContractGas: mocks.estimate,
    simulateContract: mocks.simulate,
    request: mocks.rawCall,
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
  requireRelayrRecoveryScopeAvailable: mocks.scopeAvailable,
  hasRelayrRecoveryScopeSession: mocks.scopeSession,
  isReleasedUnpaidRelayrBundle: mocks.releasedUnpaid,
  forwardedRequestGas: async (
    _client: unknown,
    _forwarder: unknown,
    _account: unknown,
    request: { data: { gas: bigint } },
  ) => request.data.gas,
}));
// Core's one plan review of every call the batch's Relayr rounds run.
vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  reviewPlan: async (action: unknown) => {
    await mocks.review(action);
    return { reviewed: action };
  },
}));
vi.mock("@/lib/safe-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-connector")>()),
  isSafeConnection: () => mocks.safe,
}));
// Core's reviewed send, as the batch drives it: one review of every call it sends, then per call
// its reverify, simulation, beforeWallet, write gate and wallet, in order; a Safe proposes the
// first and stops.
vi.mock("@/hooks/useReviewedAction", async () => {
  const { isDefiniteWalletRejection } = await import("@bananapus/nana-sdk-core/review");
  const { coreKept, coreUnsent } = await import("./support/reviewed-action");
  const run = async (action: import("@bananapus/nana-sdk-core/review").ReviewedAction) => {
    try {
      await mocks.callReview(action.calls);
    } catch {
      return null;
    }
    const hashes: Hex[] = [];
    for (const [step, call] of action.calls.entries()) {
      const failed = (failure: unknown) => ({
        status: "failed" as const,
        error: failure instanceof Error ? failure.message : String(failure),
        failure,
      });
      try {
        mocks.chainId = call.chainId;
        await action.reverify?.(call, step, undefined);
        // Core's eth_call at the call's exact gas, when it has one.
        if (call.gas !== undefined)
          await mocks.rawCall({
            method: "eth_call",
            params: [
              {
                from: action.account,
                to: call.to,
                data: call.data,
                value: "0x0",
                gas: `0x${call.gas.toString(16)}`,
              },
              "latest",
            ],
          });
        else
          await mocks.simulate({
            address: call.to,
            abi: call.abi,
            functionName: call.functionName,
            args: call.args,
            value: call.value,
          });
        await action.beforeWallet?.(call, step);
      } catch (failure) {
        return failed(failure);
      }
      try {
        mocks.finalGuard();
      } catch (failure) {
        await coreUnsent(action.locks, () => action.onUnsent?.(call, step));
        return failed(failure);
      }
      let hash: Hex;
      try {
        hash = await mocks.write({ ...call, address: call.to, chainId: call.chainId });
      } catch (failure) {
        if (isDefiniteWalletRejection(failure))
          await coreUnsent(action.locks, () => action.onUnsent?.(call, step));
        return failed(failure);
      }
      await coreKept(action.locks, () =>
        action.onSubmitted?.(call, step, hash, { safe: mocks.safe, adopted: false }),
      );
      if (mocks.safe) return { status: "proposed" as const, step, safeTxHash: hash };
      hashes.push(hash);
    }
    return { status: "done" as const, hashes, receipts: [] };
  };
  return { useReviewedAction: () => ({ run }) };
});
vi.mock("@/lib/transaction-review", () => ({
  chooseRelayrPayment: mocks.choose,
}));
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  window.localStorage.clear();
  mocks.safe = false;
  mocks.account = ACCOUNT;
  mocks.chainId = 1;
  mocks.review.mockResolvedValue(undefined);
  mocks.scopeAvailable.mockReturnValue(undefined);
  mocks.scopeSession.mockReturnValue(false);
  mocks.releasedUnpaid.mockReturnValue(false);
  mocks.estimate.mockResolvedValue(100000n);
  mocks.simulate.mockResolvedValue({ request: {} });
  mocks.rawCall.mockResolvedValue("0x");
  mocks.verify.mockImplementation(async ({ data }) => ({
    data: data === commitmentData ? HASH : data === failureData ? failureSnapshot : "0x",
  }));
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
  mocks.block.mockResolvedValue({ hash: HASH, gasLimit: 36_000_000n });
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
  it.each(["hash", "changed call", "changed sibling"])(
    "preserves a %s instead of releasing a stale prewrite snapshot",
    (change) => {
      const job = createMultichainBatch(ACCOUNT, "direct", "Direct", [call(1), call(10)], "direct");
      job.calls[0].state = "submitting";
      const expected = structuredClone(job);
      if (change === "hash") job.calls[0].hash = HASH;
      else if (change === "changed call") job.calls[0].value = 1n;
      else job.calls[1].state = "submitting";
      saveMultichainBatch(job);
      expect(() => resetUnsubmittedBatchCall(expected, 0)).toThrow(/submission changed/);
      expect(readMultichainBatches()[0]).toEqual(job);
    },
  );
});

/** Web Locks whose lock another tab took over: its handle reads as lost. */
async function lostLocks() {
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
}

/** Core's lapsing leases as this tab's Web Locks: `lapse()` lapses every lease held now. */
async function lapsingLocks() {
  const { lapsingLocksForTests } = await import("@bananapus/nana-sdk-core/testing");
  const { locks, lapse } = lapsingLocksForTests();
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  return lapse;
}

describe("a batch whose lock passed to another tab", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });
  it("leaves a saved routing draft as it was on a re-check", async () => {
    const draft = createMultichainBatch(ACCOUNT, "routing", "Routing", [retryCall(1)], "relayr");
    draft.rounds[0] = {
      ...draft.rounds[0],
      state: "quoted",
      bundleUuid: "quote",
      transactionUuids: ["tx"],
    };
    saveMultichainBatch(draft);
    mocks.releasedUnpaid.mockReturnValue(true);
    await lostLocks();
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.recheckPendingRoutingBatch("routing");
    });
    expect(readMultichainBatches()[0].rounds[0]).toMatchObject({ state: "quoted" });
  });
  it.each([
    ["a hash", HASH, { hash: HASH, state: "submitted" }],
    ["a definite rejection", null, { state: "ready" }],
  ] as const)(
    "saves the wallet's answer (%s) once the lock is free again when it lapsed while the wallet was open",
    async (_kind, answer, saved) => {
      const lapse = await lapsingLocks();
      mocks.write.mockImplementationOnce(async () => {
        lapse();
        if (!answer) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        return answer;
      });
      const { result } = renderHook(() => useMultichainBatch());
      await result.current
        .runBatch({ scope: "destination", label: "Distribute", calls: [call(1)] })
        .catch(() => undefined);
      await waitFor(() => expect(readMultichainBatches()[0]?.calls[0]).toMatchObject(saved));
    },
  );
  it("saves and sends nothing for a fresh direct batch", async () => {
    await lostLocks();
    const { result } = renderHook(() => useMultichainBatch());
    await expect(
      result.current.runBatch({ scope: "destination", label: "Distribute", calls: [call(1)] }),
    ).rejects.toThrow();
    expect(readMultichainBatches()).toEqual([]);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("read-only saved routing re-check", () => {
  const quotedDraft = () => {
    const draft = createMultichainBatch(ACCOUNT, "routing", "Routing", [retryCall(1)], "relayr");
    draft.rounds[0] = {
      ...draft.rounds[0],
      state: "quoted",
      bundleUuid: "quote",
      transactionUuids: ["tx"],
    };
    saveMultichainBatch(draft);
    return draft;
  };
  it("releases a canonically expired unpaid quote for a fresh full selection", async () => {
    const draft = quotedDraft();
    mocks.releasedUnpaid.mockReturnValue(true);
    const { result } = renderHook(() => useMultichainBatch());
    let checked;
    await act(async () => {
      checked = await result.current.recheckPendingRoutingBatch("routing");
    });
    expect(checked).toMatchObject({ id: draft.id, replaceableDraft: true, calls: draft.calls });
    expect(readMultichainBatches()[0].rounds).toEqual([{ indices: [0], state: "ready" }]);
    expect(mocks.scopeAvailable).toHaveBeenCalledWith(ACCOUNT, draft.calls[0].recoveryScope);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("keeps a live or unprovable quote and returns its explanation with saved calls", async () => {
    const draft = quotedDraft();
    mocks.scopeAvailable.mockRejectedValue(new Error("Quote remains payable"));
    const { result } = renderHook(() => useMultichainBatch());
    let checked;
    await act(async () => {
      checked = await result.current.recheckPendingRoutingBatch("routing");
    });
    expect(checked).toMatchObject({
      replaceableDraft: false,
      recoveryReason: "Quote remains payable",
      calls: draft.calls,
    });
    expect(readMultichainBatches()).toEqual([draft]);
  });
  it.each(["funding", "pending"] as const)(
    "never resets a %s round even if a scope guard resolves",
    async (state) => {
      const draft = quotedDraft();
      draft.rounds[0].state = state;
      saveMultichainBatch(draft);
      mocks.releasedUnpaid.mockReturnValue(true);
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await result.current.recheckPendingRoutingBatch("routing");
      });
      expect(readMultichainBatches()).toEqual([draft]);
    },
  );
  it("does not infer quote release from a missing recovery activity", async () => {
    const draft = quotedDraft();
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.recheckPendingRoutingBatch("routing");
    });
    expect(readMultichainBatches()).toEqual([draft]);
  });
  it("keeps unknown wallet submissions and returns a specific reason", async () => {
    const draft = quotedDraft();
    draft.calls[0].state = "submitting";
    saveMultichainBatch(draft);
    mocks.releasedUnpaid.mockReturnValue(true);
    const { result } = renderHook(() => useMultichainBatch());
    let checked;
    await act(async () => {
      checked = await result.current.recheckPendingRoutingBatch("routing");
    });
    expect(checked).toMatchObject({
      replaceableDraft: false,
      recoveryReason: expect.stringContaining("unknown result"),
    });
    expect(readMultichainBatches()).toEqual([draft]);
  });
  it("does not overwrite progress saved during canonical quote checks", async () => {
    const draft = quotedDraft();
    mocks.scopeAvailable.mockImplementation(async () => {
      draft.rounds[0].state = "funding";
      saveMultichainBatch(draft);
    });
    mocks.releasedUnpaid.mockReturnValue(true);
    const { result } = renderHook(() => useMultichainBatch());
    let checked;
    await act(async () => {
      checked = await result.current.recheckPendingRoutingBatch("routing");
    });
    expect(checked).toMatchObject({
      replaceableDraft: false,
      recoveryReason: expect.stringContaining("saved batch changed"),
    });
    expect(readMultichainBatches()).toEqual([draft]);
  });
});

describe("reviewed saved batch identity", () => {
  it.each([false, true])(
    "refuses a different saved batch without deleting it (new calls: %s)",
    (newCalls) => {
      const draft = createMultichainBatch(ACCOUNT, "routing", "Routing", [retryCall(1)], "direct");
      saveMultichainBatch(draft);
      const { result } = renderHook(() => useMultichainBatch());
      return act(async () => {
        await expect(
          result.current.runBatch({
            scope: "routing",
            label: "Routing",
            calls: newCalls ? [retryCall(1)] : [],
            expectedBatchId: "previous-reviewed-batch",
          }),
        ).rejects.toThrow("reviewed saved batch changed");
        expect(readMultichainBatches()).toEqual([draft]);
        expect(mocks.write).not.toHaveBeenCalled();
        expect(mocks.quote).not.toHaveBeenCalled();
        expect(mocks.review).not.toHaveBeenCalled();
      });
    },
  );
  it("refuses a missing reviewed batch instead of creating a fresh one", async () => {
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "routing",
          label: "Routing",
          calls: [retryCall(1)],
          expectedBatchId: "missing-reviewed-batch",
        }),
      ).rejects.toThrow("reviewed saved batch changed");
    });
    expect(readMultichainBatches()).toEqual([]);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });
});

describe("routing draft replacement", () => {
  it.each(["submitting", "submitted", "safe", "success", "skipped", "reverted"] as const)(
    "keeps %s calls in recovery",
    (state) => {
      const draft = createMultichainBatch(ACCOUNT, "draft", "Routing", [retryCall(1)], "direct");
      expect(isReplaceableRoutingDraft(draft)).toBe(true);
      draft.calls[0].state = state;
      expect(isReplaceableRoutingDraft(draft)).toBe(false);
    },
  );
  it("retains publication, Safe nonce and quote evidence even with zero handled", () => {
    const draft = createMultichainBatch(ACCOUNT, "draft", "Routing", [retryCall(1)], "direct");
    for (const evidence of [{ hash: HASH }, { safeNonce: 0 }]) {
      expect(
        isReplaceableRoutingDraft({ ...draft, calls: [{ ...draft.calls[0], ...evidence }] }),
      ).toBe(false);
    }
    for (const evidence of [
      { bundleUuid: "quoted" },
      { transactionUuids: ["tx"] },
      { state: "funding" as const },
    ]) {
      expect(
        isReplaceableRoutingDraft({ ...draft, rounds: [{ ...draft.rounds[0], ...evidence }] }),
      ).toBe(false);
    }
  });
  it("atomically replaces a legacy-scope draft and refuses a stale snapshot", () => {
    const draft = createMultichainBatch(ACCOUNT, "source", "Routing", [retryCall(1)], "direct");
    saveMultichainBatch(draft);
    const fresh = createMultichainBatch(
      ACCOUNT,
      "destination",
      "Routing",
      [retryCall(1), retryCall(10)],
      "relayr",
      draft.id,
    );
    saveMultichainBatch({ ...draft, calls: [{ ...draft.calls[0], state: "submitting" }] });
    expect(() => replaceRoutingDraft(draft, fresh)).toThrow("saved batch changed");
    expect(readMultichainBatches()[0].calls[0].state).toBe("submitting");
    saveMultichainBatch(draft);
    replaceRoutingDraft(draft, fresh);
    expect(readMultichainBatches()).toEqual([fresh]);
  });
  it("keeps an unsubmitted draft if fresh review is cancelled", async () => {
    const draft = createMultichainBatch(ACCOUNT, "source", "Routing", [retryCall(1)], "direct");
    saveMultichainBatch(draft);
    mocks.callReview.mockRejectedValue(new Error("Cancelled"));
    const { result } = renderHook(() => useMultichainBatch());
    await expect(
      result.current.runBatch({
        scope: "destination",
        label: "Routing",
        calls: [retryCall(1), retryCall(10)],
        replaceDraftId: draft.id,
      }),
    ).rejects.toThrow("Review closed");
    expect(readMultichainBatches()).toEqual([draft]);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("keeps the draft when the replacement's simulation fails before the wallet", async () => {
    const draft = createMultichainBatch(ACCOUNT, "source", "Routing", [retryCall(1)], "direct");
    saveMultichainBatch(draft);
    mocks.rawCall.mockRejectedValue(new Error("RPC unavailable"));
    const { result } = renderHook(() => useMultichainBatch());
    const input = {
      scope: "destination",
      label: "Routing",
      calls: [retryCall(1), retryCall(10)],
      replaceDraftId: draft.id,
    };
    // The replacement is saved only on its way to the wallet.
    await expect(result.current.runBatch(input)).rejects.toThrow("RPC unavailable");
    expect(readMultichainBatches()).toEqual([draft]);
    await expect(result.current.runBatch(input)).rejects.toThrow("RPC unavailable");
    expect(readMultichainBatches()).toEqual([draft]);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([{ hash: HASH }, { safeNonce: 0 }])(
    "retains ambiguous ready-call evidence when replacement is rejected: %j",
    async (evidence) => {
      const draft = createMultichainBatch(ACCOUNT, "source", "Routing", [retryCall(1)], "direct");
      Object.assign(draft.calls[0], evidence);
      saveMultichainBatch(draft);
      const { result } = renderHook(() => useMultichainBatch());
      await expect(
        result.current.runBatch({
          scope: "source",
          label: "Routing",
          calls: [retryCall(1), retryCall(10)],
          replaceDraftId: draft.id,
        }),
      ).rejects.toThrow("must be resumed");
      expect(readMultichainBatches()).toEqual([draft]);
      expect(mocks.review).not.toHaveBeenCalled();
    },
  );
  it("retains a draft when another tab adds submission evidence during review", async () => {
    const draft = createMultichainBatch(ACCOUNT, "source", "Routing", [retryCall(1)], "direct");
    saveMultichainBatch(draft);
    mocks.callReview.mockImplementation(async () => {
      draft.calls[0].state = "submitting";
      saveMultichainBatch(draft);
    });
    const { result } = renderHook(() => useMultichainBatch());
    await expect(
      result.current.runBatch({
        scope: "destination",
        label: "Routing",
        calls: [retryCall(1), retryCall(10)],
        replaceDraftId: draft.id,
      }),
    ).rejects.toThrow("saved batch changed");
    expect(readMultichainBatches()).toEqual([draft]);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not replace a draft with a lost publication response", async () => {
    const draft = createMultichainBatch(ACCOUNT, "source", "Routing", [retryCall(1)], "direct");
    saveMultichainBatch(draft);
    mocks.scopeSession.mockReturnValue(true);
    const { result } = renderHook(() => useMultichainBatch());
    expect(result.current.getPendingBatch("source")?.replaceableDraft).toBe(false);
    await expect(
      result.current.runBatch({
        scope: "source",
        label: "Routing",
        calls: [retryCall(1), retryCall(10)],
        replaceDraftId: draft.id,
      }),
    ).rejects.toThrow("saved session");
    expect(readMultichainBatches()).toEqual([draft]);
    expect(mocks.review).not.toHaveBeenCalled();
  });
});

describe("fresh review of hashless routing selections", () => {
  const gateway = "0x4a56aef5b6a5b9742abb02ca67c5a85ba183d901" as Address;
  const scope = "pending-routing:1:1";
  const routingCalls = (): MultichainCall[] =>
    Array.from({ length: 14 }, (_, index) => {
      const pendingCallId = toHex(index + 1, { size: 32 });
      const payment = {
        amount: BigInt(100 + index),
        preferAddToBalance: false,
        shouldReturnHeldFees: false,
        beneficiary: ACCOUNT,
        projectId: 1n,
        refundTo: ACCOUNT,
        sourceProjectId: 6n,
        token: "0x000000000000000000000000000000000000EEEe" as Address,
      };
      return {
        chainId: 1,
        address: gateway,
        abi: routerGatewayAbi,
        functionName: "processPendingCall",
        args: [pendingCallId, payment, "original memo", "0x"],
        gas: 6_600_000n,
        relayrMode: "raw",
        recoveryScope: `pending-routing:1:${gateway}:${pendingCallId}`,
        preconditions: [
          {
            address: gateway,
            data: encodeFunctionData({
              abi: routerGatewayAbi,
              functionName: "pendingCallCommitmentOf",
              args: [pendingCallId],
            }),
            expected: pendingRouterCommitment(payment, "original memo", "0x"),
          },
          {
            address: gateway,
            data: encodeFunctionData({
              abi: routerGatewayAbi,
              functionName: "pendingCallFailureOf",
              args: [pendingCallId],
            }),
            expected: failureSnapshot,
          },
        ],
        expectedRouterPending: {
          gateway,
          pendingCallId,
          callHash: keccak256(
            encodeAbiParameters(
              parseAbiParameters(
                "(uint256 amount,bool preferAddToBalance,bool shouldReturnHeldFees,address beneficiary,uint256 projectId,address refundTo,uint256 sourceProjectId,address token)",
              ),
              [payment],
            ),
          ),
        },
      };
    });
  const saveUnknownSelection = (savedScope = scope) => {
    const batch = createMultichainBatch(
      ACCOUNT,
      savedScope,
      "Route payments",
      routingCalls()
        .slice(0, 3)
        .map((call) => ({ ...call, relayrMode: undefined })),
      "direct",
    );
    batch.calls[0].state = "submitting";
    saveMultichainBatch(batch);
    return batch;
  };
  const inputFor = (batch: MultichainBatch) => ({
    scope,
    label: "Route payments",
    calls: routingCalls(),
    refreshBatchId: batch.id,
  });
  const recordSubmittedCall = (
    batch: MultichainBatch,
    evidence: { hash?: Hash; executionHash?: Hash; safeProposalHash?: Hash } = { hash: HASH },
  ) =>
    recordTransactionActivity({
      id: "tx:routing-submission",
      kind: evidence.hash ? "direct" : "safe",
      title: "Route payment",
      status: "failed",
      message: "Recorded before the batch received its transaction hash",
      account: batch.account,
      chainId: batch.calls[0].chainId,
      callKey: contractTransactionKey(batch.account, batch.calls[0].chainId, batch.calls[0]),
      ...evidence,
    });
  beforeEach(() => {
    const conditions = routingCalls().flatMap((call) => call.preconditions!);
    mocks.verify.mockImplementation(async ({ data }) => ({
      data: conditions.find((condition) => condition.data === data)?.expected ?? "0x",
    }));
  });

  it.each([scope, "pending-routing:1:6"])(
    "supersedes the unknown three-call journal from %s and funds all 14 current calls once",
    async (savedScope) => {
      const original = saveUnknownSelection(savedScope);
      recordTransactionActivity({
        id: original.id,
        kind: "direct",
        account: ACCOUNT,
        title: "Routing",
        status: "pending",
        message: "Wallet result unknown",
        manualVerificationRequired: true,
      });
      // An unrelated wallet's identical call must not prevent this user's recovery.
      recordSubmittedCall({ ...original, account: TARGET });
      const { result } = renderHook(() => useMultichainBatch());
      expect(result.current.getPendingBatch(savedScope)).toMatchObject({
        id: original.id,
        total: 3,
        refreshable: true,
        replaceableDraft: false,
      });
      mocks.review.mockImplementation(async () => {
        expect(readMultichainBatches()).toEqual([original]);
        expect(mocks.quote).not.toHaveBeenCalled();
        expect(mocks.pay).not.toHaveBeenCalled();
      });
      mocks.quote.mockImplementation(
        async (requests: { chainId: number; data: { to: Address; data: Hash } }[]) => {
          recordTransactionActivity({
            id: "relayr:full-routing-queue",
            kind: "relayr-bundle",
            title: "Route payments",
            status: "pending",
            message: "Awaiting funding",
            bundleUuid: "full-routing-queue",
            account: ACCOUNT,
            relayrExpectedTransactions: requests.map((request, index) => ({
              chainId: request.chainId,
              target: request.data.to,
              data: request.data.data,
              value: "0",
              transactionUuid: `routing-${index}`,
            })),
          });
          return { bundle_uuid: "full-routing-queue", payment_info: [{ chain: 1 }] };
        },
      );
      mocks.wait.mockResolvedValue({
        transactions: routingCalls().map((call, index) => ({
          tx_uuid: `routing-${index}`,
          request: { chain: call.chainId },
          status: { data: { hash: toHex(index + 100, { size: 32 }) } },
        })),
      });
      await act(async () => {
        await expect(result.current.runBatch(inputFor(original))).resolves.toMatchObject({
          status: "success",
          hashes: expect.any(Array),
        });
      });
      const saved = readMultichainBatches();
      const replacement = saved.find((batch) => batch.id !== original.id)!;
      expect(saved).toHaveLength(2);
      expect(saved.find((batch) => batch.id === original.id)).toEqual({
        ...original,
        status: "superseded",
        supersession: {
          reason: "fresh-routing-review",
          at: expect.any(Number),
          replacementId: replacement.id,
        },
      });
      expect(
        refreshTransactionActivities().find((activity) => activity.id === original.id),
      ).toMatchObject({
        status: "pending",
        manualVerificationRequired: true,
        message: expect.stringContaining("previous wallet result remains unknown"),
      });
      expect(replacement).toMatchObject({ status: "success", route: "relayr", scope });
      expect(replacement.calls).toHaveLength(14);
      expect(replacement.calls.every((call) => call.state === "success")).toBe(true);
      expect(replacement.rounds).toEqual([
        expect.objectContaining({ indices: Array.from({ length: 14 }, (_, index) => index) }),
      ]);
      expect(mocks.review).toHaveBeenCalledOnce();
      expect(mocks.review.mock.calls[0][0].calls.map((call: { data: Hash }) => call.data)).toEqual(
        replacement.calls.map((call) => call.data),
      );
      expect(mocks.quote).toHaveBeenCalledOnce();
      expect(mocks.quote.mock.calls[0][0]).toHaveLength(14);
      expect(mocks.pay).toHaveBeenCalledOnce();
      expect(mocks.write).not.toHaveBeenCalled();
      expect(findPendingBatch(ACCOUNT, savedScope)).toBeUndefined();
    },
  );

  it("accepts a same-account connector change but still refuses an unbound quote", async () => {
    const original = saveUnknownSelection(scope);
    const connector = mocks.connector;
    mocks.review.mockImplementation(async () => {
      mocks.connector = { id: "walletconnect" };
    });
    const { result } = renderHook(() => useMultichainBatch());
    try {
      await act(async () => {
        await expect(result.current.runBatch(inputFor(original))).rejects.toThrow(
          "The quote has no complete destination identity binding.",
        );
      });
    } finally {
      mocks.connector = connector;
    }
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.quote).toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps the original locked without selecting its exact ID for fresh review (fresh calls: %s)",
    async (freshCalls) => {
      const original = saveUnknownSelection();
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({
            scope,
            label: "Route payments",
            calls: freshCalls ? routingCalls() : [],
          }),
        ).rejects.toThrow();
      });
      expect(readMultichainBatches()).toEqual([original]);
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("keeps the original untouched when the fresh review is cancelled", async () => {
    const original = saveUnknownSelection();
    mocks.review.mockRejectedValue(new Error("Cancelled"));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(result.current.runBatch(inputFor(original))).rejects.toThrow("Cancelled");
    });
    expect(readMultichainBatches()).toEqual([original]);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps the original when gateway state advances during fresh review", async () => {
    const original = saveUnknownSelection();
    mocks.review.mockImplementation(async () => {
      mocks.verify.mockResolvedValue({ data: zeroHash });
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(result.current.runBatch(inputFor(original))).rejects.toThrow(
        "reviewed state changed",
      );
    });
    expect(readMultichainBatches()).toEqual([original]);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("does not supersede routing history with a noncanonical fresh call", async () => {
    const original = saveUnknownSelection();
    const fresh = routingCalls()[0];
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          ...inputFor(original),
          calls: [{ ...fresh, abi: ABI, functionName: "distribute", args: [1n] }],
        }),
      ).rejects.toThrow();
    });
    expect(readMultichainBatches()).toEqual([original]);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "transaction hash",
      change: (batch: MultichainBatch) => {
        batch.calls[0].hash = HASH;
      },
    },
    {
      label: "Safe nonce zero",
      change: (batch: MultichainBatch) => {
        batch.calls[0].safeNonce = 0;
      },
    },
    ...(["submitted", "safe", "success", "skipped", "reverted"] as const).map((state) => ({
      label: `${state} call`,
      change: (batch: MultichainBatch) => {
        batch.calls[1].state = state;
      },
    })),
    {
      label: "Relayr transport",
      change: (batch: MultichainBatch) => {
        batch.route = "relayr";
      },
    },
    {
      label: "funding round",
      change: (batch: MultichainBatch) => {
        batch.rounds[0].state = "funding";
      },
    },
    {
      label: "bundle identity",
      change: (batch: MultichainBatch) => {
        batch.rounds[0].bundleUuid = "existing-quote";
      },
    },
    {
      label: "transaction identities",
      change: (batch: MultichainBatch) => {
        batch.rounds[0].transactionUuids = ["existing-transaction"];
      },
    },
    {
      label: "non-routing calldata",
      change: (batch: MultichainBatch) => {
        batch.calls[0].data = encodeFunctionData({
          abi: ABI,
          functionName: "distribute",
          args: [1n],
        });
      },
    },
  ])("refuses refresh when the saved selection contains $label", async ({ change }) => {
    const original = saveUnknownSelection();
    change(original);
    saveMultichainBatch(original);
    const { result } = renderHook(() => useMultichainBatch());
    expect(result.current.getPendingBatch(scope)?.refreshable).toBe(false);
    await act(async () => {
      await expect(result.current.runBatch(inputFor(original))).rejects.toThrow();
    });
    expect(readMultichainBatches()).toEqual([original]);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["snapshot", "account", "Relayr session", "transaction activity"] as const)(
    "refuses replacement when the %s changes during review",
    async (changed) => {
      const original = saveUnknownSelection();
      mocks.review.mockImplementation(async () => {
        if (changed === "snapshot") {
          original.calls[0].hash = HASH;
          saveMultichainBatch(original);
        } else if (changed === "account") mocks.account = TARGET;
        else if (changed === "transaction activity") recordSubmittedCall(original);
        else mocks.scopeSession.mockReturnValue(true);
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(result.current.runBatch(inputFor(original))).rejects.toThrow(
          /changed|saved session|submission or recovery evidence/i,
        );
      });
      expect(readMultichainBatches()).toEqual([original]);
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each([{ hash: HASH }, { executionHash: HASH }, { safeProposalHash: HASH }])(
    "retains hashless batches when transaction activity records submission evidence: %j",
    async (evidence) => {
      const original = saveUnknownSelection();
      recordSubmittedCall(original, evidence);
      const { result } = renderHook(() => useMultichainBatch());
      expect(result.current.getPendingBatch(scope)?.refreshable).toBe(false);
      await act(async () => {
        await expect(result.current.runBatch(inputFor(original))).rejects.toThrow();
      });
      expect(readMultichainBatches()).toEqual([original]);
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: "success", manual: false, offset: -1, eligible: true },
    { status: "failed", manual: false, offset: -1, eligible: true },
    { status: "success", manual: false, offset: 0, eligible: false },
    { status: "failed", manual: false, offset: 1, eligible: false },
    { status: "pending", manual: false, offset: -1, eligible: false },
    { status: "submitted", manual: false, offset: -1, eligible: false },
    { status: "safe-proposed", manual: false, offset: -1, eligible: false },
    { status: "failed", manual: true, offset: -1, eligible: false },
    { status: "success", manual: undefined, offset: -1, eligible: false },
  ] as const)(
    "distinguishes completed earlier attempts from unresolved or contemporaneous evidence: $status, manual=$manual, offset=$offset",
    async ({ status, manual, offset, eligible }) => {
      const original = saveUnknownSelection();
      recordTransactionActivity({
        ...recordSubmittedCall(original),
        status,
        manualVerificationRequired: manual,
        createdAt: original.createdAt - 100,
        updatedAt: original.createdAt + offset,
      });
      const { result } = renderHook(() => useMultichainBatch());
      expect(result.current.getPendingBatch(scope)?.refreshable).toBe(eligible);
      if (!eligible) {
        await act(async () => {
          await expect(result.current.runBatch(inputFor(original))).rejects.toThrow();
        });
      }
      expect(readMultichainBatches()).toEqual([original]);
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("refuses refresh when the transaction activity evidence cannot be read", async () => {
    const original = saveUnknownSelection();
    localStorage.setItem("revnet:transaction-activities:v1", "invalid JSON");
    const { result } = renderHook(() => useMultichainBatch());
    expect(result.current.getPendingBatch(scope)?.refreshable).toBe(false);
    await act(async () => {
      await expect(result.current.runBatch(inputFor(original))).rejects.toThrow();
    });
    expect(readMultichainBatches()).toEqual([original]);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses an existing held Relayr session before fresh review", async () => {
    const original = saveUnknownSelection();
    mocks.scopeSession.mockReturnValue(true);
    const { result } = renderHook(() => useMultichainBatch());
    expect(result.current.getPendingBatch(scope)?.refreshable).toBe(false);
    await act(async () => {
      await expect(result.current.runBatch(inputFor(original))).rejects.toThrow();
    });
    expect(readMultichainBatches()).toEqual([original]);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it.each(["wrong ID", "draft replacement", "saved review"] as const)(
    "refuses conflicting fresh-review identity: %s",
    async (option) => {
      const original = saveUnknownSelection();
      const input = {
        ...inputFor(original),
        ...(option === "wrong ID" ? { refreshBatchId: "other-saved-batch" } : {}),
        ...(option === "draft replacement" ? { replaceDraftId: original.id } : {}),
        ...(option === "saved review" ? { expectedBatchId: original.id } : {}),
      };
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(result.current.runBatch(input)).rejects.toThrow();
      });
      expect(readMultichainBatches()).toEqual([original]);
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
    },
  );
});

describe("reviewed selected-call orchestration", () => {
  it("verifies a retained-again attempt and frees its journal without claiming settlement", async () => {
    const gas = 6_600_000n;
    const retry = { ...retryCall(1), gas };
    mocks.receipt.mockResolvedValue({
      transactionHash: HASH,
      status: "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [
        {
          address: TARGET,
          topics: encodeEventTopics({
            abi: routerGatewayAbi,
            eventName: "JBRouterTerminalGateway_RecordTerminalCallFailure",
            args: { id: HASH, errorHash: HASH },
          }),
          data: encodeAbiParameters(parseAbiParameters("uint32,uint256,address"), [
            1,
            1000n,
            ACCOUNT,
          ]),
        },
      ],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "retry", label: "Route fee", calls: [retry] }),
      ).resolves.toMatchObject({ status: "success" });
    });
    expect(mocks.callReview).toHaveBeenCalledWith([expect.objectContaining({ gas })]);
    expect(mocks.rawCall).toHaveBeenCalledWith({
      method: "eth_call",
      params: [expect.objectContaining({ from: ACCOUNT, to: TARGET, gas: "0x64b540" }), "latest"],
    });
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ gas }));
    expect(mocks.estimate).not.toHaveBeenCalled();
    expect(findPendingBatch(ACCOUNT, "retry")).toBeUndefined();
    expect(readMultichainBatches()[0].calls[0].expectedRouterPending).toEqual(
      retry.expectedRouterPending,
    );
    expect(() =>
      createMultichainBatch(ACCOUNT, "retry", "Route fee", [retry], "direct"),
    ).not.toThrow();
  });

  it("keeps an unverified gateway receipt locked instead of replaying it", async () => {
    const retry = retryCall(1);
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "retry", label: "Route fee", calls: [retry] }),
      ).rejects.toThrow(/no unique verified/);
      await expect(
        result.current.runBatch({ scope: "retry", label: "Route fee", calls: [] }),
      ).rejects.toThrow(/no unique verified/);
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(findPendingBatch(ACCOUNT, "retry")?.calls[0].state).toBe("submitted");
  });

  it("finishes a canonical reverted EOA routing attempt without replaying it, then continues the batch", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "reverted-routing",
      "Route fees",
      [retryCall(1), call(10)],
      "direct",
    );
    batch.calls[0].hash = HASH;
    batch.calls[0].state = "submitted";
    saveMultichainBatch(batch);
    const activityId = `tx:1:${HASH.toLowerCase()}`;
    recordTransactionActivity({
      id: activityId,
      kind: "direct",
      title: "Route fee",
      status: "pending",
      message: "Awaiting verification",
      manualVerificationRequired: true,
      hash: HASH,
      chainId: 1,
      account: ACCOUNT,
    });
    mocks.receipt.mockResolvedValueOnce({
      transactionHash: HASH,
      status: "reverted",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "reverted-routing", label: "Route fees", calls: [] }),
      ).resolves.toEqual({
        status: "success",
        hashes: [{ chainId: 10, hash: HASH, callIndex: 1 }],
        revertedHashes: [{ chainId: 1, hash: HASH, callIndex: 0 }],
      });
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 10 }));
    expect(readMultichainBatches()[0].calls.map((row) => row.state)).toEqual([
      "reverted",
      "success",
    ]);
    expect(refreshTransactionActivities().find((row) => row.id === activityId)).toMatchObject({
      status: "failed",
      manualVerificationRequired: false,
    });
    expect(findPendingBatch(ACCOUNT, "reverted-routing")).toBeUndefined();
    expect(() =>
      createMultichainBatch(ACCOUNT, "reverted-routing", "Route fees", [retryCall(1)], "direct"),
    ).not.toThrow();
  });

  it.each(["call", "block"])(
    "keeps a reverted routing receipt locked when its %s identity differs",
    async (mismatch) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "reverted-mismatch",
        "Route fee",
        [retryCall(1)],
        "direct",
      );
      batch.calls[0].hash = HASH;
      batch.calls[0].state = "submitted";
      saveMultichainBatch(batch);
      mocks.receipt.mockResolvedValue({
        transactionHash: HASH,
        status: "reverted",
        blockHash: HASH,
        blockNumber: 1n,
        logs: [],
      });
      mocks.transaction.mockResolvedValue({
        hash: HASH,
        from: ACCOUNT,
        to: TARGET,
        value: 0n,
        blockNumber: 1n,
        blockHash: mismatch === "block" ? zeroHash : HASH,
        input: mismatch === "call" ? "0x1234" : batch.calls[0].data,
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "reverted-mismatch", label: "Route fee", calls: [] }),
        ).rejects.toThrow();
      });
      expect(readMultichainBatches()[0].calls[0].state).toBe("submitted");
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each(["valid", "safe", "hash", "call", "unavailable", "text nonce"])(
    "archives an obsolete Safe proposal only after exact authentication: %s",
    async (mode) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "obsolete-safe",
        "Route fee",
        [retryCall(1)],
        "direct",
      );
      const proposal = safeProposalFor(
        { to: TARGET, data: mode === "call" ? "0x1234" : batch.calls[0].data },
        7,
      );
      const proposalHash = safeTransactionHash(1, ACCOUNT, proposal);
      batch.calls[0].hash = proposalHash;
      batch.calls[0].state = "safe";
      saveMultichainBatch(batch);
      recordTransactionActivity({
        id: `tx:1:${proposalHash}`,
        kind: "safe",
        title: "Route fee",
        status: "safe-proposed",
        message: "Awaiting execution",
        safeProposalHash: proposalHash,
        chainId: 1,
        account: ACCOUNT,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              ...proposal,
              safe: mode === "safe" ? TARGET : ACCOUNT,
              // A text nonce hashes the same, but the service never writes one.
              nonce: mode === "hash" ? 8 : mode === "text nonce" ? "7" : 7,
            }),
            { status: mode === "unavailable" ? 503 : 200 },
          ),
        ),
      );
      mocks.verify.mockResolvedValue({ data: zeroHash });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        const attempt = result.current.runBatch({
          scope: "obsolete-safe",
          label: "Route fee",
          calls: [],
        });
        if (mode === "valid") {
          await expect(attempt).resolves.toEqual({
            status: "success",
            hashes: [],
            obsoleteSafeProposals: [
              { chainId: 1, safe: ACCOUNT, hash: proposalHash, nonce: 7, callIndex: 0 },
            ],
          });
        } else await expect(attempt).rejects.toThrow();
      });
      expect(readMultichainBatches()[0].calls[0]).toMatchObject(
        mode === "valid"
          ? { state: "skipped", hash: proposalHash, skipReason: "obsolete-safe", safeNonce: 7 }
          : { state: "safe", hash: proposalHash },
      );
      if (mode === "valid") {
        expect(
          refreshTransactionActivities().find((row) => row.safeProposalHash === proposalHash),
        ).toMatchObject({ obsoleteSafeNonce: 7, manualVerificationRequired: false });
        expect(findPendingBatch(ACCOUNT, "obsolete-safe")).toBeUndefined();
      }
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  describe("Safe execution verification", () => {
    const EXECUTION = `0x${"ef".repeat(32)}` as Hash;
    const SAFE_13_ABI = parseAbi(["event ExecutionSuccess(bytes32 txHash,uint256 payment)"]);

    /** A saved Safe call whose execution was reported; `reply` is what the wallet answered. */
    function savedSafeCall(reply: "at-once" | "proposal") {
      const batch = createMultichainBatch(
        ACCOUNT,
        "safe-verify",
        "Distribute",
        [call(1)],
        "direct",
      );
      const data = batch.calls[0].data;
      const safeTxHash = safeTransactionHash(1, ACCOUNT, safeProposalFor({ to: TARGET, data }, 7));
      // Over WalletConnect, Safe{Wallet} answers with the execution itself when
      // the owner executes at once.
      const replyHash = reply === "at-once" ? EXECUTION : safeTxHash;
      batch.calls[0].hash = replyHash;
      batch.calls[0].state = "safe";
      saveMultichainBatch(batch);
      recordTransactionActivity({
        id: `tx:1:${replyHash}`,
        kind: "safe",
        title: "Distribute",
        status: "pending",
        message: "Safe execution was reported.",
        safeProposalHash: replyHash,
        executionHash: EXECUTION,
        manualVerificationRequired: true,
        chainId: 1,
        account: ACCOUNT,
      });
      mocks.transaction.mockResolvedValue({
        hash: EXECUTION,
        from: TARGET,
        to: ACCOUNT,
        input: encodeFunctionData({
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          args: [TARGET, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"],
        }),
        value: 0n,
        blockHash: HASH,
        blockNumber: 1n,
      });
      return safeTxHash;
    }

    function receiptWith(logs: Array<{ address: Address; topics: Hash[]; data: Hash }>) {
      mocks.receipt.mockResolvedValue({
        transactionHash: EXECUTION,
        status: "success",
        blockHash: HASH,
        blockNumber: 1n,
        logs,
      });
    }

    /** Resumes the saved batch and checks how the attempt settles. */
    async function resume(settles: (attempt: Promise<unknown>) => Promise<unknown>) {
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await settles(
          result.current.runBatch({ scope: "safe-verify", label: "Distribute", calls: [] }),
        );
      });
    }

    it.each([
      ["an execution Safe{Wallet} sent at once", "at-once", "1.4"],
      ["a Safe 1.4 proposal", "proposal", "1.4"],
      ["a Safe 1.3 proposal", "proposal", "1.3"],
    ] as const)("verifies %s from its Safe's ExecutionSuccess", async (_name, reply, layout) => {
      const safeTxHash = savedSafeCall(reply);
      receiptWith([
        layout === "1.4"
          ? {
              address: ACCOUNT,
              topics: encodeEventTopics({
                abi: SAFE_EXEC_ABI,
                eventName: "ExecutionSuccess",
                args: { txHash: safeTxHash },
              }) as Hash[],
              data: encodeAbiParameters(parseAbiParameters("uint256"), [0n]),
            }
          : {
              address: ACCOUNT,
              topics: encodeEventTopics({
                abi: SAFE_13_ABI,
                eventName: "ExecutionSuccess",
              }) as Hash[],
              data: encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [safeTxHash, 0n]),
            },
      ]);

      await resume((attempt) => expect(attempt).resolves.toMatchObject({ status: "success" }));
      expect(readMultichainBatches()[0].calls[0].state).toBe("success");
      expect(mocks.write).not.toHaveBeenCalled();
    });

    it("keeps a proposal unverified when its Safe's ExecutionSuccess names another", async () => {
      savedSafeCall("proposal");
      receiptWith([
        {
          address: ACCOUNT,
          topics: encodeEventTopics({
            abi: SAFE_EXEC_ABI,
            eventName: "ExecutionSuccess",
            args: { txHash: zeroHash },
          }) as Hash[],
          data: encodeAbiParameters(parseAbiParameters("uint256"), [0n]),
        },
      ]);

      await resume((attempt) => expect(attempt).rejects.toThrow("has not executed successfully"));
      expect(readMultichainBatches()[0].calls[0].state).toBe("safe");
    });

    it("keeps an at-once execution unverified without its Safe's ExecutionSuccess", async () => {
      savedSafeCall("at-once");
      // Another contract's event with the same signature proves nothing.
      receiptWith([
        {
          address: TARGET,
          topics: encodeEventTopics({
            abi: SAFE_EXEC_ABI,
            eventName: "ExecutionSuccess",
            args: { txHash: zeroHash },
          }) as Hash[],
          data: encodeAbiParameters(parseAbiParameters("uint256"), [0n]),
        },
      ]);

      await resume((attempt) => expect(attempt).rejects.toThrow("has not executed successfully"));
      expect(readMultichainBatches()[0].calls[0].state).toBe("safe");
      expect(mocks.write).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["direct", "resolved-externally"],
    ["direct", "retried-externally"],
  ] as const)(
    "resumes %s by skipping only an unpublished fee that was %s",
    async (route, reason) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "keeper-race",
        "Route fees",
        [call(1), retryCall(1)],
        route,
      );
      batch.calls[0].state = "success";
      batch.calls[0].hash = HASH;
      batch.rounds[0].state = "success";
      saveMultichainBatch(batch);
      const advancedFailure = encodeFunctionResult({
        abi: routerGatewayAbi,
        functionName: "pendingCallFailureOf",
        result: {
          errorHash: HASH,
          count: 1,
          lastFailureAt: 1000,
          highestGasLimit: 5_000_000n,
        },
      });
      mocks.verify.mockImplementation(async ({ data }) => ({
        data:
          data === commitmentData
            ? reason === "resolved-externally"
              ? zeroHash
              : HASH
            : advancedFailure,
      }));
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "keeper-race", label: "Route fees", calls: [] }),
        ).resolves.toEqual({
          status: "success",
          hashes: [{ chainId: 1, hash: HASH, callIndex: 0 }],
        });
      });
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(readMultichainBatches()[0].calls[1]).toMatchObject({
        state: "skipped",
        skipReason: reason,
      });
      expect(findPendingBatch(ACCOUNT, "keeper-race")).toBeUndefined();
    },
  );

  it("does not skip a ready call when its Relayr publication response was lost", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "lost-quote",
      "Route fees",
      [retryCall(1)],
      "direct",
    );
    saveMultichainBatch(batch);
    mocks.scopeAvailable.mockImplementation(() => {
      throw new Error("Authorization already published");
    });
    mocks.verify.mockResolvedValue({ data: zeroHash });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "lost-quote", label: "Route fees", calls: [] }),
      ).rejects.toThrow(/already published/);
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].calls[0].state).toBe("ready");
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it.each(["submitting", "submitted", "safe"] as const)(
    "does not skip a %s call even if a keeper advanced it",
    async (state) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "submitted-race",
        "Route fees",
        [retryCall(1)],
        "direct",
      );
      batch.calls[0].state = state;
      if (state !== "submitting") batch.calls[0].hash = HASH;
      saveMultichainBatch(batch);
      mocks.verify.mockResolvedValue({ data: zeroHash });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "submitted-race", label: "Route fees", calls: [] }),
        ).rejects.toThrow();
      });
      expect(readMultichainBatches()[0].calls[0].state).toBe(state);
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each([16_777_216n, 6_600_000n])(
    "uses direct transactions for every routing retry at %s gas",
    async (gas) => {
      mocks.receipt.mockResolvedValue({
        transactionHash: HASH,
        status: "reverted",
        blockHash: HASH,
        blockNumber: 1n,
        logs: [],
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await result.current.runBatch({
          scope: "large-retry",
          label: "Route fees",
          calls: [1, 10].map((chainId) => ({ ...retryCall(chainId), gas })),
        });
      });
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.write).toHaveBeenCalledTimes(2);
      expect(readMultichainBatches()[0].route).toBe("direct");
      expect(readMultichainBatches()[0].calls.every((row) => row.gas === gas)).toBe(true);
    },
  );

  it("does not follow token-controlled OffchainLookup URLs or submit after a raw preflight fails", async () => {
    const remote = vi.fn();
    vi.stubGlobal("fetch", remote);
    mocks.rawCall.mockRejectedValue(new Error("OffchainLookup: https://attacker.invalid/lookup"));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "offchain-retry",
          label: "Route payment",
          calls: [retryCall(1)],
        }),
      ).rejects.toThrow(/OffchainLookup/);
    });
    expect(mocks.rawCall).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_call" }));
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

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

  it("offers the Relayr fee on the chain the batch started on after signing switches it", async () => {
    mocks.chainId = 11155420;
    const quote = mocks.quote.getMockImplementation()!;
    mocks.quote.mockImplementation(async (requests: MultichainCall[]) => {
      mocks.chainId = 84532;
      return quote(requests);
    });
    mocks.choose.mockResolvedValue({ chain: 11155111 });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.runBatch({
        scope: "testnet-start-chain",
        label: "Distribute",
        calls: [call(11155111), call(84532)],
      });
    });
    expect(mocks.choose).toHaveBeenCalledExactlyOnceWith([{ chain: 11155111 }], 11155420);
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

  it("reports saved mixed outcomes when recovery finishes an already handled batch", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "handled-routing",
      "Route payments",
      [1, 8453].map((chainId) => ({ ...retryCall(chainId), relayrMode: "raw" as const })),
      "relayr",
    );
    batch.calls[0].state = "success";
    batch.calls[0].hash = HASH;
    batch.calls[1].state = "reverted";
    batch.calls[1].hash = HASH;
    batch.rounds.forEach((round) => (round.state = "success"));
    saveMultichainBatch(batch);
    const onCallProgress = vi.fn();
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "handled-routing",
          label: "Route payments",
          calls: [],
          onCallProgress,
        }),
      ).resolves.toMatchObject({ status: "success" });
    });
    expect(onCallProgress).toHaveBeenLastCalledWith([
      { status: "confirmed", hash: HASH },
      { status: "reverted", hash: HASH },
    ]);
    expect(mocks.wait).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
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
  it("wallet-action:multichain-batch executes all selected allocations, with one chosen funding payment for each explicit round", async () => {
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
  describe("raw pending-payment Relayr batches", () => {
    const calls = () =>
      [1, 1, 10].map((chainId, index) => ({
        ...retryCall(chainId),
        args: [BigInt(index + 1)],
        recoveryScope: `pending:${chainId}:${index}`,
        relayrMode: "raw" as const,
      }));
    const hashes = [HASH, `0x${"cd".repeat(32)}`, `0x${"ef".repeat(32)}`] as Hash[];
    function quotedIdentities() {
      mocks.quote.mockImplementation(
        async (requests: { chainId: number; data: { to: Address; data: Hash } }[]) => {
          recordTransactionActivity({
            id: "relayr:pending-bundle",
            kind: "relayr-bundle",
            title: "Route pending payments",
            status: "pending",
            message: "Awaiting funding",
            bundleUuid: "pending-bundle",
            account: ACCOUNT,
            relayrExpectedTransactions: requests.map((request, index) => ({
              chainId: request.chainId,
              target: request.data.to,
              data: request.data.data,
              value: "0",
              transactionUuid: `pending-${index}`,
            })),
          });
          return { bundle_uuid: "pending-bundle", payment_info: [{ chain: 1 }] };
        },
      );
      mocks.wait.mockResolvedValue({
        // Return the same-chain transactions in reverse order to expose chain-only matching.
        transactions: [2, 1, 0].map((index) => ({
          tx_uuid: `pending-${index}`,
          request: { chain: index === 2 ? 10 : 1 },
          status: { data: { hash: hashes[index] } },
        })),
      });
    }
    it("funds all same-chain and cross-chain retries once and binds each hash by transaction identity", async () => {
      quotedIdentities();
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({
            scope: "pending-all",
            label: "Route payments",
            calls: calls(),
          }),
        ).resolves.toEqual({
          status: "success",
          hashes: hashes.map((hash, callIndex) => ({
            hash,
            callIndex,
            chainId: callIndex === 2 ? 10 : 1,
          })),
        });
      });
      expect(mocks.review).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Retry payments",
          description: "Pay network fees once for this batch. Each payment has its own result.",
        }),
      );
      expect(mocks.quote).toHaveBeenCalledOnce();
      expect(mocks.quote.mock.calls[0][0].map((row: { chainId: number }) => row.chainId)).toEqual([
        1, 1, 10,
      ]);
      expect(mocks.pay).toHaveBeenCalledOnce();
      expect(mocks.write).not.toHaveBeenCalled();
      expect(readMultichainBatches()[0].rounds).toHaveLength(1);
    });
    it("maps live 14-call results by UUID without treating progress as durable completion or paying again", async () => {
      quotedIdentities();
      const queued = Array.from({ length: 14 }, (_, index) => ({
        ...retryCall(1),
        args: [BigInt(index + 1)],
        recoveryScope: `pending:1:${index}`,
        relayrMode: "raw" as const,
      }));
      const complete = Promise.withResolvers<void>();
      const updates = vi.fn();
      const progress = vi.fn();
      let notify!: (results: readonly RelayrDestinationProgress[]) => void;
      const resultFor = (index: number, status: RelayrDestinationProgress["status"]) => ({
        transactionUuid: `pending-${index}`,
        status,
        ...(status === "pending" ? {} : { hash: toHex(index + 1, { size: 32 }) }),
      });
      mocks.wait.mockImplementation(async (_uuid, _update, onResults) => {
        notify = onResults;
        await complete.promise;
        const activity = refreshTransactionActivities().find(
          (row) => row.bundleUuid === "pending-bundle",
        )!;
        updateTransactionActivity(activity.id, {
          relayrExpectedTransactions: activity.relayrExpectedTransactions!.map((row, index) => ({
            ...row,
            receiptStatus: index === 2 ? "reverted" : "success",
          })),
        });
        return {
          transactions: queued
            .map((_, index) => ({
              tx_uuid: `pending-${index}`,
              request: { chain: 1 },
              status: { data: { hash: toHex(index + 1, { size: 32 }) } },
            }))
            .reverse(),
        };
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        const running = result.current.runBatch({
          scope: "pending-all",
          label: "Route payments",
          calls: queued,
          onProgress: progress,
          onCallProgress: updates,
        });
        await vi.waitFor(() => expect(mocks.wait).toHaveBeenCalledOnce());
        notify(
          queued.map((_, index) => resultFor(index, index < 2 ? "pending" : "submitted")).reverse(),
        );
        expect(progress).toHaveBeenLastCalledWith("12 of 14 attempts submitted. Checking results…");
        expect(updates.mock.lastCall![0].map((row: { status: string }) => row.status)).toEqual([
          "pending",
          "pending",
          ...Array(12).fill("submitted"),
        ]);
        notify(
          queued
            .map((_, index) =>
              resultFor(
                index,
                index === 0
                  ? "pending"
                  : index === 1
                    ? "submitted"
                    : index === 2
                      ? "reverted"
                      : "confirmed",
              ),
            )
            .reverse(),
        );
        expect(progress).toHaveBeenLastCalledWith(
          "12 of 14 attempts checked. 2 remaining. 1 reverted.",
        );
        expect(updates.mock.lastCall![0][2]).toEqual({
          status: "reverted",
          hash: toHex(3, { size: 32 }),
        });
        // These are display snapshots; the paid round is still unresolved and cannot fund again.
        expect(readMultichainBatches()[0].rounds[0].state).toBe("pending");
        expect(readMultichainBatches()[0].calls.every((call) => call.state === "ready")).toBe(true);
        expect(mocks.quote).toHaveBeenCalledOnce();
        expect(mocks.pay).toHaveBeenCalledOnce();
        complete.resolve();
        await expect(running).resolves.toMatchObject({ status: "success" });
      });
      expect(updates.mock.lastCall![0].map((row: { status: string }) => row.status)).toEqual([
        "confirmed",
        "confirmed",
        "reverted",
        ...Array(11).fill("confirmed"),
      ]);
      expect(mocks.pay).toHaveBeenCalledOnce();
    });
    it("reports each deferred quote and payment handoff without paying before a funding choice", async () => {
      quotedIdentities();
      const quoted = mocks.quote.getMockImplementation()!;
      const quoteReady = Promise.withResolvers<void>();
      const paymentChosen = Promise.withResolvers<void>();
      const paymentSent = Promise.withResolvers<void>();
      const destinationsDone = Promise.withResolvers<void>();
      const progress = vi.fn();
      const beforePayment = vi.fn();
      mocks.quote.mockImplementation(async (requests, options) => {
        options.onMessage("Requesting the network-fee quote…");
        await quoteReady.promise;
        return quoted(requests);
      });
      mocks.choose.mockImplementation(async () => {
        await paymentChosen.promise;
        return { chain: 1 };
      });
      mocks.pay.mockImplementation(async (_payment, options) => {
        options.onMessage("Confirm the network-fee payment in your wallet.");
        await paymentSent.promise;
        return HASH;
      });
      const settled = mocks.wait.getMockImplementation()!;
      mocks.wait.mockImplementation(async (...args) => {
        await destinationsDone.promise;
        return settled(...args);
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        const running = result.current.runBatch({
          scope: "pending-all",
          label: "Route payments",
          calls: calls(),
          onProgress: progress,
          onBeforePayment: beforePayment,
        });
        await vi.waitFor(() =>
          expect(progress).toHaveBeenLastCalledWith("Requesting the network-fee quote…"),
        );
        expect(mocks.choose).not.toHaveBeenCalled();
        expect(mocks.pay).not.toHaveBeenCalled();
        expect(beforePayment).not.toHaveBeenCalled();
        quoteReady.resolve();
        await vi.waitFor(() =>
          expect(progress).toHaveBeenLastCalledWith("Choose a network for the fee payment."),
        );
        expect(mocks.pay).not.toHaveBeenCalled();
        expect(beforePayment).toHaveBeenCalledOnce();
        paymentChosen.resolve();
        await vi.waitFor(() =>
          expect(progress).toHaveBeenLastCalledWith(
            "Confirm the network-fee payment in your wallet.",
          ),
        );
        expect(mocks.wait).not.toHaveBeenCalled();
        paymentSent.resolve();
        await vi.waitFor(() =>
          expect(progress).toHaveBeenLastCalledWith("Checking payment and 3 transaction results…"),
        );
        destinationsDone.resolve();
        await expect(running).resolves.toMatchObject({ status: "success" });
      });
      expect(mocks.pay).toHaveBeenCalledOnce();
    });
    it("does not offer or send payment when a quote resolves after preparation was cancelled", async () => {
      quotedIdentities();
      const quoted = mocks.quote.getMockImplementation()!;
      const quoteReady = Promise.withResolvers<void>();
      const controller = new AbortController();
      const beforePayment = vi.fn();
      mocks.quote.mockImplementation(async (requests, options) => {
        expect(options.signal).toBe(controller.signal);
        await quoteReady.promise;
        return quoted(requests);
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        const running = result.current.runBatch({
          scope: "pending-all",
          label: "Route payments",
          calls: calls(),
          signal: controller.signal,
          onBeforePayment: beforePayment,
        });
        const cancelled = expect(running).rejects.toMatchObject({ name: "AbortError" });
        await vi.waitFor(() => expect(mocks.quote).toHaveBeenCalledOnce());
        controller.abort();
        quoteReady.resolve();
        await cancelled;
      });
      expect(beforePayment).not.toHaveBeenCalled();
      expect(mocks.choose).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(mocks.wait).not.toHaveBeenCalled();
    });
    it("drains concurrent source checks and never requests a quote after a failed check", async () => {
      const checked = Promise.withResolvers<void>();
      let callsStarted = 0;
      mocks.verify.mockImplementation(async () => {
        callsStarted += 1;
        if (callsStarted === 1) throw new Error("source RPC unavailable");
        await checked.promise;
        return { data: HASH };
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        let finished = false;
        const running = result.current
          .runBatch({ scope: "pending-all", label: "Route payments", calls: calls() })
          .finally(() => {
            finished = true;
          });
        const rejected = expect(running).rejects.toThrow("source RPC unavailable");
        await vi.waitFor(() => expect(callsStarted).toBe(3));
        expect(finished).toBe(false);
        expect(mocks.quote).not.toHaveBeenCalled();
        checked.resolve();
        await rejected;
      });
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(readMultichainBatches()).toEqual([]);
    });
    it("resumes the original paid pending-payment entry without another quote or payment", async () => {
      quotedIdentities();
      mocks.wait.mockRejectedValueOnce(new Error("destination RPC unavailable"));
      const first = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          first.result.current.runBatch({
            scope: "pending-all",
            label: "Route payments",
            calls: calls(),
          }),
        ).rejects.toThrow(/RPC unavailable/);
      });
      first.unmount();
      const second = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          second.result.current.runBatch({
            scope: "pending-all",
            label: "Route payments",
            calls: [],
          }),
        ).resolves.toMatchObject({ status: "success" });
      });
      expect(mocks.quote).toHaveBeenCalledOnce();
      expect(mocks.pay).toHaveBeenCalledOnce();
      expect(readMultichainBatches()[0].calls.map((row) => row.hash)).toEqual(hashes);
    });
    it("consumes a reverted attempt alongside successful calls instead of leaving it payable", async () => {
      quotedIdentities();
      const settled = mocks.wait.getMockImplementation()!;
      mocks.wait.mockImplementation(async (...args) => {
        const response = await settled(...args);
        const activity = refreshTransactionActivities().find(
          (row) => row.bundleUuid === "pending-bundle",
        )!;
        updateTransactionActivity(activity.id, {
          relayrExpectedTransactions: activity.relayrExpectedTransactions!.map((row, index) => ({
            ...row,
            receiptStatus: index === 1 ? "reverted" : "success",
          })),
        });
        return response;
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({
            scope: "pending-all",
            label: "Route payments",
            calls: calls(),
          }),
        ).resolves.toMatchObject({ status: "success" });
      });
      expect(readMultichainBatches()[0].calls.map((row) => row.state)).toEqual([
        "success",
        "reverted",
        "success",
      ]);
      expect(findPendingBatch(ACCOUNT, "pending-all")).toBeUndefined();
      expect(mocks.pay).toHaveBeenCalledOnce();
    });
    it("refuses funding repeated-chain calls without complete quote identities", async () => {
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({
            scope: "pending-all",
            label: "Route payments",
            calls: calls(),
          }),
        ).rejects.toThrow(/identity binding/);
      });
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(mocks.choose).not.toHaveBeenCalled();
    });
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
  it.each([{ code: 4001 }, { name: "UserRejectedRequestError", cause: { code: 4001 } }])(
    "releases a definitely rejected wallet attempt using the SDK classifier: %j",
    async (rejection) => {
      mocks.write.mockRejectedValue(rejection);
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "one", label: "Distribute", calls: [call(1)] }),
        ).rejects.toMatchObject({ failure: rejection });
        expect(readMultichainBatches()).toEqual([]);
        expect(mocks.write).toHaveBeenCalledOnce();
      });
    },
  );
  // Only EIP-1193 4001 says nothing was sent; a rejection by name alone stays held.
  it.each([
    { name: "TransactionExecutionError" },
    { code: -32000 },
    { name: "UserRejectedRequestErrorExtra", code: "4001" },
    { name: "UserRejectedRequestError" },
    { cause: { name: "UserRejectedRequestError" } },
  ])("keeps an ambiguous wallet attempt using the SDK classifier: %j", async (failure) => {
    mocks.write.mockRejectedValue(failure);
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "one", label: "Distribute", calls: [call(1)] }),
      ).rejects.toMatchObject({ failure });
      expect(readMultichainBatches()[0].calls[0]).toMatchObject({ state: "submitting" });
      expect(mocks.write).toHaveBeenCalledOnce();
    });
  });
  it("resumes a call refused after persistence without leaving an unknown wallet submission", async () => {
    const existing = createMultichainBatch(
      ACCOUNT,
      "one",
      "Distribute",
      [call(1), call(1)],
      "direct",
    );
    existing.calls[0].state = "success";
    existing.calls[0].hash = HASH;
    saveMultichainBatch(existing);
    mocks.finalGuard.mockImplementationOnce(() => {
      throw new Error("The wallet chain changed");
    });
    const first = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        first.result.current.runBatch({ scope: "one", label: "Distribute", calls: [] }),
      ).rejects.toThrow(/chain changed/);
    });
    expect(readMultichainBatches()[0].calls.map((call) => call.state)).toEqual([
      "success",
      "ready",
    ]);
    expect(mocks.write).not.toHaveBeenCalled();
    first.unmount();
    const second = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        second.result.current.runBatch({ scope: "one", label: "Distribute", calls: [] }),
      ).resolves.toMatchObject({ status: "success" });
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
  it("reviews a fresh EOA batch once and sends each call it showed without a second review", async () => {
    // A canonical reverted routing receipt settles its call without replay.
    mocks.receipt.mockResolvedValue({
      transactionHash: HASH,
      status: "reverted",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.runBatch({
        scope: "one-review",
        label: "Route fees",
        calls: [1, 10].map((chainId) => retryCall(chainId)),
      });
    });
    // The reviewed send's one review shows every call, with the gas each is sent with.
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.callReview).toHaveBeenCalledOnce();
    expect(mocks.callReview.mock.calls[0][0]).toEqual([
      expect.objectContaining({ chainId: 1, to: TARGET, gas: 6_600_000n }),
      expect.objectContaining({ chainId: 10, to: TARGET, gas: 6_600_000n }),
    ]);
    expect(mocks.write.mock.calls.map(([variables]) => [variables.chainId, variables.gas])).toEqual(
      [
        [1, 6_600_000n],
        [10, 6_600_000n],
      ],
    );
  });

  it("reads duplicate direct batch guards once per pass without skipping final checks", async () => {
    const source = { address: TARGET, data: "0xabcd", expected: "0x01" } as const;
    mocks.verify.mockResolvedValue({ data: "0x01" });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "duplicate-guards",
          label: "Distribute",
          calls: [{ ...call(1), preconditions: [source, source] }],
        }),
      ).resolves.toMatchObject({ status: "success" });
    });
    // Post-review, reverify and the last read before the wallet stay fresh.
    expect(mocks.verify).toHaveBeenCalledTimes(3);
    expect(mocks.verify).toHaveBeenCalledWith({ to: TARGET, data: source.data });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(readMultichainBatches()[0].calls[0].preconditions).toEqual([source, source]);
  });

  it("reviews a fresh Safe batch as a Safe proposal and proposes without a second review", async () => {
    mocks.safe = true;
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "safe-review",
          label: "Route fee",
          calls: [retryCall(1)],
        }),
      ).resolves.toMatchObject({ status: "pending" });
    });
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.callReview).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ chainId: 1, to: TARGET }),
    ]);
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(readMultichainBatches()[0].calls[0].state).toBe("safe");
  });

  it("reviews each remaining call of a resumed batch as it is sent", async () => {
    const batch = createMultichainBatch(ACCOUNT, "resumed", "Claim", [call(1)], "direct");
    saveMultichainBatch(batch);
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.runBatch({ scope: "resumed", label: "Claim", calls: [] });
    });
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.callReview).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ chainId: 1, to: TARGET, args: [1n] }),
    ]);
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("leaves the fee's payment chain open when the wallet starts in another network family", async () => {
    mocks.chainId = 11155111;
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.runBatch({
        scope: "relayr-family",
        label: "Deploy payers",
        calls: [call(1), call(10)].map((row) => ({ ...row, relayrMode: "raw" as const })),
      });
    });
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.review.mock.calls[0][0].relayrRounds).toBeUndefined();
  });

  it("spends the batch's plan review only in the run that showed it", async () => {
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await result.current.runBatch({
        scope: "relayr-review",
        label: "Deploy payers",
        calls: [call(1), call(10)].map((row) => ({ ...row, relayrMode: "raw" as const })),
      });
    });
    expect(mocks.review).toHaveBeenCalledOnce();
    // The round's quote spends the batch's one plan review.
    // It names its round, whose fee bound the review showed once.
    expect(mocks.quote.mock.calls[0][1]).toMatchObject({
      planned: { plan: expect.anything(), relayrRound: "round:0" },
    });
    expect(
      mocks.review.mock.calls[0][0].calls.map((call: { relayrRound?: string }) => call.relayrRound),
    ).toEqual(expect.arrayContaining(["round:0"]));
    // The bound is quoted on the start chain, where the round's fee is paid.
    expect(mocks.review.mock.calls[0][0].relayrRounds).toEqual({
      "round:0": { paymentChainId: mocks.chainId },
    });

    const saved = createMultichainBatch(
      ACCOUNT,
      "relayr-resume",
      "Deploy payers",
      [call(1, 2n), call(10, 2n)].map((row) => ({ ...row, relayrMode: "raw" as const })),
      "relayr",
    );
    saveMultichainBatch(saved);
    await act(async () => {
      await result.current.runBatch({ scope: "relayr-resume", label: "Deploy payers", calls: [] });
    });
    expect(mocks.review).toHaveBeenCalledOnce();
    // A resumed run showed no review, so its quote reviews its own calls.
    expect(mocks.quote.mock.calls[1][1]?.planned).toBeUndefined();
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
