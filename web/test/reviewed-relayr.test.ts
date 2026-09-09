import type { RelayrGetBundleResponse } from "@/lib/nana/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT,
  BLOCK_HASH,
  BUNDLE_UUID,
  HASH,
  PAYMENT_TARGET,
  TARGET,
  onchain,
  payment,
} from "./relayr-fixtures";

const mocks = vi.hoisted(() => ({
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
  getPublicClient: vi.fn(),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi/actions", () => ({ getPublicClient: mocks.getPublicClient }));

function bundle(
  state: "Pending" | "Completed" | "Failed" | "Success" = "Completed",
): RelayrGetBundleResponse {
  return {
    bundle_uuid: BUNDLE_UUID,
    created_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-01T01:00:00Z",
    payment: [],
    payment_received: true,
    transactions: [
      {
        tx_uuid: "transaction",
        request: {
          chain: 1,
          target: TARGET,
          data: "0x1234",
          value: "0x0",
          gas_limit: "0x5208",
          virtual_nonce: null,
        },
        status:
          state === "Success"
            ? { state, data: { hash: HASH } }
            : state === "Completed"
              ? { state, data: { block_hash: BLOCK_HASH, transaction: { hash: HASH } } }
              : { state },
      },
    ],
  };
}

async function freshModules() {
  vi.resetModules();
  const [relayr, activity] = await Promise.all([
    import("@/hooks/useReviewedRelayr"),
    import("@/lib/transaction-activity"),
  ]);
  activity.recordTransactionActivity({
    id: `relayr:${BUNDLE_UUID}`,
    kind: "relayr-bundle",
    title: "Relayr bundle",
    status: "pending",
    message: "Waiting for destination transactions.",
    bundleUuid: BUNDLE_UUID,
    chainId: 1,
    account: ACCOUNT,
    hash: HASH,
    relayrPaymentStatus: "submitted",
    relayrPayment: { target: PAYMENT_TARGET, data: payment().calldata, value: "16" },
    relayrExpectedTransactions: [
      { chainId: 1, target: TARGET, data: "0x1234", value: "0", transactionUuid: "transaction" },
    ],
  });
  return { relayr, activity };
}

function respond(response = bundle()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  let transactionReads = 0;
  let receiptReads = 0;
  mocks.getTransaction.mockImplementation(async () =>
    ++transactionReads % 2
      ? onchain(PAYMENT_TARGET, payment().calldata)
      : onchain(TARGET, "0x1234", 0n),
  );
  mocks.getTransactionReceipt.mockImplementation(async () =>
    ++receiptReads % 2
      ? onchain(PAYMENT_TARGET, payment().calldata)
      : onchain(TARGET, "0x1234", 0n),
  );
  mocks.getBlock.mockResolvedValue({ hash: BLOCK_HASH });
  mocks.getPublicClient.mockReturnValue({
    getTransaction: mocks.getTransaction,
    getTransactionReceipt: mocks.getTransactionReceipt,
    getBlock: mocks.getBlock,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Relayr destination transaction tracking", () => {
  it("checks canonical funding and destination calls before exposing completion", async () => {
    const { relayr, activity } = await freshModules();
    const response = bundle();
    const onUpdate = vi.fn();
    respond(response);
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID, onUpdate)).resolves.toEqual(response);
    expect(onUpdate).toHaveBeenCalledWith(response);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "success",
      relayrPaymentStatus: "confirmed",
      chainStates: [{ chainId: 1, status: "Completed", hash: HASH }],
    });
    expect(mocks.getTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.getBlock).toHaveBeenCalledTimes(2);
  });

  it("retains failed destinations for recovery without permitting another payment", async () => {
    const { relayr, activity } = await freshModules();
    respond(bundle("Failed"));
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(/bundle .* failed/);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
      chainStates: [{ chainId: 1, status: "Failed" }],
    });
  });

  it.each([
    "wrong bundle",
    "missing call",
    "duplicate chain",
    "changed calldata",
    "changed value",
    "changed transaction identity",
  ])("rejects %s from the status API", async (mutation) => {
    const { relayr, activity } = await freshModules();
    const response = bundle();
    if (mutation === "wrong bundle") response.bundle_uuid = "different";
    if (mutation === "missing call") response.transactions = [];
    if (mutation === "duplicate chain") response.transactions.push(response.transactions[0]);
    if (mutation === "changed calldata") response.transactions[0].request.data = "0x9999";
    if (mutation === "changed value") response.transactions[0].request.value = "0x1";
    if (mutation === "changed transaction identity") response.transactions[0].tx_uuid = "unrelated";
    respond(response);
    const onUpdate = vi.fn();
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID, onUpdate)).rejects.toThrow(
      /does not match/,
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
    });
  });

  it("refuses legacy activity without retained exact signed calls", async () => {
    const { relayr, activity } = await freshModules();
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrExpectedTransactions: undefined,
    });
    respond();
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(
      /signed destination calls.*unavailable/,
    );
    expect(activity.transactionActivitySnapshot()[0].status).toBe("failed");
  });

  it("does not trust a success label without a destination hash", async () => {
    const { relayr } = await freshModules();
    const response = bundle();
    response.transactions[0].status = { state: "Completed" };
    respond(response);
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(
      /without a destination transaction hash/,
    );
  });

  it.each(["calldata", "value", "receipt status"])(
    "rejects onchain destination %s mismatch",
    async (mutation) => {
      const { relayr } = await freshModules();
      respond();
      mocks.getTransaction
        .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
        .mockResolvedValueOnce(
          onchain(
            TARGET,
            mutation === "calldata" ? "0x99" : "0x1234",
            mutation === "value" ? 1n : 0n,
          ),
        );
      if (mutation === "receipt status")
        mocks.getTransactionReceipt
          .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
          .mockResolvedValueOnce({ ...onchain(TARGET, "0x1234", 0n), status: "reverted" });
      await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(
        mutation === "receipt status" ? /reverted onchain/ : /does not match the signed request/,
      );
    },
  );

  it("does not mark a funded bundle failed merely because its RPC is unavailable", async () => {
    vi.useFakeTimers();
    const { relayr, activity } = await freshModules();
    mocks.getTransaction.mockRejectedValueOnce(new Error("RPC unavailable"));
    respond();
    const result = relayr.waitForRelayrBundle(BUNDLE_UUID);
    const rejection = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({ status: "pending" });
    // A later identity mismatch stops the test's watcher while retaining its lock.
    mocks.getTransaction.mockResolvedValue(onchain(TARGET, "0x"));
    await vi.advanceTimersByTimeAsync(2_000);
    await rejection;
  });

  it("deduplicates concurrent polling and retries the original bundle after an API outage", async () => {
    vi.useFakeTimers();
    const { relayr, activity } = await freshModules();
    const response = bundle("Success");
    // Funding is checked again on the retry before the final destination read.
    mocks.getTransaction
      .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
      .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
      .mockResolvedValueOnce(onchain(TARGET, "0x1234", 0n));
    mocks.getTransactionReceipt
      .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
      .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
      .mockResolvedValueOnce(onchain(TARGET, "0x1234", 0n));
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("status endpoint unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = relayr.waitForRelayrBundle(BUNDLE_UUID);
    const second = relayr.waitForRelayrBundle(BUNDLE_UUID);
    await vi.runAllTimersAsync();
    await expect(Promise.all([first, second])).resolves.toEqual([response, response]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(activity.transactionActivitySnapshot()[0].status).toBe("success");
  });

  it("permits recovery only when the original funding transaction canonically reverted", async () => {
    const { relayr, activity } = await freshModules();
    respond();
    mocks.getTransactionReceipt.mockResolvedValueOnce({
      ...onchain(PAYMENT_TARGET, payment().calldata),
      status: "reverted",
    });
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(
      /funding transaction reverted/,
    );
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "failed",
      relayrPaymentStatus: "reverted",
      manualVerificationRequired: true,
    });
    activity.dismissTransactionActivity(`relayr:${BUNDLE_UUID}`);
    expect(activity.transactionActivitySnapshot()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
