import { requireRefundFreeSafeExecution, safeTransactionRunsCalls } from "@/lib/safe-transactions";
import { encodeMultiSend, MULTI_SEND_CALL_ONLY } from "@bananapus/nana-sdk-core/safe";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { executionLog } from "./fixtures/safe-chain";

const SAFE = "0x2222222222222222222222222222222222222222" as Address;
const REVIEWED = `0x${"ab".repeat(32)}` as Hex;
const OTHER = `0x${"cd".repeat(32)}` as Hex;
const receipt = (logs: ReturnType<typeof executionLog>[], status = "success") => ({
  status,
  transactionHash: `0x${"ef".repeat(32)}` as Hex,
  logs,
});

describe("a refund-free Safe execution", () => {
  it("is proven only by the Safe's ExecutionSuccess for the reviewed hash", () => {
    expect(() =>
      requireRefundFreeSafeExecution(receipt([executionLog(SAFE, REVIEWED)]), SAFE, REVIEWED),
    ).not.toThrow();
    for (const logs of [
      [],
      [executionLog(SAFE, OTHER)],
      [executionLog(OTHER.slice(0, 42) as Address, REVIEWED)],
      [executionLog(SAFE, REVIEWED), executionLog(SAFE, REVIEWED)],
    ]) {
      expect(() => requireRefundFreeSafeExecution(receipt(logs), SAFE, REVIEWED)).toThrow();
    }
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED, "ExecutionFailure")]),
        SAFE,
        REVIEWED,
      ),
    ).toThrow("ExecutionFailure");
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED)], "reverted"),
        SAFE,
        REVIEWED,
      ),
    ).toThrow("reverted");
  });

  it("refuses an execution that paid a refund, and ignores another proposal's refund", () => {
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED, "ExecutionSuccess", 1n)]),
        SAFE,
        REVIEWED,
      ),
    ).toThrow("The Safe paid a gas refund for this transaction.");
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED), executionLog(SAFE, OTHER, "ExecutionSuccess", 1n)]),
        SAFE,
        REVIEWED,
      ),
    ).not.toThrow();
  });
});

describe("a Safe transaction running the reviewed calls", () => {
  const TARGET = "0x4444444444444444444444444444444444444444" as Address;
  const first = { to: TARGET, value: "0", data: "0x1234" as Hex };
  const second = { to: SAFE, value: "5", data: "0xabcd" as Hex };
  const call = (to: Address, data: Hex, operation: number, value = 0n) => ({
    to,
    value,
    data,
    operation,
  });
  const batchOf = (...calls: { to: Address; value: string; data: Hex }[]) =>
    call(
      MULTI_SEND_CALL_ONLY,
      encodeMultiSend(calls.map((inner) => ({ ...inner, value: BigInt(inner.value) }))),
      1,
    );

  it("is the one reviewed call itself, as a CALL", () => {
    expect(safeTransactionRunsCalls(call(TARGET, "0x1234", 0), [first], false)).toBe(true);
    expect(safeTransactionRunsCalls(call(TARGET, "0x1234", 1), [first], false)).toBe(false);
    expect(safeTransactionRunsCalls(call(TARGET, "0x1235", 0), [first], false)).toBe(false);
    expect(safeTransactionRunsCalls(call(TARGET, "0x1234", 0, 1n), [first], false)).toBe(false);
    // A single write is never accepted as a batch of it.
    expect(safeTransactionRunsCalls(batchOf(first), [first], false)).toBe(false);
  });

  it("is a batch's calls in order through MultiSendCallOnly, or its one call alone", () => {
    expect(safeTransactionRunsCalls(batchOf(first, second), [first, second], true)).toBe(true);
    expect(safeTransactionRunsCalls(batchOf(second, first), [first, second], true)).toBe(false);
    expect(safeTransactionRunsCalls(batchOf(first), [first, second], true)).toBe(false);
    expect(safeTransactionRunsCalls(call(TARGET, "0x1234", 0), [first], true)).toBe(true);
    // Another delegatecall target with the same bytes, or value on the outer call, is not the batch.
    const batch = batchOf(first, second);
    expect(safeTransactionRunsCalls({ ...batch, to: TARGET }, [first, second], true)).toBe(false);
    expect(safeTransactionRunsCalls({ ...batch, value: 5n }, [first, second], true)).toBe(false);
  });
});
