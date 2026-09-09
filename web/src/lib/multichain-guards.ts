import { JB_PROJECT_PAYER_DEPLOYER, jbProjectPayerDeployerAbi } from "@bananapus/nana-sdk-core/v6";
import {
  decodeEventLog,
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { verifyPayoutReceipt, type ExpectedPayoutReceipt } from "./payout-receipts";

/** Exact read-only source snapshots. Hex keeps the durable journal independent of ABI/BigInt JSON. */
export type CallPrecondition = { address: Address; data: Hex; expected: Hex };
export type RejectedReceiptEvent = { topic: Hex; address?: Address };
export type ReservedReceiptGuard = {
  controller: Address;
  tokenRegistry: Address;
  projectId: string;
  amount: string;
  intentionalBurn: string;
};
const RESERVED_RECEIPT_ABI = parseAbi([
  "event SendReservedTokensToSplits(uint256 indexed rulesetId,uint256 indexed rulesetCycleNumber,uint256 indexed projectId,address owner,uint256 tokenCount,uint256 leftoverAmount,address caller)",
  "event Burn(address indexed holder,uint256 indexed projectId,uint256 count,uint256 creditBalance,uint256 tokenBalance,address caller)",
]);
export type ExpectedPayerDeployment = {
  kind: "project-payer";
  projectId: string;
  beneficiary: Address;
  addToBalance: boolean;
  owner: Address;
  memo: string;
  metadata: Hex;
  directory: Address;
};

export async function verifyCallPreconditions(
  client: Pick<PublicClient, "call">,
  guards: readonly CallPrecondition[] = [],
) {
  for (const guard of guards) {
    const result = await client.call({ to: guard.address, data: guard.data });
    if ((result.data ?? "0x").toLowerCase() !== guard.expected.toLowerCase())
      throw new Error(
        "A destination's reviewed state changed. Reconcile any submitted calls, then prepare a new review.",
      );
  }
}

/** Raw Relayr is deliberately limited to the caller-independent canonical payer factory. */
export function requireRawPayerCall(
  target: Address,
  data: Hex,
  value: bigint,
  expected?: ExpectedPayerDeployment,
) {
  if (
    !expected ||
    expected.kind !== "project-payer" ||
    !isAddressEqual(target, JB_PROJECT_PAYER_DEPLOYER) ||
    value !== 0n
  )
    throw new Error(
      "Only the reviewed canonical project payer deployment supports raw Relayr calls.",
    );
  const exact = encodeFunctionData({
    abi: jbProjectPayerDeployerAbi,
    functionName: "deployProjectPayer",
    args: [
      BigInt(expected.projectId),
      expected.beneficiary,
      expected.memo,
      expected.metadata,
      expected.addToBalance,
      expected.owner,
    ],
  });
  if (exact.toLowerCase() !== data.toLowerCase())
    throw new Error("The raw payer call does not match its reviewed deployment settings.");
}

export async function verifyActionReceipt(
  client: Pick<PublicClient, "getCode">,
  receipt: TransactionReceipt,
  target: Address,
  expected?: ExpectedPayerDeployment,
  rejectEvents: readonly RejectedReceiptEvent[] = [],
  reservedReceipt?: ReservedReceiptGuard,
  expectedPayout?: ExpectedPayoutReceipt,
) {
  if (
    rejectEvents.length &&
    receipt.logs.some((log) =>
      rejectEvents.some(
        (event) =>
          log.topics[0]?.toLowerCase() === event.topic.toLowerCase() &&
          (!event.address || isAddressEqual(event.address, log.address)),
      ),
    )
  )
    throw new Error(
      "The destination confirmed with an incomplete recipient result. Keep the original transaction for reconciliation; do not submit it again.",
    );
  if (reservedReceipt) {
    let burns = 0n;
    const totals: bigint[] = [];
    for (const log of receipt.logs) {
      if (isAddressEqual(log.address, reservedReceipt.controller)) {
        try {
          const event = decodeEventLog({
            abi: RESERVED_RECEIPT_ABI,
            eventName: "SendReservedTokensToSplits",
            topics: log.topics,
            data: log.data,
          }).args;
          if (event.projectId === BigInt(reservedReceipt.projectId)) totals.push(event.tokenCount);
        } catch {
          /* Other events are unrelated. */
        }
      }
      if (isAddressEqual(log.address, reservedReceipt.tokenRegistry)) {
        try {
          const event = decodeEventLog({
            abi: RESERVED_RECEIPT_ABI,
            eventName: "Burn",
            topics: log.topics,
            data: log.data,
          }).args;
          if (
            event.projectId === BigInt(reservedReceipt.projectId) &&
            isAddressEqual(event.holder, reservedReceipt.controller)
          )
            burns += event.count;
        } catch {
          /* Other events are unrelated. */
        }
      }
    }
    if (
      totals.length !== 1 ||
      totals[0] !== BigInt(reservedReceipt.amount) ||
      burns !== BigInt(reservedReceipt.intentionalBurn)
    )
      throw new Error(
        "Reserved distribution did not deliver its reviewed amount: tokens may have been burned by an incomplete hook. Reconcile the original transaction; do not distribute again.",
      );
  }
  if (expectedPayout) verifyPayoutReceipt(receipt, expectedPayout);
  if (!expected) return;
  const events = receipt.logs.flatMap((log) => {
    if (!isAddressEqual(log.address, target)) return [];
    try {
      return [
        decodeEventLog({
          abi: jbProjectPayerDeployerAbi,
          eventName: "DeployProjectPayer",
          data: log.data,
          topics: log.topics,
        }).args,
      ];
    } catch {
      return [];
    }
  });
  if (events.length !== 1)
    throw new Error(
      "The payer deployment did not emit exactly one verifiable factory event. Do not deploy again.",
    );
  const event = events[0];
  if (
    event.defaultProjectId !== BigInt(expected.projectId) ||
    !isAddressEqual(event.defaultBeneficiary, expected.beneficiary) ||
    event.defaultMemo !== expected.memo ||
    event.defaultMetadata.toLowerCase() !== expected.metadata.toLowerCase() ||
    event.defaultAddToBalance !== expected.addToBalance ||
    !isAddressEqual(event.owner, expected.owner) ||
    !isAddressEqual(event.directory, expected.directory)
  )
    throw new Error(
      "The deployed payer event does not match the frozen review. Do not deploy again.",
    );
  const code = await client.getCode({ address: event.projectPayer });
  if (!code || code === "0x")
    throw new Error(
      "The reported payer has no deployed code. Keep the transaction for reconciliation.",
    );
}
