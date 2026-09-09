import type { SafeQueuedTransaction } from "@/lib/safe-queue";
import {
  JBCoreContracts,
  RevnetCoreContracts,
  getJBContractAddress,
  jbProjectsAbi,
  revOwnerAbi,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  isAddress,
  isAddressEqual,
  namehash,
  size,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { readCrossChainHandleAuthority } from "./cross-chain-authority";
import {
  ENS_REGISTRY_ADDRESS,
  JB_PROJECT_HANDLES_ADDRESS,
  PROJECT_HANDLE_CHAIN_ID,
  PROJECT_HANDLE_TEXT_KEY,
  canonicalProjectHandleParts,
  ensRegistryAbi,
  ensTextResolverAbi,
  jbProjectHandlesAbi,
  parseProjectHandleRecord,
  projectHandleRecord,
  readExactEnsText,
  readExactProjectHandle,
  simulateExactEnsTextTransaction,
  type ProjectHandle,
  type ProjectHandleRecord,
} from "./projectHandles";

const MAX_HANDLE_CALLDATA_BYTES = 32_768;
const MAX_UINT256 = (1n << 256n) - 1n;
const SET_TEXT_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: ensTextResolverAbi, name: "setText" }),
);
const SET_HANDLE_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: jbProjectHandlesAbi, name: "setEnsNamePartsFor" }),
);

export type QueuedProjectHandleBinding =
  | {
      kind: "ens-text";
      node: Hex;
      record: ProjectHandleRecord;
      value: string;
    }
  | {
      kind: "project-handle";
      source: ProjectHandleRecord;
      handle: ProjectHandle;
    };

export type ProjectSafeQueueSource = {
  chainId: JBChainId;
  projectId: number;
  safe: Address;
};

export type ProjectSafeQueueTarget = {
  /** Chain which hosts the Safe queue. */
  chainId: JBChainId;
  safe: Address;
  /** Live project tuples which justify surfacing this Safe. */
  authorityRows: Array<{ chainId: JBChainId; projectId: number }>;
  /** Mainnet-only synthetic queue: never show unrelated Safe transactions. */
  handleOnly: boolean;
  /** Synthetic queues are restricted to the project currently being viewed. */
  handleSource?: { chainId: JBChainId; projectId: number };
};

/**
 * Add a synthetic Ethereum queue when the viewed L2 project's operator Safe
 * has no ordinary Ethereum project row. ProjectHandleEditor can propose its
 * two handle calls there even when the revnet itself is L2-only.
 */
export function projectSafeQueueTargets(
  sources: readonly ProjectSafeQueueSource[],
  viewedProject: { chainId: JBChainId; projectId: number },
): ProjectSafeQueueTarget[] {
  const targets: ProjectSafeQueueTarget[] = sources.map((source) => ({
    chainId: source.chainId,
    safe: source.safe,
    authorityRows: [{ chainId: source.chainId, projectId: source.projectId }],
    handleOnly: false,
  }));
  const viewedSource = sources.find(
    (source) =>
      source.chainId === viewedProject.chainId && source.projectId === viewedProject.projectId,
  );
  if (!viewedSource || viewedSource.chainId === PROJECT_HANDLE_CHAIN_ID) return targets;

  const regularMainnetSafes = new Set(
    sources
      .filter((source) => source.chainId === PROJECT_HANDLE_CHAIN_ID)
      .map((source) => source.safe.toLowerCase()),
  );
  if (regularMainnetSafes.has(viewedSource.safe.toLowerCase())) return targets;
  targets.push({
    chainId: PROJECT_HANDLE_CHAIN_ID as JBChainId,
    safe: viewedSource.safe,
    authorityRows: [viewedProject],
    handleOnly: true,
    handleSource: viewedProject,
  });
  return targets;
}

/** Synthetic mainnet queues expose handle calls only for the viewed tuple. */
export function bindingMatchesProject(
  binding: QueuedProjectHandleBinding,
  project: { chainId: number; projectId: number | bigint },
): boolean {
  const source = binding.kind === "ens-text" ? binding.record : binding.source;
  return source.chainId === project.chainId && source.projectId === BigInt(project.projectId);
}

function transactionData(tx: SafeQueuedTransaction): Hex {
  const data = tx.data ?? "0x";
  if (!/^0x(?:[\da-fA-F]{2})*$/.test(data)) {
    throw new Error("The queued transaction has malformed calldata.");
  }
  return data;
}

