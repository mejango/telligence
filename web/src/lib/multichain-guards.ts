import type { SafeRelayrExecution } from "@bananapus/nana-sdk-core/review/safe-relayr";
import {
  JB_PROJECT_PAYER_DEPLOYER,
  jbProjectPayerDeployerAbi,
  verifyPayoutReceipt,
  verifyReservedDistributionReceipt,
  type ExpectedPayoutReceipt,
  type ExpectedReservedReceipt,
} from "@bananapus/nana-sdk-core/v6";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { verifyRouterPendingReceipt, type RouterPendingReceiptGuard } from "./pending-router-calls";
import { routerGatewayAbi } from "./router-gateway-abi";

/** Exact read-only source snapshots. Hex keeps the durable journal independent of ABI/BigInt JSON. */
export type CallPrecondition = { address: Address; data: Hex; expected: Hex };
export type RejectedReceiptEvent = { topic: Hex; address?: Address };
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
  // Only identical snapshots in this pass share a read; later passes must read fresh state.
  const checked = new Set<string>();
  for (const guard of guards) {
    const key = `${guard.address}:${guard.data}:${guard.expected}`.toLowerCase();
    if (checked.has(key)) continue;
    checked.add(key);
    const result = await client.call({ to: guard.address, data: guard.data });
    if ((result.data ?? "0x").toLowerCase() !== guard.expected.toLowerCase())
      throw new Error(
        "A destination's reviewed state changed. Reconcile any submitted calls, then prepare a new review.",
      );
  }
}

/** A keeper may advance a retained call while earlier batch calls are executing. */
export async function readRouterPendingAdvance(
  client: Pick<PublicClient, "call">,
  guard: RouterPendingReceiptGuard,
  preconditions: readonly CallPrecondition[] = [],
): Promise<"resolved-externally" | "retried-externally" | undefined> {
  const read = async (functionName: "pendingCallCommitmentOf" | "pendingCallFailureOf") => {
    const data = encodeFunctionData({
      abi: routerGatewayAbi,
      functionName,
      args: [guard.pendingCallId],
    });
    const snapshot = preconditions.find(
      (item) =>
        isAddressEqual(item.address, guard.gateway) &&
        item.data.toLowerCase() === data.toLowerCase(),
    );
    if (!snapshot) throw new Error("The saved routing call has no authenticated source snapshot.");
    const current = await client.call({ to: guard.gateway, data });
    return { snapshot: snapshot.expected, current: current.data ?? "0x" };
  };
  const commitment = await read("pendingCallCommitmentOf");
  const currentCommitment = decodeFunctionResult({
    abi: routerGatewayAbi,
    functionName: "pendingCallCommitmentOf",
    data: commitment.current,
  });
  if (currentCommitment === zeroHash) return "resolved-externally";
  if (commitment.current.toLowerCase() !== commitment.snapshot.toLowerCase()) {
    throw new Error("The saved payment no longer matches the gateway commitment.");
  }
  const failure = await read("pendingCallFailureOf");
  const previous = decodeFunctionResult({
    abi: routerGatewayAbi,
    functionName: "pendingCallFailureOf",
    data: failure.snapshot,
  });
  const current = decodeFunctionResult({
    abi: routerGatewayAbi,
    functionName: "pendingCallFailureOf",
    data: failure.current,
  });
  if (current.count > 0 && current.lastFailureAt > previous.lastFailureAt) {
    return "retried-externally";
  }
}

/** A fully signed Safe transaction that Relayr may execute. */
export type ExpectedSafeExecution = Pick<SafeRelayrExecution, "safe" | "safeTxHash" | "nonce">;

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
    throw new Error("Only the reviewed canonical project payer deployment supports raw calls.");
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
  reservedReceipt?: ExpectedReservedReceipt,
  expectedPayout?: ExpectedPayoutReceipt,
  expectedRouterPending?: RouterPendingReceiptGuard,
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
  // Reserves accrue until the distribution runs, and a Safe can execute it days after the review,
  // so the receipt may distribute more than was reviewed. Any count at or above the reviewed one
  // confirms, with every reviewed split's share, in order, checked against the count distributed
  // from the receipt's own events. A smaller count (another distribution ran first), another
  // ruleset or cycle, or a failed recipient is refused.
  if (reservedReceipt) verifyReservedDistributionReceipt(receipt, reservedReceipt);
  if (expectedPayout) verifyPayoutReceipt(receipt, expectedPayout);
  const routerResult = expectedRouterPending
    ? verifyRouterPendingReceipt(receipt, expectedRouterPending)
    : undefined;
  if (!expected) return routerResult;
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
  return routerResult;
}
