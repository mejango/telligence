import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { gasWithHeadroom, TRANSACTION_GAS_CAP } from "@bananapus/nana-sdk-core/review";
import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  formatUnits,
  isAddress,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { queryBendystrawFromBrowser } from "./bendystraw/client";
import { RouterPendingCallsOperation } from "./bendystraw/operations";
import type { IndexedRouterPendingCall } from "./bendystraw/types";
import {
  isBatchCallHandled,
  readMultichainBatches,
  type FrozenBatchCall,
  type MultichainCall,
} from "./multichain-batch";
import type { CallPrecondition } from "./multichain-guards";
import { rolloutChain, rolloutContractName } from "./protocol-rollout";
import { routerGatewayAbi } from "./router-gateway-abi";

const CALL_PARAMETERS = parseAbiParameters(
  "(uint256 amount,bool preferAddToBalance,bool shouldReturnHeldFees,address beneficiary,uint256 projectId,address refundTo,uint256 sourceProjectId,address token)",
);
const COMMITMENT_PARAMETERS = [...CALL_PARAMETERS, { type: "string" }, { type: "bytes" }] as const;
const LIMITS_ABI = parseAbi([
  "function maximumQualifiedCallGas() view returns (uint256)",
  "function RETRY_DELAY() view returns (uint256)",
]);
const GAS_EXHAUSTED = keccak256(stringToHex("JBRouterTerminalGateway: gas exhausted"));
type PendingClient = Pick<
  PublicClient,
  "readContract" | "getBlock" | "request" | "estimateContractGas"
>;
type Failure = { errorHash: Hex; count: number; lastFailureAt: number; highestGasLimit: bigint };
type PendingCall = {
  amount: bigint;
  preferAddToBalance: boolean;
  shouldReturnHeldFees: boolean;
  beneficiary: Address;
  projectId: bigint;
  refundTo: Address;
  sourceProjectId: bigint;
  token: Address;
};
export type PendingProject = { chainId: number; projectId: number; version: number };
export type RouterPendingReceiptGuard = { gateway: Address; pendingCallId: Hex; callHash: Hex };
export type PendingRouterPayment = {
  id: string;
  indexed: IndexedRouterPendingCall;
  call: PendingCall;
  nextAttemptAt: bigint;
  ready: boolean;
  action: "processPendingCall" | "finalizePendingCall";
  amountLabel: string;
  gas: bigint;
  gasCap: bigint;
  preconditions: CallPrecondition[];
};

function hashCall(call: PendingCall) {
  return keccak256(encodeAbiParameters(CALL_PARAMETERS, [call]));
}

export function pendingRouterCommitment(call: PendingCall, memo: string, metadata: Hex) {
  return keccak256(encodeAbiParameters(COMMITMENT_PARAMETERS, [call, memo, metadata]));
}

/** Match a real transaction: token-controlled OffchainLookup errors must never redirect a preflight. */
export async function simulatePendingRouterCall(
  client: Pick<PublicClient, "request">,
  call: { from: Address; to: Address; data: Hex; gas: bigint },
): Promise<Hex> {
  return client.request({
    method: "eth_call",
    params: [
      {
        from: call.from,
        to: call.to,
        data: call.data,
        gas: toHex(call.gas),
        value: "0x0",
      },
      "latest",
    ],
  });
}

function requireHex(value: unknown, bytes?: number): asserts value is Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[a-fA-F0-9]{2})*$/u.test(value) ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)
  ) {
    throw new Error("The indexed payment contains invalid transaction data.");
  }
}

function requireKnownGateway(chainId: number, gateway: Address) {
  if (!rolloutContractName(chainId, gateway)?.startsWith("JBRouterTerminalGateway")) {
    throw new Error("This payment's gateway is not in the verified deployment records.");
  }
}