function safeUint256(value: unknown, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new Error(`The queued transaction has a malformed ${field}.`);
    }
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > 78) {
    throw new Error(`The queued transaction has a malformed ${field}.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed > MAX_UINT256) throw new Error();
    return parsed;
  } catch {
    throw new Error(`The queued transaction has an out-of-range ${field}.`);
  }
}

function assertCanonicalHandleSafeEnvelope(tx: SafeQueuedTransaction): void {
  if (!Number.isSafeInteger(tx.operation) || tx.operation !== 0) {
    throw new Error("Queued project-handle writes must be direct Safe calls.");
  }
  if (safeUint256(tx.value, "value") !== 0n) {
    throw new Error("Queued project-handle writes must not transfer ETH.");
  }
  for (const [field, value] of [
    ["safeTxGas", tx.safeTxGas],
    ["baseGas", tx.baseGas],
    ["gasPrice", tx.gasPrice],
  ] as const) {
    if (safeUint256(value, field) !== 0n) {
      throw new Error(`Queued project-handle writes must use zero ${field}.`);
    }
  }
  for (const [field, value] of [
    ["gasToken", tx.gasToken],
    ["refundReceiver", tx.refundReceiver],
  ] as const) {
    if (!isAddress(value)) {
      throw new Error(`The queued transaction has a malformed ${field}.`);
    }
    if (!isAddressEqual(value, zeroAddress)) {
      throw new Error(`Queued project-handle writes must use the zero ${field}.`);
    }
  }
}

function selectorOf(data: Hex): string | null {
  return size(data) >= 4 ? data.slice(0, 10).toLowerCase() : null;
}

/**
 * Decode only direct Ethereum calls which can change either half of a project
 * handle binding. Calls which are not handle writes return null unchanged;
 * matching-but-malformed calls fail closed.
 */
export function classifyQueuedProjectHandleTransaction(
  executionChainId: number,
  tx: SafeQueuedTransaction,
): QueuedProjectHandleBinding | null {
  if (executionChainId !== PROJECT_HANDLE_CHAIN_ID) return null;

  const data = transactionData(tx);
  const selector = selectorOf(data);
  const isHandlesTarget =
    typeof tx.to === "string" && tx.to.toLowerCase() === JB_PROJECT_HANDLES_ADDRESS.toLowerCase();

  if (isHandlesTarget && selector === SET_HANDLE_SELECTOR.toLowerCase()) {
    if (size(data) > MAX_HANDLE_CALLDATA_BYTES) {
      throw new Error("The queued project-handle calldata is too large to inspect safely.");
    }
    assertCanonicalHandleSafeEnvelope(tx);
    let decoded: ReturnType<typeof decodeFunctionData>;
    try {
      decoded = decodeFunctionData({ abi: jbProjectHandlesAbi, data });
    } catch {
      throw new Error("The queued project-handle call cannot be decoded exactly.");
    }
    if (decoded.functionName !== "setEnsNamePartsFor" || !decoded.args) {
      throw new Error("The queued project-handle call changed while it was decoded.");
    }
    const [encodedChainId, encodedProjectId, encodedParts] = decoded.args;
    if (
      typeof encodedChainId !== "bigint" ||
      typeof encodedProjectId !== "bigint" ||
      !Array.isArray(encodedParts) ||
      !encodedParts.every((part) => typeof part === "string")
    ) {
      throw new Error("The queued project-handle arguments are malformed.");
    }
    const source = parseProjectHandleRecord(
      `${encodedChainId.toString()}:${encodedProjectId.toString()}`,
    );
    if (!source) throw new Error("The queued project-handle source tuple is unsupported.");
    const handle = canonicalProjectHandleParts(encodedParts);
    if (!handle) throw new Error("The queued ENS name parts are not canonical.");
    const canonicalData = encodeFunctionData({
      abi: jbProjectHandlesAbi,
      functionName: "setEnsNamePartsFor",
      args: [encodedChainId, encodedProjectId, encodedParts],
    });
    if (canonicalData.toLowerCase() !== data.toLowerCase()) {
      throw new Error("The queued project-handle calldata has non-canonical trailing data.");
    }
    return { kind: "project-handle", source, handle };
  }

  if (selector !== SET_TEXT_SELECTOR.toLowerCase()) return null;
  if (size(data) > MAX_HANDLE_CALLDATA_BYTES) {
    throw new Error("The queued ENS text calldata is too large to inspect safely.");
  }
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({ abi: ensTextResolverAbi, data });
  } catch {
    throw new Error("The queued ENS text call cannot be decoded exactly.");
  }
  if (decoded.functionName !== "setText" || !decoded.args) {
    throw new Error("The queued ENS text call changed while it was decoded.");
  }
  const [node, key, value] = decoded.args;
  if (key !== PROJECT_HANDLE_TEXT_KEY) return null;
  assertCanonicalHandleSafeEnvelope(tx);
  if (typeof node !== "string" || typeof value !== "string") {
    throw new Error("The queued ENS project record is malformed.");
  }
  const record = parseProjectHandleRecord(value);
  if (!record) throw new Error("The queued ENS project record is not a supported source tuple.");
  const canonicalData = encodeFunctionData({
    abi: ensTextResolverAbi,
    functionName: "setText",
    args: [node as Hex, PROJECT_HANDLE_TEXT_KEY, value],
  });
  if (canonicalData.toLowerCase() !== data.toLowerCase()) {
    throw new Error("The queued ENS text calldata has non-canonical trailing data.");
  }
  return { kind: "ens-text", node: node as Hex, record, value };
}

export type ProjectHandleClientFor = (chainId: JBChainId) => PublicClient;

async function assertCurrentProjectAuthority({
  source,
  sourceClient,
  sourceBlockNumber,
  safe,
}: {
  source: ProjectHandleRecord;
  sourceClient: PublicClient;
  sourceBlockNumber: bigint;
  safe: Address;
}): Promise<void> {
  const projects = getJBContractAddress(JBCoreContracts.JBProjects, 6, source.chainId);
  const revOwner = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, source.chainId);
  let owner: Address;
  try {
    owner = await sourceClient.readContract({
      address: projects,
      abi: jbProjectsAbi,
      functionName: "ownerOf",
      args: [source.projectId],
      blockNumber: sourceBlockNumber,
    });
  } catch {
    throw new Error("The queued handle's encoded project owner could not be verified.");
  }
  if (!isAddressEqual(owner, revOwner)) {
    throw new Error("The encoded project is no longer controlled by canonical REVOwner.");
  }
  let isOperator = false;
  try {
    isOperator = await sourceClient.readContract({
      address: revOwner,
      abi: revOwnerAbi,
      functionName: "isOperatorOf",
      args: [source.projectId, safe],
      blockNumber: sourceBlockNumber,
    });
  } catch {
    throw new Error("The queued handle's encoded revnet operator could not be verified.");
  }
  if (!isOperator) {
    throw new Error("This Safe is no longer the encoded revnet's live operator.");
  }
}

async function assertLiveProjectHandleAuthority({
  source,
  safe,
  clientFor,
  mainnetClient,
  mainnetBlockNumber,
}: {
  source: ProjectHandleRecord;
  safe: Address;
  clientFor: ProjectHandleClientFor;
  mainnetClient: PublicClient;
  mainnetBlockNumber: bigint;
}): Promise<void> {
  const sourceClient = clientFor(source.chainId);
  const sourceBlockNumber =
    source.chainId === PROJECT_HANDLE_CHAIN_ID
      ? mainnetBlockNumber
      : await sourceClient.getBlockNumber();
  await assertCurrentProjectAuthority({
    source,
    sourceClient,
    sourceBlockNumber,
    safe,
  });

  const authority = await readCrossChainHandleAuthority({
    sourceChainId: source.chainId,
    sourceClient,
    mainnetClient,
    authority: safe,
    sourceBlockNumber,
    mainnetBlockNumber,
  });
  if (!authority.allowed) {
    throw new Error(
      `The queued handle's cross-chain authority is no longer valid (${authority.status}).`,
    );
  }
}

