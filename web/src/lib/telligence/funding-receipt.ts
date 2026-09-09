import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import { decodeEventLog, type Address, type Log } from "viem";

/**
 * Confirms the intended terminal payment rather than only its outer transaction.
 * The caller must verify the factory's pinned VVV-only project and terminal before payment:
 * IJBTerminal.Pay identifies the amount and project but does not include a token address.
 */
export function assertComputePaymentReceipt(
  receipt: { status: string; logs: readonly Pick<Log, "address" | "data" | "topics">[] },
  expected: { terminal: Address; projectId: bigint; supporter: Address; amount: bigint },
): void {
  if (receipt.status !== "success")
    throw new Error("The contribution transaction did not succeed.");
  const terminal = expected.terminal.toLowerCase();
  const supporter = expected.supporter.toLowerCase();
  let matches = 0;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== terminal) continue;
    try {
      const { args } = decodeEventLog({
        abi: jbMultiTerminalAbi,
        eventName: "Pay",
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (
        args.projectId === expected.projectId &&
        args.payer.toLowerCase() === supporter &&
        args.beneficiary.toLowerCase() === supporter &&
        args.amount === expected.amount
      )
        matches++;
    } catch {
      // Other terminal events and malformed logs cannot prove that the contribution executed.
    }
  }
  if (matches !== 1) {
    throw new Error(
      "A unique matching terminal payment was not found. Keep the transaction hash and verify it before contributing again.",
    );
  }
}
