import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import { decodeEventLog, isAddressEqual, type Address, type TransactionReceipt } from "viem";

/** JSON-safe receipt expectations retained with the exact submitted payout call. */
export type ExpectedPayoutReceipt = {
  kind: "payout";
  terminal: Address;
  projectId: string;
  rulesetId: string;
  cycleNumber: string;
  token: Address;
  owner: Address;
  caller: Address;
  amount: string;
  minimum: string;
  splits: {
    percent: number;
    projectId: string;
    beneficiary: Address;
    preferAddToBalance: boolean;
    lockedUntil: number;
    hook: Address;
  }[];
};

function incomplete(): never {
  throw new Error(
    "Payout recipients could not all be verified. Keep the original transaction for reconciliation; do not send these payouts again.",
  );
}

/**
 * A successful terminal receipt can still contain a reverting recipient or a
 * hook that accepted only part of its funds. Verify every configured split,
 * using the terminal's successive remainder rounding and maximum 2.5% fee.
 */
export function verifyPayoutReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: ExpectedPayoutReceipt,
): void {
  const events = receipt.logs.flatMap((log) => {
    if (!isAddressEqual(log.address, expected.terminal)) return [];
    try {
      return [
        decodeEventLog({
          abi: jbMultiTerminalAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        }),
      ];
    } catch {
      return [];
    }
  });
  const projectId = BigInt(expected.projectId);
  const rulesetId = BigInt(expected.rulesetId);
  const belongsToCall = (args: { projectId: bigint; caller: Address }) =>
    args.projectId === projectId && isAddressEqual(args.caller, expected.caller);
  if (
    events.some(
      (event) =>
        (event.eventName === "PayoutReverted" || event.eventName === "PayoutTransferReverted") &&
        belongsToCall(event.args),
    )
  )
    incomplete();
  const payouts = events.filter(
    (event) => event.eventName === "SendPayouts" && belongsToCall(event.args),
  );
  if (payouts.length !== 1 || payouts[0].eventName !== "SendPayouts") incomplete();
  const payout = payouts[0].args;
  if (
    payout.rulesetId !== rulesetId ||
    payout.rulesetCycleNumber !== BigInt(expected.cycleNumber) ||
    !isAddressEqual(payout.projectOwner, expected.owner) ||
    payout.amount !== BigInt(expected.amount) ||
    payout.amountPaidOut < BigInt(expected.minimum) ||
    payout.amountPaidOut <= 0n ||
    payout.fee > payout.amountPaidOut / 40n
  )
    incomplete();

  const splitEvents = events.filter(
    (event) => event.eventName === "SendPayoutToSplit" && belongsToCall(event.args),
  );
  if (splitEvents.length !== expected.splits.length) incomplete();
  let remainingAmount = payout.amountPaidOut;
  let remainingPercent = 1_000_000_000n;
  for (const [index, split] of expected.splits.entries()) {
    const event = splitEvents[index];
    if (event.eventName !== "SendPayoutToSplit") incomplete();
    const actual = event.args;
    const percent = BigInt(split.percent);
    if (percent < 0n || percent > remainingPercent || remainingPercent <= 0n) incomplete();
    const gross = (remainingAmount * percent) / remainingPercent;
    if (
      actual.rulesetId !== rulesetId ||
      actual.group !== BigInt(expected.token) ||
      actual.split.percent !== split.percent ||
      actual.split.projectId !== BigInt(split.projectId) ||
      !isAddressEqual(actual.split.beneficiary, split.beneficiary) ||
      !isAddressEqual(actual.split.hook, split.hook) ||
      actual.split.preferAddToBalance !== split.preferAddToBalance ||
      actual.split.lockedUntil !== split.lockedUntil ||
      actual.amount !== gross ||
      actual.netAmount < gross - gross / 40n ||
      actual.netAmount > gross
    )
      incomplete();
    remainingAmount -= gross;
    remainingPercent -= percent;
  }
  if (
    payout.netLeftoverPayoutAmount < remainingAmount - remainingAmount / 40n ||
    payout.netLeftoverPayoutAmount > remainingAmount
  )
    incomplete();
}