/** Recheck one already-classified handle write against current pinned state. */
export async function verifyQueuedProjectHandleBinding({
  binding,
  safe,
  transaction,
  clientFor,
}: {
  binding: QueuedProjectHandleBinding;
  safe: Address;
  transaction: SafeQueuedTransaction;
  clientFor: ProjectHandleClientFor;
}): Promise<void> {
  const mainnetClient = clientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);
  const mainnetBlockNumber = await mainnetClient.getBlockNumber();
  const source = binding.kind === "ens-text" ? binding.record : binding.source;
  await assertLiveProjectHandleAuthority({
    source,
    safe,
    clientFor,
    mainnetClient,
    mainnetBlockNumber,
  });

  if (binding.kind === "ens-text") {
    let resolver: Address;
    try {
      resolver = await mainnetClient.readContract({
        address: ENS_REGISTRY_ADDRESS,
        abi: ensRegistryAbi,
        functionName: "resolver",
        args: [binding.node],
        blockNumber: mainnetBlockNumber,
      });
    } catch {
      throw new Error("The queued ENS resolver could not be rechecked.");
    }
    if (!isAddressEqual(resolver, getAddress(transaction.to))) {
      throw new Error("The queued ENS name now uses a different resolver.");
    }
    try {
      await simulateExactEnsTextTransaction(
        mainnetClient,
        resolver,
        transactionData(transaction),
        safeUint256(transaction.value, "value"),
        safe,
        mainnetBlockNumber,
      );
    } catch {
      throw new Error("This Safe is no longer authorized for the queued ENS record write.");
    }
    return;
  }

  const node = namehash(binding.handle.ensName);
  let resolver: Address;
  try {
    resolver = await mainnetClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
      blockNumber: mainnetBlockNumber,
    });
  } catch {
    throw new Error("The queued handle's ENS resolver could not be rechecked.");
  }
  if (isAddressEqual(resolver, zeroAddress)) {
    throw new Error("The queued handle's ENS name no longer has a resolver.");
  }
  const record = await readExactEnsText(mainnetClient, resolver, node, mainnetBlockNumber);
  if (record !== projectHandleRecord(binding.source.chainId, binding.source.projectId)) {
    throw new Error("The queued handle's exact ENS juicebox record no longer matches its project.");
  }
}