/** Raw Relayr may execute only the exact authenticated, permissionless routing attempt. */
export function requireRawPendingRouterCall(
  chainId: number,
  target: Address,
  data: Hex,
  value: bigint,
  guard?: RouterPendingReceiptGuard,
  preconditions?: readonly CallPrecondition[],
): void {
  if (!guard || value !== 0n || !isAddressEqual(target, guard.gateway)) {
    throw new Error("Raw routing requires the reviewed gateway and zero native value.");
  }
  requireKnownGateway(chainId, target);
  const decoded = decodeFunctionData({ abi: routerGatewayAbi, data });
  if (
    decoded.functionName !== "processPendingCall" &&
    decoded.functionName !== "finalizePendingCall"
  ) {
    throw new Error("Raw routing supports only a reviewed pending-payment retry or final attempt.");
  }
  if (
    encodeFunctionData({ abi: routerGatewayAbi, ...decoded }).toLowerCase() !== data.toLowerCase()
  ) {
    throw new Error("The raw routing call is not canonical.");
  }
  const [id, call, memo, metadata] = decoded.args;
  if (
    id.toLowerCase() !== guard.pendingCallId.toLowerCase() ||
    hashCall(call).toLowerCase() !== guard.callHash.toLowerCase()
  ) {
    throw new Error("The raw routing call does not match the reviewed payment.");
  }
  const commitment = pendingRouterCommitment(call, memo, metadata);
  const commitmentData = encodeFunctionData({
    abi: routerGatewayAbi,
    functionName: "pendingCallCommitmentOf",
    args: [id],
  });
  const commitmentResult = encodeFunctionResult({
    abi: routerGatewayAbi,
    functionName: "pendingCallCommitmentOf",
    result: commitment,
  });
  const failureData = encodeFunctionData({
    abi: routerGatewayAbi,
    functionName: "pendingCallFailureOf",
    args: [id],
  });
  const atGateway = (condition: CallPrecondition) => isAddressEqual(condition.address, target);
  const committed = preconditions?.some(
    (condition) =>
      atGateway(condition) &&
      condition.data.toLowerCase() === commitmentData.toLowerCase() &&
      condition.expected.toLowerCase() === commitmentResult.toLowerCase(),
  );
  const failure = preconditions?.find(
    (condition) =>
      atGateway(condition) && condition.data.toLowerCase() === failureData.toLowerCase(),
  );
  if (!committed || !failure)
    throw new Error("Raw routing requires the original commitment and failure-state checks.");
  const failureResult = decodeFunctionResult({
    abi: routerGatewayAbi,
    functionName: "pendingCallFailureOf",
    data: failure.expected,
  });
  if (
    encodeFunctionResult({
      abi: routerGatewayAbi,
      functionName: "pendingCallFailureOf",
      result: failureResult,
    }).toLowerCase() !== failure.expected.toLowerCase()
  ) {
    throw new Error("The reviewed routing failure state is not canonical.");
  }
}

/** Decode the exact saved routing request for recovery review, even if indexing has moved on. */
export function describeSavedRoutingCall(saved: FrozenBatchCall) {
  requireRawPendingRouterCall(
    saved.chainId,
    saved.address,
    saved.data,
    saved.value ?? 0n,
    saved.expectedRouterPending,
    saved.preconditions,
  );
  const decoded = decodeFunctionData({ abi: routerGatewayAbi, data: saved.data });
  if (
    decoded.functionName !== "processPendingCall" &&
    decoded.functionName !== "finalizePendingCall"
  )
    throw new Error("The saved call is not a pending routing attempt.");
  const [pendingCallId, call] = decoded.args;
  return {
    id: `${saved.chainId}:${saved.address.toLowerCase()}:${pendingCallId.toLowerCase()}`,
    chainId: saved.chainId,
    projectId: call.projectId.toString(),
    sourceProjectId: call.sourceProjectId.toString(),
    amountLabel: isAddressEqual(call.token, NATIVE_TOKEN)
      ? `${formatUnits(call.amount, 18)} ETH`
      : "Amount unavailable",
    beneficiary: call.beneficiary,
    pendingCallId,
    hash: saved.hash,
    state: saved.state,
  };
}

