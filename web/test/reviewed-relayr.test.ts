import type { RelayrDestinationProgress } from "@/hooks/useReviewedRelayr";
import type { RelayrGetBundleResponse } from "@/lib/nana/types";
import { SAFE_EXEC_ABI, canonicalSafeTxHash } from "@bananapus/nana-sdk-core/safe-service";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT,
  BLOCK_HASH,
  BUNDLE_UUID,
  HASH,
  PAYMENT_TARGET,
  TARGET,
  TX_UUIDS,
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
          virtual_nonce: 0,
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

async function freshModules(expectedSafeExecution?: {
  safe: `0x${string}`;
  safeTxHash: `0x${string}`;
  nonce: number;
}) {
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
      {
        chainId: 1,
        target: TARGET,
        data: "0x1234",
        value: "0",
        transactionUuid: "transaction",
        ...(expectedSafeExecution ? { expectedSafeExecution } : {}),
      },
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
  it("requires the Safe's exact ExecutionSuccess before completing a legacy Safe execution", async () => {
    const tx = {
      to: TARGET,
      value: 0n,
      data: "0x1234" as const,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: 5,
    };
    const safeTxHash = canonicalSafeTxHash(1, TARGET, tx);
    const exec = encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      functionName: "execTransaction",
      args: [
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        "0x",
      ],
    });
    const [executionSuccess] = encodeEventTopics({
      abi: SAFE_EXEC_ABI,
      eventName: "ExecutionSuccess",
    });
    const executed = {
      address: TARGET,
      topics: [executionSuccess, safeTxHash],
      data: encodeAbiParameters([{ type: "uint256" }], [0n]),
    };
    const rejectionTopic = `0x${"55".repeat(32)}` as const;
    const rejectedLog = { address: TARGET, topics: [rejectionTopic], data: "0x" };
    for (const { logs, reject } of [
      { logs: [], reject: false },
      { logs: [executed], reject: false },
      { logs: [executed, rejectedLog], reject: true },
    ]) {
      window.localStorage.clear();
      mocks.getTransaction.mockResolvedValue(onchain(TARGET, exec, 0n));
      mocks.getTransactionReceipt.mockResolvedValue({ ...onchain(TARGET, exec, 0n), logs });
      const modules = await freshModules({ safe: TARGET, safeTxHash, nonce: 5 });
      const saved = modules.activity.transactionActivitySnapshot()[0];
      modules.activity.updateTransactionActivity(saved.id, {
        relayrExpectedTransactions: saved.relayrExpectedTransactions!.map((expected) => ({
          ...expected,
          data: exec,
          transactionUuid: TX_UUIDS[0],
          ...(reject ? { rejectEvents: [{ topic: rejectionTopic, address: TARGET }] } : {}),
        })),
      });
      const response = bundle();
      response.transactions[0].tx_uuid = TX_UUIDS[0];
      response.transactions[0].request.data = exec;
      respond(response);
      const result = modules.relayr.waitForRelayrBundle(BUNDLE_UUID);
      if (reject) {
        await expect(result).rejects.toThrow(/incomplete recipient/);
        expect(modules.activity.transactionActivitySnapshot()[0].status).not.toBe("success");
      } else if (logs.length) await expect(result).resolves.toBeTruthy();
      else await expect(result).rejects.toThrow(/ExecutionSuccess/);
    }
  });

  it("checks canonical funding and destination calls before exposing completion", async () => {
    const { relayr, activity } = await freshModules();
    const response = bundle();
    const onUpdate = vi.fn();
    const onResults = vi.fn();
    respond(response);
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID, onUpdate, onResults)).resolves.toEqual(
      response,
    );
    expect(onUpdate).toHaveBeenCalledWith(response);
    expect(onResults.mock.calls).toEqual([
      [[{ transactionUuid: "transaction", hash: HASH, status: "submitted" }]],
      [[{ transactionUuid: "transaction", hash: HASH, status: "confirmed" }]],
    ]);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "success",
      relayrPaymentStatus: "confirmed",
      chainStates: [{ chainId: 1, status: "Completed", hash: HASH }],
    });
    expect(mocks.getTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.getBlock).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.relayr.ba5ed.com/v1/bundle/${BUNDLE_UUID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("replays independent results to late observers without extra polls or trusting unverified receipts", async () => {
    vi.useFakeTimers();
    const { relayr, activity } = await freshModules();
    const original = bundle().transactions[0];
    const hashes = Array.from(
      { length: 14 },
      (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}` as const,
    );
    const transactions = hashes.map((hash, index) => ({
      ...original,
      tx_uuid: `transaction-${index}`,
      status: { state: "Success" as const, data: { hash } },
    }));
    const saved = activity.transactionActivitySnapshot()[0];
    activity.updateTransactionActivity(saved.id, {
      relayrExpectedTransactions: transactions.map((transaction) => ({
        ...saved.relayrExpectedTransactions![0],
        transactionUuid: transaction.tx_uuid,
      })),
    });
    const final = { ...bundle(), transactions: transactions.toReversed() };
    const partial = {
      ...final,
      transactions: final.transactions.map((transaction, index) => ({
        ...transaction,
        status: index < 2 ? { state: "Pending" as const } : transaction.status,
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(partial)))
        .mockImplementation(async () => new Response(JSON.stringify(final))),
    );
    const firstCanonical = Promise.withResolvers<{ hash: typeof BLOCK_HASH }>();
    const lastReceipt = Promise.withResolvers<ReturnType<typeof onchain>>();
    mocks.getTransaction.mockImplementation(async ({ hash }: { hash: typeof HASH }) =>
      hash === HASH
        ? onchain(PAYMENT_TARGET, payment().calldata)
        : { ...onchain(TARGET, "0x1234", 0n), hash },
    );
    mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: typeof HASH }) =>
      hash === HASH
        ? onchain(PAYMENT_TARGET, payment().calldata)
        : hash === hashes[0]
          ? lastReceipt.promise
          : { ...onchain(TARGET, "0x1234", 0n), transactionHash: hash },
    );
    mocks.getBlock
      .mockResolvedValueOnce({ hash: BLOCK_HASH })
      .mockResolvedValueOnce({ hash: BLOCK_HASH })
      .mockImplementationOnce(() => firstCanonical.promise);
    const unsafe = vi.fn((results: readonly RelayrDestinationProgress[]) => {
      results[0].status = "confirmed";
      results[0].transactionUuid = "unrelated";
      throw new Error("display failed");
    });
    const first = relayr.waitForRelayrBundle(BUNDLE_UUID, undefined, unsafe);
    await vi.advanceTimersByTimeAsync(0);
    const observer = vi.fn<(results: readonly RelayrDestinationProgress[]) => void>();
    const second = relayr.waitForRelayrBundle(BUNDLE_UUID, undefined, observer);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.lastCall![0].filter((row) => row.status === "submitted")).toHaveLength(12);
    expect(observer.mock.lastCall![0].slice(0, 2)).toEqual([
      { transactionUuid: "transaction-13", status: "pending" },
      { transactionUuid: "transaction-12", status: "pending" },
    ]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(observer.mock.lastCall![0].every((row) => row.status === "submitted")).toBe(true);
    // An API success and receipt do not confirm a row before canonical block proof.
    firstCanonical.resolve({ hash: BLOCK_HASH });
    await vi.advanceTimersByTimeAsync(0);
    expect(observer.mock.lastCall![0].filter((row) => row.status === "confirmed")).toHaveLength(13);
    expect(observer.mock.lastCall![0].at(-1)).toEqual({
      transactionUuid: "transaction-0",
      hash: hashes[0],
      status: "submitted",
    });
    lastReceipt.resolve({ ...onchain(TARGET, "0x1234", 0n), transactionHash: hashes[0] });
    await expect(Promise.all([first, second])).resolves.toEqual([final, final]);
    expect(observer.mock.lastCall![0].every((row) => row.status === "confirmed")).toBe(true);
    expect(mocks.getTransactionReceipt).toHaveBeenCalledTimes(16);
    expect(mocks.getBlock).toHaveBeenCalledTimes(16);
    expect(activity.transactionActivitySnapshot()[0].status).toBe("success");
    const previousCalls = observer.mock.calls.length;
    // Completed callers are unsubscribed before another watcher for the same bundle begins.
    await relayr.waitForRelayrBundle(BUNDLE_UUID);
    expect(observer).toHaveBeenCalledTimes(previousCalls);
  });

  it("never publishes confirmation or records success when destination action proof fails", async () => {
    const { relayr, activity } = await freshModules();
    const topic = `0x${"55".repeat(32)}` as const;
    const saved = activity.transactionActivitySnapshot()[0];
    activity.updateTransactionActivity(saved.id, {
      relayrExpectedTransactions: saved.relayrExpectedTransactions!.map((expected) => ({
        ...expected,
        rejectEvents: [{ topic, address: TARGET }],
      })),
    });
    mocks.getTransactionReceipt
      .mockResolvedValueOnce(onchain(PAYMENT_TARGET, payment().calldata))
      .mockResolvedValueOnce({
        ...onchain(TARGET, "0x1234", 0n),
        logs: [{ address: TARGET, topics: [topic], data: "0x" }],
      });
    respond();
    const observer = vi.fn();
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID, undefined, observer)).rejects.toThrow(
      /incomplete recipient/,
    );
    expect(observer.mock.calls).toEqual([
      [[{ transactionUuid: "transaction", hash: HASH, status: "submitted" }]],
    ]);
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions![0].receiptStatus,
    ).toBeUndefined();
  });

  it("accepts Relayr's echo of the bundle ID in any case", async () => {
    const { relayr, activity } = await freshModules();
    respond({ ...bundle(), bundle_uuid: BUNDLE_UUID.toUpperCase() });
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).resolves.toBeTruthy();
    expect(activity.transactionActivitySnapshot()[0].status).toBe("success");
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
    const onResults = vi.fn();
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID, onUpdate, onResults)).rejects.toThrow(
      /does not match/,
    );
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onResults).not.toHaveBeenCalled();
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

  it.each([
    ["no destination hash", { state: "Completed" as const }],
    [
      "a malformed destination hash",
      {
        state: "Completed" as const,
        data: { block_hash: BLOCK_HASH, transaction: { hash: "0x1234" as const } },
      },
    ],
  ])("does not trust a success label with %s", async (_, status) => {
    const { relayr } = await freshModules();
    const response = bundle();
    response.transactions[0].status = status;
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

  it("holds a funded bundle that names no payment for manual verification", async () => {
    const { relayr, activity } = await freshModules();
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, { relayrPayment: undefined });
    respond();
    await expect(relayr.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(
      /original funding transaction cannot be verified/,
    );
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps polling, never failing the bundle, while the funding chain has no RPC", async () => {
    vi.useFakeTimers();
    const { relayr, activity } = await freshModules();
    mocks.getPublicClient.mockReturnValueOnce(undefined);
    respond();
    const result = relayr.waitForRelayrBundle(BUNDLE_UUID);
    await vi.advanceTimersByTimeAsync(0);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "pending",
      relayrPaymentStatus: "submitted",
      message: expect.stringContaining("temporarily unavailable"),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBeTruthy();
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "success",
      relayrPaymentStatus: "confirmed",
    });
  });
});
