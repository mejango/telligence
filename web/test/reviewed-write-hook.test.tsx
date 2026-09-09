import { act, renderHook, waitFor } from "@testing-library/react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "test-config", chains: [{ id: 8453, name: "Base" }] },
  queryClient: { id: "test-query-client" },
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 11155111 as number | undefined,
    connector: { id: "injected", name: "Injected" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  switchChain: vi.fn(),
  estimateContractGas: vi.fn(),
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransactionReceipt: vi.fn(),
  submit: vi.fn(),
  wagmiReceipt: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: () => ({
    chain: { id: 11155111 },
    estimateContractGas: mocks.estimateContractGas,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    getTransactionReceipt: mocks.getTransactionReceipt,
  }),
  simulateContract: mocks.simulateContract,
  switchChain: mocks.switchChain,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useWaitForTransactionReceipt: mocks.wagmiReceipt,
  useWriteContract: () => ({
    data: undefined,
    error: null,
    isError: false,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    reset: vi.fn(),
    status: "idle",
    variables: undefined,
    writeContract: vi.fn(),
    writeContractAsync: mocks.submit,
  }),
}));

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_ACCOUNT = "0x000000000000000000000000000000000000bEEF" as Address;
const TARGET = "0x0000000000000000000000000000000000001000" as Address;
const RECIPIENT = "0x0000000000000000000000000000000000002000" as Address;
const HASH = `0x${"12".repeat(32)}` as Hex;
const ABI = parseAbi(["function transfer(address recipient, uint256 amount)"]);
const CALL = {
  chainId: 11155111,
  address: TARGET,
  abi: ABI,
  functionName: "transfer",
  args: [RECIPIENT, 7n] as const,
};

async function freshHarness() {
  vi.resetModules();
  const [review, activity, hooks] = await Promise.all([
    import("@/lib/transaction-review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedWriteContract"),
  ]);
  return { review, activity, hooks };
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  mocks.account = {
    address: ACCOUNT,
    chainId: 11155111,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.simulateContract.mockImplementation(async (_config, request) => ({ request }));
  mocks.estimateContractGas.mockResolvedValue(50_000n);
  mocks.submit.mockResolvedValue(HASH);
  mocks.switchChain.mockResolvedValue(undefined);
  mocks.waitForTransactionReceipt.mockImplementation(() => new Promise(() => undefined));
  mocks.getTransactionReceipt.mockRejectedValue(new Error("Receipt not found"));
  mocks.wagmiReceipt.mockReturnValue({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  });
});