/** Find old source-scoped journals by their exact destination calls, without rewriting recovery. */
export function findPendingRoutingBatch(account: Address, projects: readonly PendingProject[]) {
  return readMultichainBatches().find((batch) => {
    if (batch.status !== "pending" || !isAddressEqual(batch.account, account)) return false;
    const unfinished = batch.calls.filter((saved) => !isBatchCallHandled(saved));
    // Recovery may have stopped after the final call's receipt, before completing the journal.
    return (unfinished.length ? unfinished : batch.calls).some((saved) => {
      if (!saved.expectedRouterPending) return false;
      try {
        requireRawPendingRouterCall(
          saved.chainId,
          saved.address,
          saved.data,
          saved.value ?? 0n,
          saved.expectedRouterPending,
          saved.preconditions,
        );
        const decoded = decodeFunctionData({ abi: routerGatewayAbi, data: saved.data });
        if (
          decoded.functionName !== "processPendingCall" &&
          decoded.functionName !== "finalizePendingCall"
        )
          return false;
        return projects.some(
          (project) =>
            project.version === 6 &&
            project.chainId === saved.chainId &&
            BigInt(project.projectId) === decoded.args[1].projectId,
        );
      } catch {
        return false;
      }
    });
  });
}

/** Every page and identity is required before offering “all pending”. */
export async function readIndexedPendingRouterCalls(project: PendingProject) {
  if (project.version !== 6) return [];
  const chain = rolloutChain(project.chainId);
  const gateways = [
    ...new Set(
      [
        chain?.contracts.JBRouterTerminalGateway,
        ...Object.values(chain?.history.JBRouterTerminalGateway ?? {}),
      ]
        .filter((address): address is string => Boolean(address))
        .map((address) => address.toLowerCase()),
    ),
  ];
  // A pending ID is unique only within a gateway. Separate queries preserve a
  // deterministic order across deployment generations and never depend on the project's current router.
  return (
    await Promise.all(gateways.map((gateway) => readGatewayPendingCalls(project, gateway)))
  ).flat();
}

