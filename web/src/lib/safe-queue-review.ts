import { decodeProtocolQueueCall } from "@/lib/protocol-queue-label";
import type { TransactionReviewCall } from "@/lib/transaction-review";
import { MULTI_SEND_ABI, multiSendCallsOf } from "@bananapus/nana-sdk-core/safe";
import { decodeFunctionData, type Address, type Hex } from "viem";

/** Decode the exact queued bytes, sharing the Operator tab's destination-aware labels. */
export function queuedSafeReviewCall(
  chainId: number,
  tx: { to: Address; data: Hex | null; operation: number; value?: string | number | bigint },
): TransactionReviewCall {
  const call: TransactionReviewCall = {
    chainId,
    to: tx.to,
    data: tx.data ?? "0x",
    value: BigInt(tx.value ?? 0),
    ...decodeProtocolQueueCall(chainId, tx),
  };
  const batch = multiSendCallsOf(tx);
  // The SDK validates recognized CallOnly targets, canonical bytes, and CALL-only entries.
  if (!batch) return call;
  return {
    ...call,
    abi: MULTI_SEND_ABI,
    functionName: "multiSend",
    args: decodeFunctionData({ abi: MULTI_SEND_ABI, data: call.data }).args,
    contractName: "MultiSendCallOnly",
    label: `Batch (${batch.length} call${batch.length === 1 ? "" : "s"})`,
    calls: batch.map((inner) => ({
      chainId,
      to: inner.to,
      value: inner.value,
      data: inner.data,
      ...decodeProtocolQueueCall(chainId, { ...inner, operation: 0 }),
    })),
  };
}
