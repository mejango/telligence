import { act, renderHook } from "@testing-library/react";
import { type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
  publicClientAvailable: true,
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
  requireOnchainExecution: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.address }),
  usePublicClient: () =>
    mocks.publicClientAvailable
      ? {
          readContract: mocks.readContract,
          waitForTransactionReceipt: mocks.waitForTransactionReceipt,
        }
      : undefined,
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  requireOnchainExecution: mocks.requireOnchainExecution,
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync }),
}));

const TOKEN = "0x0000000000000000000000000000000000001000" as Address;
const SPENDER = "0x0000000000000000000000000000000000002000" as Address;
const HASH = `0x${"34".repeat(32)}` as Hex;

async function freshHook() {
  vi.resetModules();
  return import("@/hooks/useAllowance");
}

beforeEach(() => {
  mocks.address = "0x000000000000000000000000000000000000dEaD";
  mocks.publicClientAvailable = true;
  mocks.readContract.mockResolvedValue(0n);
  mocks.writeContractAsync.mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
});

describe("wallet-action:allowance — allowance hook", () => {
  it("does nothing when the exact spender allowance is already sufficient", async () => {
    mocks.readContract.mockResolvedValue(50n);
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));
    let hash: Hex | null | undefined;

    await act(async () => {
      hash = await result.current.ensureAllowance(TOKEN, SPENDER, 50n);
    });

    expect(hash).toBeNull();
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: "allowance",
        args: [mocks.address, SPENDER],
      }),
    );
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });

  it("approves through the reviewed hook, enforces direct execution, and verifies the receipt", async () => {
    const order: string[] = [];
    const receipt = { status: "success", blockNumber: 12_345n } as const;
    mocks.writeContractAsync.mockImplementation(async () => {
      order.push("write");
      return HASH;
    });
    mocks.requireOnchainExecution.mockImplementation(() => order.push("execution-boundary"));
    mocks.waitForTransactionReceipt.mockImplementation(async () => {
      order.push("receipt");
      return receipt;
    });
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));
    let hash: Hex | null | undefined;

    await act(async () => {
      hash = await result.current.ensureAllowance(TOKEN, SPENDER, 75n);
    });

    expect(hash).toBe(HASH);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 11155111,
        address: TOKEN,
        functionName: "approve",
        args: [SPENDER, 75n],
      }),
    );
    expect(order).toEqual(["write", "execution-boundary", "receipt"]);
    expect(result.current.getApprovalReceipt(hash)).toEqual(receipt);
    expect(result.current.getApprovalReceipt(null)).toBeUndefined();
    expect(result.current.getApprovalReceipt(undefined)).toBeUndefined();
    expect(result.current.getApprovalReceipt(`0x${"56".repeat(32)}`)).toBeUndefined();
    expect(result.current.isApproving).toBe(false);
  });

  it("stops at the Safe execution boundary and never waits on a proposal hash as a receipt", async () => {
    mocks.requireOnchainExecution.mockImplementation(() => {
      throw new Error("Safe proposal has not executed");
    });
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await act(async () => {
      await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n)).rejects.toThrow(
        /has not executed/i,
      );
    });
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(result.current.isApproving).toBe(false);
  });

  it("rejects a mined approval that reverted onchain", async () => {
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await act(async () => {
      await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n)).rejects.toThrow(
        `Token approval ${HASH} reverted onchain`,
      );
    });
    expect(result.current.isApproving).toBe(false);
  });

  it("fails closed without a connected wallet", async () => {
    mocks.address = undefined;
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n)).rejects.toThrow(
      "Wallet not connected",
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("fails closed without a public client", async () => {
    mocks.publicClientAvailable = false;
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n)).rejects.toThrow(
      "Please try again",
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("fails closed when approval confirmation is unavailable", async () => {
    mocks.waitForTransactionReceipt.mockResolvedValue(undefined);
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await act(async () => {
      await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n)).rejects.toThrow(
        `Token approval ${HASH} was submitted, but confirmation is unavailable`,
      );
    });
    expect(result.current.isApproving).toBe(false);
  });
});
