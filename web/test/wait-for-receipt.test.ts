import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import type { Hex, PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const HASH = `0x${"ab".repeat(32)}` as Hex;

describe("receipt tracking fallback", () => {
  it("uses a direct receipt read when the watcher rejects", async () => {
    const receipt = { status: "success", blockNumber: 12n, transactionHash: HASH };
    const client = {
      chain: { id: 8453 },
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("Invalid RPC parameters")),
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
    } as unknown as PublicClient;

    await expect(waitForReceiptWithRetry(client, HASH)).resolves.toBe(receipt);
  });

  it("retains the submitted hash when receipt tracking remains unavailable", async () => {
    const client = {
      chain: { id: 8453 },
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    } as unknown as PublicClient;

    await expect(
      waitForReceiptWithRetry(client, HASH, { attempts: 1, intervalMs: 0 }),
    ).rejects.toMatchObject({
      name: "TransactionReceiptUnavailableError",
      hash: HASH,
      chainId: 8453,
    });
  });
});
