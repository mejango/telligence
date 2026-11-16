import "@/lib/safe-service-config";
import {
  buildSafeInitializer,
  predictSafeAddress,
  SAFE_FACTORY,
  SAFE_FALLBACK,
  SAFE_PROXY_CREATION_CODE,
  SAFE_SINGLETON,
  type SafeCreation,
} from "@bananapus/nana-sdk-core/safe";
import {
  SAFE_EXEC_ABI,
  safeTransactionHash,
  type SafeConfirmation,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  padHex,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { vi } from "vitest";

export const SAFE_OWNER_A = "0x2222222222222222222222222222222222222222" as Address;
const SAFE_OWNER_B = "0x3333333333333333333333333333333333333333" as Address;

/** The runtime the canonical Safe 1.4.1 factory deploys (the tail of SAFE_PROXY_CREATION_CODE). */
const SAFE_141_PROXY_RUNTIME =
  "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033" as Hex;

const SINGLETON_CODE = "0x60006000" as Hex;
const FALLBACK_CODE = "0x60016000" as Hex;
const CONTRACT_CODE = "0x60026000" as Hex;
const SENTINEL = "0x0000000000000000000000000000000000000001" as Address;
const SINGLETON_SLOT = toHex(0, { size: 32 });
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const FALLBACK_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";

const SAFE_READS = parseAbi([
  "function masterCopy() view returns (address)",
  "function VERSION() view returns (string)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[],address)",
  "function nonce() view returns (uint256)",
  "function approvedHashes(address owner,bytes32 hash) view returns (uint256)",
]);

export type SafeFixture = {
  address: Address;
  owners: Address[];
  threshold: number;
  creation: SafeCreation;
  /** The creation record as Safe's transaction service serves it. */
  servicePayload: {
    factoryAddress: Address;
    masterCopy: Address;
    setupData: Hex;
    saltNonce: string;
  };
};

/** A plain Safe 1.4.1 the canonical factory made with no setup hook, so its creation proves its address. */
export function provenSafe({
  owners = [SAFE_OWNER_A, SAFE_OWNER_B],
  threshold = 2,
  saltNonce = 7n,
}: { owners?: Address[]; threshold?: number; saltNonce?: bigint } = {}): SafeFixture {
  const initializer = buildSafeInitializer({ owners, threshold });
  const address = predictSafeAddress({
    owners,
    threshold,
    saltNonce: toHex(saltNonce, { size: 32 }),
    proxyCreationCode: SAFE_PROXY_CREATION_CODE,
  });
  return {
    address,
    owners,
    threshold,
    creation: { factory: SAFE_FACTORY, singleton: SAFE_SINGLETON, initializer, saltNonce },
    servicePayload: {
      factoryAddress: SAFE_FACTORY,
      masterCopy: SAFE_SINGLETON,
      setupData: initializer,
      saltNonce: saltNonce.toString(),
    },
  };
}

type RequestArgs = { method: string; params: readonly unknown[] };

export type SafeChainOptions = {
  owners?: readonly Address[];
  threshold?: number;
  modules?: readonly Address[];
  guard?: Address;
  nonce?: bigint;
  /** Owners whose `approvedHashes` entry is set for every hash. */
  approvedBy?: readonly Address[];
  /** Other addresses holding contract code on this chain. */
  contracts?: readonly Address[];
  /** Answers every request that is not a read of the Safe. */
  otherRequest?: (args: RequestArgs) => Promise<unknown>;
};

/**
 * The reads one node answers when it holds `safe` as a plain Safe 1.4.1: proxy runtime, storage
 * slots and the bounded eth_calls the SDK makes. Pass null for a chain where the address is an
 * EOA. Every other address is an EOA unless `contracts` lists it.
 */
export function safeChain(safe: Address | null, options: SafeChainOptions = {}) {
  const {
    owners = [SAFE_OWNER_A, SAFE_OWNER_B],
    threshold = 2,
    modules = [],
    guard = zeroAddress,
    nonce = 0n,
    approvedBy = [],
    contracts = [],
    otherRequest,
  } = options;
  const is = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  const getCode = vi.fn(async ({ address }: { address: Address }) => {
    if (safe && is(address, safe)) return SAFE_141_PROXY_RUNTIME;
    if (safe && is(address, SAFE_SINGLETON)) return SINGLETON_CODE;
    if (safe && is(address, SAFE_FALLBACK)) return FALLBACK_CODE;
    if (contracts.some((contract) => is(contract, address))) return CONTRACT_CODE;
    return undefined;
  });
  const getStorageAt = vi.fn(async ({ slot }: { address: Address; slot: Hex }) => {
    if (slot === SINGLETON_SLOT) return padHex(SAFE_SINGLETON, { size: 32 });
    if (slot === GUARD_SLOT) return padHex(guard, { size: 32 });
    if (slot === FALLBACK_SLOT) return padHex(SAFE_FALLBACK, { size: 32 });
    throw new Error(`Unexpected storage slot ${slot}`);
  });
  const request = vi.fn(async (args: RequestArgs) => {
    const call = args.params[0] as { to?: Address; data?: Hex } | undefined;
    if (args.method !== "eth_call" || !safe || !call?.to || !is(call.to, safe)) {
      if (otherRequest) return otherRequest(args);
      throw new Error(`Unexpected request ${args.method} to ${call?.to}`);
    }
    const { functionName, args: callArgs } = decodeFunctionData({
      abi: SAFE_READS,
      data: call.data!,
    });
    switch (functionName) {
      case "masterCopy":
        return encodeFunctionResult({ abi: SAFE_READS, functionName, result: SAFE_SINGLETON });
      case "VERSION":
        return encodeFunctionResult({ abi: SAFE_READS, functionName, result: "1.4.1" });
      case "getThreshold":
        return encodeFunctionResult({ abi: SAFE_READS, functionName, result: BigInt(threshold) });
      case "getOwners":
        return encodeFunctionResult({ abi: SAFE_READS, functionName, result: [...owners] });
      case "getModulesPaginated":
        return encodeFunctionResult({
          abi: SAFE_READS,
          functionName,
          result: [[...modules], SENTINEL],
        });
      case "nonce":
        return encodeFunctionResult({ abi: SAFE_READS, functionName, result: nonce });
      case "approvedHashes":
        return encodeFunctionResult({
          abi: SAFE_READS,
          functionName,
          result: approvedBy.some((owner) => is(owner, callArgs![0] as Address)) ? 1n : 0n,
        });
    }
  });
  return {
    getCode,
    getStorageAt,
    request,
    client: { getCode, getStorageAt, request } as unknown as PublicClient,
  };
}

/** A fetch stub for Safe's transaction service that serves `safe`'s creation record on `prefix`. */
export function creationService(safe: SafeFixture, prefix: string) {
  const url = `https://juicebox.center/v1/safe/${prefix}/api/v1/safes/${safe.address}/creation/`;
  return vi.fn(async (input: RequestInfo | URL) =>
    String(input) === url
      ? new Response(JSON.stringify(safe.servicePayload), { status: 200 })
      : new Response("Not found", { status: 404 }),
  );
}

/** A row as Safe's transaction service lists it: `tx` for `safe`, with its own hash. */
export function queuedRow(
  chainId: number,
  safe: Address,
  tx: SafeQueuedTransaction,
  confirmations: SafeConfirmation[] = [],
): SafeQueuedTransaction {
  const row = { ...tx, safe, confirmations };
  return { ...row, safeTxHash: safeTransactionHash(chainId, safe, row) };
}

/**
 * Safe's transaction service on `prefix` for `safe`: it lists `pending`, accepts proposals and
 * confirmations (recorded in `posts`), and answers anything else with a 404.
 */
export function safeTransactionService(
  prefix: string,
  safe: Address,
  pending: readonly SafeQueuedTransaction[] = [],
) {
  const base = `https://juicebox.center/v1/safe/${prefix}/api/v1`;
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 201 });
    }
    if (url.startsWith(`${base}/safes/${safe}/multisig-transactions/?`)) {
      return new Response(JSON.stringify({ next: null, results: pending }));
    }
    return new Response("Not found", { status: 404 });
  });
  return { fetch, posts };
}

/** A Safe 1.4 ExecutionSuccess or ExecutionFailure log of `safe` for `safeTxHash`. */
export function executionLog(
  safe: Address,
  safeTxHash: Hex,
  eventName: "ExecutionSuccess" | "ExecutionFailure" = "ExecutionSuccess",
  payment = 0n,
) {
  return {
    address: safe,
    topics: encodeEventTopics({ abi: SAFE_EXEC_ABI, eventName, args: { txHash: safeTxHash } }),
    data: encodeAbiParameters([{ type: "uint256" }], [payment]),
  };
}