/**
 * Receipt-time semantic check for one mined handle-scoped Safe execution.
 * This is deliberately separate from the preflight simulation: success means
 * the exact reviewed state change is now observable, not merely that the
 * outer execTransaction call was accepted by the wallet.
 */
export async function verifyQueuedProjectHandlePostcondition({
  binding,
  safe,
  transaction,
  clientFor,
  executionBlockNumber,
}: {
  binding: QueuedProjectHandleBinding;
  safe: Address;
  transaction: SafeQueuedTransaction;
  clientFor: ProjectHandleClientFor;
  /** Ethereum block which mined the outer Safe execTransaction. */
  executionBlockNumber: bigint;
}): Promise<void> {
  const mainnetClient = clientFor(PROJECT_HANDLE_CHAIN_ID as JBChainId);

  if (binding.kind === "ens-text") {
    let resolver: Address;
    try {
      resolver = await mainnetClient.readContract({
        address: ENS_REGISTRY_ADDRESS,
        abi: ensRegistryAbi,
        functionName: "resolver",
        args: [binding.node],
        blockNumber: executionBlockNumber,
      });
    } catch {
      throw new Error("The executed ENS record's resolver could not be confirmed.");
    }
    if (!isAddressEqual(resolver, getAddress(transaction.to))) {
      throw new Error("The executed ENS name no longer uses the reviewed resolver.");
    }
    const value = await readExactEnsText(
      mainnetClient,
      resolver,
      binding.node,
      executionBlockNumber,
    );
    if (value !== binding.value) {
      throw new Error("The executed ENS juicebox record does not match the reviewed value.");
    }
    return;
  }

  const latestMainnetBlockNumber = await mainnetClient.getBlockNumber();
  // A lagging load-balanced RPC must never move the authority snapshot behind
  // the block whose handle effect is being proved.
  const authorityMainnetBlockNumber =
    latestMainnetBlockNumber < executionBlockNumber
      ? executionBlockNumber
      : latestMainnetBlockNumber;
  await assertLiveProjectHandleAuthority({
    source: binding.source,
    safe,
    clientFor,
    mainnetClient,
    mainnetBlockNumber: authorityMainnetBlockNumber,
  });

  // Keep the forward record and reverse claim bound at the same pinned
  // Ethereum block so a stale/replaced ENS record cannot validate a claim.
  const node = namehash(binding.handle.ensName);
  let resolver: Address;
  try {
    resolver = await mainnetClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
      blockNumber: executionBlockNumber,
    });
  } catch {
    throw new Error("The executed handle's ENS resolver could not be confirmed.");
  }
  if (isAddressEqual(resolver, zeroAddress)) {
    throw new Error("The executed handle's ENS name no longer has a resolver.");
  }
  const record = await readExactEnsText(mainnetClient, resolver, node, executionBlockNumber);
  if (record !== projectHandleRecord(binding.source.chainId, binding.source.projectId)) {
    throw new Error("The executed handle's exact ENS juicebox record no longer matches.");
  }

  const handle = await readExactProjectHandle(
    mainnetClient,
    binding.source.chainId,
    binding.source.projectId,
    safe,
    executionBlockNumber,
  );
  if (handle !== binding.handle.handle) {
    throw new Error("JBProjectHandles did not publish the exact reviewed handle.");
  }
}

/** Classify and, for handle writes only, revalidate the exact queued bytes. */
export async function verifyQueuedProjectHandleTransaction({
  executionChainId,
  safe,
  transaction,
  clientFor,
}: {
  executionChainId: number;
  safe: Address;
  transaction: SafeQueuedTransaction;
  clientFor: ProjectHandleClientFor;
}): Promise<QueuedProjectHandleBinding | null> {
  const binding = classifyQueuedProjectHandleTransaction(executionChainId, transaction);
  if (!binding) return null;
  await verifyQueuedProjectHandleBinding({ binding, safe, transaction, clientFor });
  return binding;
}
