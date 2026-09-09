import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  encodeFunctionData,
  hexToBigInt,
  hexToString,
  size,
  sliceHex,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { normalize } from "viem/ens";
import { slugFor } from "./slug";

/** Ethereum-mainnet JBProjectHandles deployment from deploy-all-v6. */
export const JB_PROJECT_HANDLES_ADDRESS = "0x726f4a3dfd2fb8297f8ab98d215b42a92d8eefe8" as Address;
export const ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as Address;
export const ENS_NAME_WRAPPER_ADDRESS = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401" as Address;
export const PROJECT_HANDLE_CHAIN_ID = 1 as const;
export const PROJECT_HANDLE_TEXT_KEY = "juicebox";
// eth_call's outer transaction budget includes its own call overhead. This
// leaves approximately the contract's 100k resolver stipend available.
const PROJECT_HANDLE_TEXT_READ_GAS = 125_000n;
const PROJECT_HANDLE_MAX_TEXT_BYTES = 256;
const PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS = 500_000n;
const PROJECT_HANDLE_MAX_WRITE_RESULT_BYTES = 32;
const PROJECT_HANDLE_READ_GAS = 300_000n;
const PROJECT_HANDLE_MAX_BYTES = 256;

export const jbProjectHandlesAbi = [
  {
    type: "function",
    name: "ensNamePartsOf",
    stateMutability: "view",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "projectId", type: "uint256" },
      { name: "setter", type: "address" },
    ],
    outputs: [{ name: "", type: "string[]" }],
  },
  {
    type: "function",
    name: "handleOf",
    stateMutability: "view",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "projectId", type: "uint256" },
      { name: "setter", type: "address" },
    ],
    outputs: [{ name: "handle", type: "string" }],
  },
  {
    type: "function",
    name: "setEnsNamePartsFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "projectId", type: "uint256" },
      { name: "parts", type: "string[]" },
    ],
    outputs: [],
  },
] as const;

export const ensTextResolverAbi = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

export const ensRegistryAbi = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const ensNameWrapperAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * Mirror JBProjectHandles' exact resolver call. A raw eth_call cannot follow
 * CCIP-read redirects, and the explicit gas cap prevents a resolver from
 * consuming an unbounded amount of work while resolving a route.
 */
export async function readExactEnsText(
  client: PublicClient,
  resolver: Address,
  node: `0x${string}`,
  blockNumber?: bigint,
): Promise<string | null> {
  const data = encodeFunctionData({
    abi: ensTextResolverAbi,
    functionName: "text",
    args: [node, PROJECT_HANDLE_TEXT_KEY],
  });
  try {
    const result = await client.request({
      method: "eth_call",
      params: [
        {
          from: JB_PROJECT_HANDLES_ADDRESS,
          to: resolver,
          data,
          gas: toHex(PROJECT_HANDLE_TEXT_READ_GAS),
        },
        blockNumber === undefined ? "latest" : toHex(blockNumber),
      ],
    });

    // Decode only the bounded ABI shape accepted by JBProjectHandles. In
    // particular, never hand an arbitrarily large resolver response to the
    // generic ABI decoder.
    return decodeBoundedAbiString(result, PROJECT_HANDLE_MAX_TEXT_BYTES);
  } catch {
    // Includes OffchainLookup: a raw request deliberately never follows the
    // resolver's CCIP gateway and treats the record as unavailable.
    return null;
  }
}

/**
 * Simulate the exact resolver write without Viem's CCIP-read retry. A real
 * setText transaction cannot follow OffchainLookup, so a gateway response is
 * not authorization and must fail before the wallet is opened.
 */
export async function simulateExactEnsTextWrite(
  client: PublicClient,
  resolver: Address,
  node: Hex,
  value: string,
  account: Address,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: ensTextResolverAbi,
    functionName: "setText",
    args: [node, PROJECT_HANDLE_TEXT_KEY, value],
  });
  const result = await client.request({
    method: "eth_call",
    params: [
      {
        from: account,
        to: resolver,
        data,
        gas: toHex(PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS),
      },
      "latest",
    ],
  });
  if (
    typeof result !== "string" ||
    !/^0x[\da-fA-F]*$/.test(result) ||
    result.length % 2 !== 0 ||
    size(result) > PROJECT_HANDLE_MAX_WRITE_RESULT_BYTES
  ) {
    throw new Error("The ENS resolver returned an invalid simulation result.");
  }
  return PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS;
}

/**
 * Simulate an already-encoded resolver transaction exactly as a Safe would
 * originate it. Keeping the calldata opaque is important for queued writes:
 * the bytes which signers review must be the bytes whose live authorization is
 * checked, and a raw eth_call must never follow an OffchainLookup redirect.
 */
export async function simulateExactEnsTextTransaction(
  client: PublicClient,
  resolver: Address,
  data: Hex,
  value: bigint,
  account: Address,
  blockNumber?: bigint,
): Promise<bigint> {
  const result = await client.request({
    method: "eth_call",
    params: [
      {
        from: account,
        to: resolver,
        data,
        value: toHex(value),
        gas: toHex(PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS),
      },
      blockNumber === undefined ? "latest" : toHex(blockNumber),
    ],
  });
  if (
    typeof result !== "string" ||
    !/^0x[\da-fA-F]*$/.test(result) ||
    result.length % 2 !== 0 ||
    size(result) > PROJECT_HANDLE_MAX_WRITE_RESULT_BYTES
  ) {
    throw new Error("The ENS resolver returned an invalid simulation result.");
  }
  return PROJECT_HANDLE_TEXT_WRITE_SIMULATION_GAS;
}