describe("reviewed write hook", () => {
  it("reviews, rechecks the account, simulates, submits the simulated request, and tracks success", async () => {
    const order: string[] = [];
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      order.push("review");
      expect(request.calls[0]).toMatchObject({
        chainId: 11155111,
        from: ACCOUNT,
        to: TARGET,
        functionName: "transfer",
        args: [RECIPIENT, 7n],
      });
      return true;
    });
    mocks.simulateContract.mockImplementation(async (_config, request) => {
      order.push("simulate");
      return { request: { ...request, gas: 45_000n } };
    });
    mocks.submit.mockImplementation(async (request) => {
      order.push("submit");
      expect(request).toMatchObject({
        address: TARGET,
        account: ACCOUNT,
        gas: 100_000n,
      });
      return HASH;
    });
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const reverify = vi.fn(async (variables, account) => {
      order.push("reverify");
      expect(variables).toBe(CALL);
      expect(account).toBe(ACCOUNT);
    });
    const { result } = renderHook(() => hooks.useWriteContract({ reverify }));
    let hash: Hex | undefined;
    await act(async () => {
      hash = await result.current.writeContractAsync(CALL as never);
    });

    expect(hash).toBe(HASH);
    expect(order).toEqual(["review", "reverify", "simulate", "submit"]);
    expect(reverify).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        kind: "direct",
        status: "success",
        account: ACCOUNT,
      }),
    );
  });

  it("switches a wallet parked on another chain to the call's chain before submitting", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.account = { ...mocks.account, chainId: 1 };

    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(mocks.switchChain).toHaveBeenCalledWith(mocks.config, { chainId: 11155111 });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("names the target chain when the wallet refuses to switch", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.account = { ...mocks.account, chainId: 1 };
    mocks.switchChain.mockRejectedValue(new Error("User rejected"));

    const { result } = renderHook(() => hooks.useWriteContract());
    await expect(
      act(async () => {
        await result.current.writeContractAsync({ ...CALL, chainId: 8453 } as never);
      }),
    ).rejects.toThrow("Switch your wallet to Base to continue.");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("defers generic receipt success until an action-specific verifier releases it", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const manualReceiptVerification = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => hooks.useWriteContract({ manualReceiptVerification }));

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "pending",
        manualVerificationRequired: true,
      }),
    );
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();

    activity.failTransactionActivityVerification(HASH, "Exact postcondition failed.");
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
      message: "Exact postcondition failed.",
    });
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "already pending",
    );

    activity.releaseTransactionActivityVerification(HASH, "Exact postcondition confirmed.");
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "success",
      manualVerificationRequired: false,
      message: "Exact postcondition confirmed.",
    });
    expect(manualReceiptVerification).toHaveBeenCalledWith(CALL);
  });

  it("rejects a manual-verification write through a Safe connector before submission", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { activity, hooks } = await freshHarness();
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        reviewedInParent: true,
        manualReceiptVerification: () => true,
      }),
    );

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "cannot be proposed through a Safe connector",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(activity.transactionActivityForHash(HASH)).toBeUndefined();
  });

  it("skips only the duplicate app review when a parent already showed the exact call", async () => {
    const { hooks } = await freshHarness();
    const reverify = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      hooks.useWriteContract({ reviewedInParent: true, reverify }),
    );

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(reverify).toHaveBeenCalledOnce();
    expect(mocks.simulateContract).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("supports a raw preflight without running Viem's CCIP-aware simulation", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const preflightSimulation = vi.fn().mockResolvedValue({ gas: 500_000n });
    const { result } = renderHook(() => hooks.useWriteContract({ preflightSimulation }));

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(preflightSimulation).toHaveBeenCalledWith(CALL, ACCOUNT);
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.estimateContractGas).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: 500_000n }));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("keeps a Safe raw preflight bounded while signing a zero Safe gas envelope", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request.calls[0].safeTxGas).toBe(0n);
      return true;
    });
    const preflightSimulation = vi.fn().mockResolvedValue({ gas: 500_000n });
    const { result } = renderHook(() => hooks.useWriteContract({ preflightSimulation }));

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(preflightSimulation).toHaveBeenCalledWith(CALL, ACCOUNT);
    expect(mocks.estimateContractGas).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: 0n }));
  });

  it("fails closed before simulation when reviewed state changes", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const reverify = vi.fn().mockRejectedValue(new Error("The project controller changed."));
    const { result } = renderHook(() => hooks.useWriteContract({ reverify }));

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "controller changed",
    );
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("preserves Wagmi 3 per-call mutation callback context", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => hooks.useWriteContract());

    act(() => {
      result.current.writeContract(CALL as never, { onSuccess, onSettled });
    });

    await waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    const expectedContext = expect.objectContaining({
      client: mocks.queryClient,
      mutationKey: ["writeContract"],
    });
    expect(onSuccess).toHaveBeenCalledWith(HASH, CALL, undefined, expectedContext);
    expect(onSettled).toHaveBeenCalledWith(HASH, null, CALL, undefined, expectedContext);
  });

  it("carries action-specific decoded review labels into the single safety review", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        transactionReview: {
          title: "Review shop items",
          label: "Add shop items",
          contractName: "JB721TiersHook",
          confirmLabel: "Confirm & send",
        },
      }),
    );

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(reviewer).toHaveBeenCalledOnce();
    expect(reviewer).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review shop items",
        confirmLabel: "Confirm & send",
        calls: [
          expect.objectContaining({
            label: "Add shop items",
            contractName: "JB721TiersHook",
            functionName: "transfer",
          }),
        ],
      }),
    );
  });

  it("leaves the review description unset when there is no extra guidance", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    // An empty string would render as a blank guidance banner in the review.
    expect(reviewer.mock.calls[0][0].description).toBeUndefined();
  });

  it("stops before simulation when the connected account changes during review", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Connected account changed",
    );
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("stops before submission when the account changes while simulating", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.simulateContract.mockImplementation(async (_config, request) => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return { request };
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Connected account changed",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("deduplicates identical pending direct writes before opening another review", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      /already pending/i,
    );
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.simulateContract).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("refreshes a sibling tab's persisted pending lock before opening review", async () => {
    const { review, activity, hooks } = await freshHarness();
    activity.transactionActivitySnapshot();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const callKey = `${ACCOUNT.toLowerCase()}:11155111:${TARGET.toLowerCase()}:0:${encodeFunctionData(
      {
        abi: ABI,
        functionName: "transfer",
        args: [RECIPIENT, 7n],
      },
    )}`;
    window.localStorage.setItem(
      "revnet:transaction-activities:v1",
      JSON.stringify([
        {
          id: "other-tab:safe-proposal",
          kind: "safe",
          title: "Publish project handle",
          status: "safe-proposed",
          message: "Awaiting Safe execution",
          chainId: 11155111,
          account: ACCOUNT,
          hash: HASH,
          safeProposalHash: HASH,
          callKey,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    const { result } = renderHook(() => hooks.useWriteContract());
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toBeInstanceOf(
      hooks.SafeProposalPendingError,
    );
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("serializes simultaneous identical submissions before either wallet prompt", async () => {
    let tail = Promise.resolve();
    const lockRequest = vi.fn(async (_name: string, callback: () => Promise<Hex>) => {
      const previous = tail;
      let release: () => void = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: lockRequest },
    });
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    let outcomes: PromiseSettledResult<Hex>[] = [];
    await act(async () => {
      outcomes = await Promise.allSettled([
        result.current.writeContractAsync(CALL as never),
        result.current.writeContractAsync(CALL as never),
      ]);
    });

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(lockRequest).toHaveBeenCalledTimes(2);
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("fails closed when the connector changes across Safe review", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => {
      mocks.account = {
        address: ACCOUNT,
        chainId: 11155111,
        connector: { id: "injected", name: "Injected" },
      };
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Wallet connection changed",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("tracks success through a direct receipt read when the watcher rejects", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("Invalid RPC parameters"));
    mocks.getTransactionReceipt.mockResolvedValue({ status: "success" });
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "success" }),
    );
    expect(mocks.getTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });

  it("persists Safe proposal locks through terminal-history churn and blocks duplicate execution", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request.confirmLabel).toMatch(/propose to Safe/i);
      expect(request.calls[0].safeTxGas).toBe(0n);
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "safe",
      status: "safe-proposed",
      safeProposalHash: HASH,
    });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: 0n }));
    for (let index = 0; index < 25; index += 1) {
      activity.recordTransactionActivity({
        id: `completed:${index}`,
        kind: "direct",
        title: `Completed ${index}`,
        status: "success",
        message: "Confirmed",
      });
    }

    const reloaded = await freshHarness();
    const reloadedHook = renderHook(() => reloaded.hooks.useWriteContract());
    await expect(
      reloadedHook.result.current.writeContractAsync(CALL as never),
    ).rejects.toBeInstanceOf(reloaded.hooks.SafeProposalPendingError);
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("fails closed before review when no wallet account or chain is available", async () => {
    const { hooks } = await freshHarness();
    const { result } = renderHook(() => hooks.useWriteContract());
    mocks.account = { address: undefined, chainId: undefined, connector: undefined };

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Connect a wallet first",
    );
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
