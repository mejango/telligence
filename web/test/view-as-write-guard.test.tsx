import { act, renderHook } from "@testing-library/react";
import { parseAbi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "view-as-guard-config" },
  queryClient: { id: "view-as-guard-query-client" },
  getAccount: vi.fn(),
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getPublicClient: vi.fn(),
  submit: vi.fn(),
  sendTransaction: vi.fn(),
  signTypedData: vi.fn(),
  switchChain: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: mocks.getPublicClient,
  simulateContract: mocks.simulateContract,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ACCOUNT }),
  useConfig: () => mocks.config,
  useSendTransaction: () => ({
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    sendTransactionAsync: mocks.sendTransaction,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
  useWaitForTransactionReceipt: () => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  }),
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
const VIEWED = "0x000000000000000000000000000000000000bEEF" as Address;
const TARGET = "0x0000000000000000000000000000000000001000" as Address;
const ABI = parseAbi(["function transfer(address recipient, uint256 amount)"]);
const CALL = {
  chainId: 11155111,
  address: TARGET,
  abi: ABI,
  functionName: "transfer",
  args: [TARGET, 7n] as const,
};
const EXPECTED_ERROR = "You're viewing the site as another account — exit View as to transact.";

async function freshHarness() {
  vi.resetModules();
  const [viewAsLib, writeHooks, relayrHooks] = await Promise.all([
    import("@/lib/view-as"),
    import("@/hooks/useReviewedWriteContract"),
    import("@/hooks/useReviewedRelayr"),
  ]);
  return { viewAsLib, writeHooks, relayrHooks };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.getAccount.mockReturnValue({
    address: ACCOUNT,
    chainId: 11155111,
    connector: { id: "injected", name: "Injected" },
  });
});

describe("view-as write refusal", () => {
  it("refuses reviewed contract writes while view-as is active, before any review or wallet call", async () => {
    const { viewAsLib, writeHooks } = await freshHarness();
    act(() => viewAsLib.setViewAs(VIEWED));

    const { result } = renderHook(() => writeHooks.useWriteContract());
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrowError(
      EXPECTED_ERROR,
    );

    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("refuses the Relayr quote and payment paths while view-as is active", async () => {
    const { viewAsLib, relayrHooks } = await freshHarness();
    act(() => viewAsLib.setViewAs(VIEWED));

    const quote = renderHook(() => relayrHooks.useGetRelayrTxQuote());
    await expect(
      quote.result.current.getRelayrTxQuote([
        {
          chainId: 11155111,
          data: { from: ACCOUNT, to: TARGET, value: 0n, gas: 100_000n, data: "0x" as Hex },
        },
      ]),
    ).rejects.toThrowError(EXPECTED_ERROR);
    expect(mocks.signTypedData).not.toHaveBeenCalled();

    const send = renderHook(() => relayrHooks.useSendRelayrTx());
    await expect(
      send.result.current.sendRelayrTx({
        amount: "0x10",
        calldata: "0x1234",
        chain: 11155111,
        payment_deadline: String(Math.floor(Date.now() / 1_000) + 600),
        target: TARGET,
        token: "0x0000000000000000000000000000000000000000",
      }),
    ).rejects.toThrowError(EXPECTED_ERROR);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("allows reviewed writes again after exiting view-as", async () => {
    const { viewAsLib, writeHooks } = await freshHarness();
    act(() => viewAsLib.setViewAs(VIEWED));
    act(() => viewAsLib.clearViewAs());

    const { result } = renderHook(() => writeHooks.useWriteContract());
    // With view-as cleared, the call proceeds past the guard into the normal
    // review pipeline, which fails differently (no review handler registered).
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrowError(
      "Transaction review is unavailable. Reload the page before continuing.",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
