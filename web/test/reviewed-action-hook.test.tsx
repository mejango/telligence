import { reviewedCall } from "@/lib/reviewed-call";
import { refreshTransactionActivities } from "@/lib/transaction-activity";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import type { ReviewedAction, ReviewedCall } from "@bananapus/nana-sdk-core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { erc20Abi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// revnet's layer over core's useReviewedRun: what it adds around each run.

const REVIEWED = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  deps: null as null | { onDismissedSettled?: (call: ReviewedCall) => void },
  find: vi.fn(),
  discard: vi.fn(),
  account: { address: "0x1111111111111111111111111111111111111111", connector: { id: "a" } },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account.address }),
  useConfig: () => ({}),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => mocks.account,
  getPublicClient: () => undefined,
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
}));
vi.mock("@/lib/safe-connector", () => ({
  isSafeConnection: () => false,
  safeWalletPeerSettled: async () => undefined,
}));
vi.mock("@bananapus/nana-sdk-core/review/react", () => ({
  useReviewedRun: (deps: typeof mocks.deps) => {
    mocks.deps = deps;
    return { run: mocks.run, phase: "idle", failure: null, error: null };
  },
}));
vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  findReviewedSequence: mocks.find,
  discardReviewedSequence: mocks.discard,
}));

import { useReviewedAction } from "@/hooks/useReviewedAction";

const call = (amount: number): ReviewedCall =>
  reviewedCall({
    chainId: 1,
    address: "0x3333333333333333333333333333333333333333",
    abi: erc20Abi,
    functionName: "approve",
    args: [OTHER, BigInt(amount)],
  });

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  clearViewAs();
  mocks.account = { address: REVIEWED, connector: { id: "a" } };
  mocks.run.mockReset().mockResolvedValue({ status: "done", hashes: [], receipts: [] });
  mocks.find.mockReset().mockReturnValue(null);
  mocks.discard.mockReset().mockResolvedValue(undefined);
});

describe("useReviewedAction", () => {
  it("refuses at the write gate once view-as turned on after the review", async () => {
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    await act(() => result.current.run({ account: REVIEWED, calls: [call(1)] }));
    const sent = mocks.run.mock.calls[0][0] as ReviewedAction;
    expect(() => sent.assertWriteState?.()).not.toThrow();
    setViewAs(OTHER);
    expect(() => sent.assertWriteState?.()).toThrow(/Exit View as/);
  });

  it("journals a send under the reviewed account, not the one the wallet shows after", async () => {
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    await act(() => result.current.run({ account: REVIEWED, title: "Pay", calls: [call(1)] }));
    const sent = mocks.run.mock.calls[0][0] as ReviewedAction;
    mocks.account = { address: OTHER, connector: mocks.account.connector };
    await sent.onSubmitted?.(call(1), 0, HASH, { safe: false, adopted: false });
    expect(refreshTransactionActivities()).toEqual([
      expect.objectContaining({ hash: HASH, account: REVIEWED }),
    ]);
  });

  it("replaces an unfinished earlier run whose calls were rebuilt, and resumes one with the same calls", async () => {
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    mocks.find.mockReturnValue({ calls: [call(1), call(2)] });

    await act(() => result.current.run({ scope: "s", calls: [call(1), call(2)] }));
    expect(mocks.discard).not.toHaveBeenCalled();

    await act(() => result.current.run({ scope: "s", calls: [call(3)] }));
    expect(mocks.discard).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("keeps a run left at its receipt pending until its hold ends it, then returns that end", async () => {
    let end!: (value: unknown) => void;
    const ended = new Promise((resolve) => (end = resolve));
    mocks.run.mockResolvedValueOnce({ status: "receipt", step: 0, hash: HASH, ended: () => ended });
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    let returned: unknown = "pending";
    await act(async () => {
      void result.current.run({ calls: [call(1)] }).then((value) => (returned = value));
    });
    expect(returned).toBe("pending");
    const done = { status: "done", hashes: [HASH], receipts: [] };
    await act(async () => end(done));
    expect(returned).toBe(done);
  });

  it("shows a confirmation queued behind the run's locks until the next run, keeping its row pending", async () => {
    const { ConfirmationQueuedError, CONFIRMATION_QUEUED_LINE } =
      await import("@bananapus/nana-sdk-core/review");
    mocks.run.mockImplementationOnce(async (action: ReviewedAction) => {
      await action.onSubmitted?.(call(1), 0, HASH, { safe: false, adopted: false });
      return {
        status: "receipt",
        step: 0,
        hash: HASH,
        // Core's end of a receipt whose notice waits behind the run's own locks.
        ended: async () => ({
          status: "failed",
          error: CONFIRMATION_QUEUED_LINE,
          failure: new ConfirmationQueuedError(0),
        }),
      };
    });
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    await act(() => result.current.run({ account: REVIEWED, calls: [call(1)] }));
    expect(result.current.error).toBe(CONFIRMATION_QUEUED_LINE);
    expect(refreshTransactionActivities()[0]).toMatchObject({ hash: HASH, status: "pending" });
    // The next run clears it: core closes that run on the success.
    await act(() => result.current.run({ account: REVIEWED, calls: [call(1)] }));
    expect(result.current.error).toBeNull();
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("settles a sent write's row once the hold it was left at ends the run done", async () => {
    let end!: (value: unknown) => void;
    const ended = new Promise((resolve) => (end = resolve));
    mocks.run.mockImplementationOnce(async (action: ReviewedAction) => {
      await action.onSubmitted?.(call(1), 0, HASH, { safe: false, adopted: false });
      return { status: "receipt", step: 0, hash: HASH, ended: () => ended };
    });
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    let returned: Promise<unknown> | undefined;
    await act(async () => {
      returned = result.current.run({ account: REVIEWED, calls: [call(1)] });
    });
    expect(refreshTransactionActivities()[0]).toMatchObject({ hash: HASH, status: "pending" });
    await act(async () => end({ status: "done", hashes: [HASH], receipts: [] }));
    await returned;
    expect(refreshTransactionActivities()[0]).toMatchObject({ hash: HASH, status: "success" });
  });

  it("sends nothing, and says why, when the earlier run still has a held step", async () => {
    const { result } = renderHook(() => useReviewedAction(), { wrapper });
    mocks.find.mockReturnValue({ calls: [call(1)] });
    mocks.discard.mockRejectedValue(
      new Error("A step of this action is still pending. Nothing was discarded."),
    );

    const ended = await act(() => result.current.run({ scope: "s", calls: [call(3)] }));
    expect(ended).toMatchObject({
      status: "failed",
      error: "A step of this action is still pending. Nothing was discarded.",
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("reads again what a held step changed once it settles after its confirm was closed", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    renderHook(() => useReviewedAction(), { wrapper });
    mocks.deps?.onDismissedSettled?.(call(1));
    expect(invalidate).toHaveBeenCalledOnce();
    invalidate.mockRestore();
  });
});