function decodeBoundedAbiString(result: Hex, maxBytes: number): string | null {
  const resultSize = size(result);
  if (resultSize < 64 || resultSize > 64 + maxBytes) return null;
  const offset = hexToBigInt(sliceHex(result, 0, 32));
  const length = hexToBigInt(sliceHex(result, 32, 64));
  if (offset !== 32n || length > BigInt(maxBytes) || BigInt(resultSize) < 64n + length) {
    return null;
  }
  return hexToString(sliceHex(result, 64, 64 + Number(length)));
}

/** Gas- and return-bounded reverse lookup; never ABI-decode attacker-sized parts. */
export async function readExactProjectHandle(
  client: PublicClient,
  chainId: number | bigint,
  projectId: number | bigint,
  setter: Address,
  blockNumber?: bigint,
): Promise<string | null> {
  const data = encodeFunctionData({
    abi: jbProjectHandlesAbi,
    functionName: "handleOf",
    args: [BigInt(chainId), BigInt(projectId), setter],
  });
  try {
    const result = await client.request({
      method: "eth_call",
      params: [
        {
          to: JB_PROJECT_HANDLES_ADDRESS,
          data,
          gas: toHex(PROJECT_HANDLE_READ_GAS),
        },
        blockNumber === undefined ? "latest" : toHex(blockNumber),
      ],
    });
    return decodeBoundedAbiString(result, PROJECT_HANDLE_MAX_BYTES);
  } catch {
    return null;
  }
}

export type ProjectHandle = {
  /** Canonical handle without the leading `@` or trailing `.eth`. */
  handle: string;
  /** Canonical ENS name, including `.eth`. */
  ensName: string;
  /** JBProjectHandles stores labels in reverse order. */
  parts: string[];
};

export type ProjectHandleProgress = {
  ensRecordComplete: boolean;
  reverseClaimComplete: boolean;
  complete: boolean;
  nextAction: "ens" | "publish" | null;
};

/**
 * Derive the resumable two-write flow from live records. The checks are kept
 * independent so forward-record recovery never duplicates an already-published
 * reverse claim, and a returning user resumes at the first incomplete step.
 */
export function projectHandleProgress(
  ensRecordComplete: boolean,
  reverseClaimComplete: boolean,
): ProjectHandleProgress {
  return {
    ensRecordComplete,
    reverseClaimComplete,
    complete: ensRecordComplete && reverseClaimComplete,
    nextAction: !ensRecordComplete ? "ens" : !reverseClaimComplete ? "publish" : null,
  };
}

/** Normalize a user-facing `@handle` into the exact ENS and contract forms. */
export function parseProjectHandleInput(input: string): ProjectHandle {
  let candidate = input.trim();
  if (candidate.startsWith("@")) candidate = candidate.slice(1);
  if (candidate.toLowerCase().endsWith(".eth")) candidate = candidate.slice(0, -4);
  if (!candidate || candidate.includes("@")) throw new Error("Enter an ENS handle.");

  let ensName: string;
  try {
    ensName = normalize(`${candidate}.eth`);
  } catch {
    throw new Error("Enter a valid ENS handle.");
  }

  const labels = ensName.slice(0, -4).split(".");
  if (labels.some((label) => !label || label === "eth")) {
    throw new Error("Enter a valid ENS handle.");
  }

  const handle = labels.join(".");
  return { handle, ensName, parts: [...labels].reverse() };
}

/** Accept a contract handle only when it is already in canonical display form. */
export function canonicalProjectHandle(value: string): ProjectHandle | null {
  try {
    const parsed = parseProjectHandleInput(value);
    return parsed.handle === value ? parsed : null;
  } catch {
    return null;
  }
}

/** Reconstruct and validate the canonical user-facing handle for stored parts. */
export function canonicalProjectHandleParts(parts: readonly string[]): ProjectHandle | null {
  if (parts.length === 0) return null;
  const candidate = [...parts].reverse().join(".");
  const parsed = canonicalProjectHandle(candidate);
  return parsed && sameProjectHandleParts(parsed.parts, parts) ? parsed : null;
}

export type ProjectHandleRecord = {
  chainId: JBChainId;
  projectId: bigint;
  slug: string;
};

/** Parse the exact `chainId:projectId` payload verified by JBProjectHandles. */
export function parseProjectHandleRecord(value: string | null): ProjectHandleRecord | null {
  const match = value?.match(/^([1-9]\d*):([1-9]\d*)$/);
  if (!match) return null;

  const numericChainId = Number(match[1]);
  if (!Number.isSafeInteger(numericChainId)) return null;

  let projectId: bigint;
  try {
    projectId = BigInt(match[2]);
  } catch {
    return null;
  }

  const slug = slugFor(numericChainId, projectId);
  if (!slug) return null;
  return { chainId: numericChainId as JBChainId, projectId, slug };
}

export function projectHandleRecord(chainId: number, projectId: number | bigint): string {
  return `${chainId}:${projectId}`;
}

export function sameProjectHandleParts(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