async function readGatewayPendingCalls(project: PendingProject, gateway: string) {
  const items: IndexedRouterPendingCall[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  do {
    const result = await queryBendystrawFromBrowser(
      RouterPendingCallsOperation,
      {
        chainId: project.chainId,
        projectId: project.projectId,
        gateway,
        limit: 100,
        offset: items.length,
      },
      project.chainId,
    );
    const page = result.routerPendingCalls;
    if (
      !Number.isSafeInteger(page?.totalCount) ||
      page.totalCount < 0 ||
      (total !== undefined && total !== page.totalCount) ||
      (page.items.length === 0 && items.length < page.totalCount)
    ) {
      throw new Error("Pending payments changed while loading. Refresh before routing them.");
    }
    total = page.totalCount;
    for (const item of page.items) {
      const key = `${item.chainId}:${item.gateway.toLowerCase()}:${item.pendingCallId.toLowerCase()}`;
      if (
        item.chainId !== project.chainId ||
        item.projectId !== project.projectId ||
        item.gateway.toLowerCase() !== gateway ||
        item.version !== 6 ||
        !["queued", "retried"].includes(item.status) ||
        seen.has(key)
      ) {
        throw new Error("The pending payment index returned inconsistent project data.");
      }
      seen.add(key);
      items.push(item);
    }
    if (items.length > total)
      throw new Error("The pending payment index returned an incomplete list.");
  } while (items.length < total);
  return items;
}

/** The index discovers calls; the original commitment and live failure state authorize action. */
export async function readPendingRouterPayment(
  client: PendingClient,
  indexed: IndexedRouterPendingCall,
): Promise<PendingRouterPayment | null> {
  for (const address of [indexed.gateway, indexed.token, indexed.beneficiary, indexed.refundTo]) {
    if (!isAddress(address)) throw new Error("The indexed payment contains an invalid address.");
  }
  requireKnownGateway(indexed.chainId, indexed.gateway as Address);
  requireHex(indexed.pendingCallId, 32);
  requireHex(indexed.callCommitment, 32);
  requireHex(indexed.metadata);
  if (
    !Number.isSafeInteger(indexed.projectId) ||
    indexed.projectId <= 0 ||
    !Number.isSafeInteger(indexed.sourceProjectId) ||
    indexed.sourceProjectId <= 0 ||
    typeof indexed.preferAddToBalance !== "boolean" ||
    typeof indexed.shouldReturnHeldFees !== "boolean" ||
    typeof indexed.memo !== "string" ||
    !/^\d+$/u.test(indexed.amount) ||
    !/^\d+$/u.test(indexed.retainedAmount)
  ) {
    throw new Error("The indexed payment contains invalid call fields.");
  }
  const call: PendingCall = {
    amount: BigInt(indexed.amount),
    preferAddToBalance: indexed.preferAddToBalance,
    shouldReturnHeldFees: indexed.shouldReturnHeldFees,
    beneficiary: indexed.beneficiary as Address,
    projectId: BigInt(indexed.projectId),
    refundTo: indexed.refundTo as Address,
    sourceProjectId: BigInt(indexed.sourceProjectId),
    token: indexed.token as Address,
  };
  if (
    call.amount <= 0n ||
    BigInt(indexed.retainedAmount) !== call.amount ||
    call.token === zeroAddress
  ) {
    throw new Error("The pending payment's retained amount does not match its original call.");
  }
  const commitment = pendingRouterCommitment(call, indexed.memo, indexed.metadata);
  if (commitment.toLowerCase() !== indexed.callCommitment.toLowerCase()) {
    throw new Error("The indexed payment does not match its original commitment.");
  }
  const gateway = indexed.gateway as Address;
  const pendingCallId = indexed.pendingCallId;
  const preconditions: CallPrecondition[] = [];
  const read = async (functionName: "pendingCallCommitmentOf" | "pendingCallFailureOf") => {
    const args = [pendingCallId] as const;
    const result = await client.readContract({
      address: gateway,
      abi: routerGatewayAbi,
      functionName,
      args,
    });
    preconditions.push({
      address: gateway,
      data: encodeFunctionData({ abi: routerGatewayAbi, functionName, args }),
      expected: encodeFunctionResult({ abi: routerGatewayAbi, functionName, result }),
    });
    return result;
  };
  const liveCommitment = (await read("pendingCallCommitmentOf")) as Hex;
  if (liveCommitment === zeroHash) return null;
  if (liveCommitment.toLowerCase() !== commitment.toLowerCase()) {
    throw new Error("The payment no longer matches the gateway's pending commitment.");
  }
  const [failure, block, retryDelay, maximumGas] = await Promise.all([
    read("pendingCallFailureOf") as Promise<Failure>,
    client.getBlock(),
    client.readContract({ address: gateway, abi: LIMITS_ABI, functionName: "RETRY_DELAY" }),
    client.readContract({
      address: gateway,
      abi: LIMITS_ABI,
      functionName: "maximumQualifiedCallGas",
    }),
  ]);
  const nextAttemptAt = failure.count ? BigInt(failure.lastFailureAt) + retryDelay : 0n;
  let forwarded =
    failure.errorHash === GAS_EXHAUSTED ? 5_000_000n * BigInt(failure.count + 1) : 5_000_000n;
  if (failure.highestGasLimit > forwarded) forwarded = failure.highestGasLimit;
  if (forwarded > maximumGas) forwarded = maximumGas;
  if (maximumGas < 5_000_000n)
    throw new Error("This chain cannot currently fit a qualified routing attempt.");
  // Match the gateway's live per-transaction ceiling, including its accounting reserves.
  const gas = forwarded + (forwarded + 62n) / 63n + 1_500_000n;
  if (typeof block.gasLimit !== "bigint" || block.gasLimit <= 0n) {
    throw new Error("The chain's executable transaction gas limit is unavailable.");
  }
  const gasCap = block.gasLimit < TRANSACTION_GAS_CAP ? block.gasLimit : TRANSACTION_GAS_CAP;
  let amountLabel = "Amount unavailable";
  if (isAddressEqual(call.token, NATIVE_TOKEN)) amountLabel = `${formatUnits(call.amount, 18)} ETH`;
  else {
    try {
      const [decimals, symbol] = await Promise.all([
        client.readContract({ address: call.token, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: call.token, abi: erc20Abi, functionName: "symbol" }),
      ]);
      amountLabel = `${formatUnits(call.amount, decimals)} ${symbol}`;
    } catch {
      /* Keep unreadable token metadata separate from a displayable amount. */
    }
  }
  return {
    id: `${indexed.chainId}:${gateway.toLowerCase()}:${pendingCallId.toLowerCase()}`,
    indexed,
    call,
    nextAttemptAt,
    ready: block.timestamp >= nextAttemptAt,
    action: failure.count >= 3 ? "finalizePendingCall" : "processPendingCall",
    amountLabel,
    gas,
    gasCap,
    preconditions,
  };
}

export async function preparePendingRouterPayment(
  client: PendingClient,
  indexed: IndexedRouterPendingCall,
  account: Address,
): Promise<{ payment: PendingRouterPayment; call: MultichainCall }> {
  const payment = await readPendingRouterPayment(client, indexed);
  if (!payment) throw new Error("This payment has already resolved. Refresh the pending list.");
  if (!payment.ready)
    throw new Error("This payment is still in its retry cooldown. Refresh when it is ready.");
  const args = [
    indexed.pendingCallId as Hex,
    payment.call,
    indexed.memo,
    indexed.metadata as Hex,
  ] as const;
  const request = {
    address: indexed.gateway as Address,
    abi: routerGatewayAbi,
    functionName: payment.action,
    args,
    account,
  };
  // Finalizer refunds can visit several live source terminals. The protocol's
  // 1.5M reserve is not a ceiling on that work: measure with the full executable
  // cap, then preserve bounded headroom through the reviewed transaction path.
  const data = encodeFunctionData(request);
  const simulate = async (gas: bigint) => {
    const result = await simulatePendingRouterCall(client, {
      from: account,
      to: request.address,
      data,
      gas,
    });
    decodeFunctionResult({ abi: routerGatewayAbi, functionName: payment.action, data: result });
  };
  await simulate(payment.gasCap);
  const estimated = await client.estimateContractGas({ ...request, gas: payment.gasCap });
  const measured = gasWithHeadroom(estimated);
  const requested = measured > payment.gas ? measured : payment.gas;
  const gas = requested < payment.gasCap ? requested : payment.gasCap;
  const call: MultichainCall = {
    chainId: indexed.chainId,
    address: indexed.gateway as Address,
    abi: routerGatewayAbi,
    functionName: payment.action,
    args,
    value: 0n,
    gas,
    contractName: "Router terminal gateway",
    preconditions: payment.preconditions,
    recoveryScope: `pending-routing:${payment.id}`,
    relayrMode: "raw",
    expectedRouterPending: {
      gateway: indexed.gateway as Address,
      pendingCallId: indexed.pendingCallId as Hex,
      callHash: hashCall(payment.call),
    },
  };
  await simulate(gas);
  return { payment, call };
}

/** An executed attempt can retain custody again. Never infer settlement from status alone. */
export function verifyRouterPendingReceipt(
  receipt: TransactionReceipt,
  guard: RouterPendingReceiptGuard,
) {
  const outcomes: Array<"settled" | "refunded" | "pending"> = [];
  if (receipt.status !== "success") throw new Error("The routing transaction reverted.");
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, guard.gateway)) continue;
    let event;
    try {
      event = decodeEventLog({ abi: routerGatewayAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    if (!("id" in event.args) || event.args.id.toLowerCase() !== guard.pendingCallId.toLowerCase())
      continue;
    if (event.eventName === "JBRouterTerminalGateway_RecordTerminalCallFailure")
      outcomes.push("pending");
    else if (
      event.eventName === "JBRouterTerminalGateway_ProcessPendingCall" ||
      event.eventName === "JBRouterTerminalGateway_RefundPendingCall"
    ) {
      if (hashCall(event.args.call).toLowerCase() !== guard.callHash.toLowerCase()) {
        throw new Error("The routing receipt does not match the reviewed payment.");
      }
      outcomes.push(
        event.eventName === "JBRouterTerminalGateway_ProcessPendingCall" ? "settled" : "refunded",
      );
    }
  }
  if (outcomes.length !== 1)
    throw new Error(
      "The routing transaction has no unique verified payment result. Reconcile it before trying again.",
    );
  return outcomes[0];
}
