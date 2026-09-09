"use client";

import {
  getAddress,
  hashTypedData,
  isAddressEqual,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

export type SafeConfirmation = { owner: Address; signature?: Hex | null };

export type SafeQueuedTransaction = {
  to: Address;
  value: string | number;
  data: Hex | null;
  operation: number;
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: Address;
  refundReceiver: Address;
  nonce: number;
  safeTxHash?: Hex;
  contractTransactionHash?: Hex;
  confirmationsRequired?: number;
  confirmations?: SafeConfirmation[];
};

export type SafePolicy = {
  owners: Address[];
  threshold: number;
  nonce: number;
};

const SAFE_EXECUTION_SUCCESS_TOPIC = keccak256(stringToHex("ExecutionSuccess(bytes32,uint256)"));
const SAFE_EXECUTION_FAILURE_TOPIC = keccak256(stringToHex("ExecutionFailure(bytes32,uint256)"));
const ZERO_WORD = "0".repeat(64);

function exactSafeExecutionEvent(
  log: TransactionReceipt["logs"][number],
): { eventName: "ExecutionSuccess" | "ExecutionFailure"; txHash: Hex } | null | "malformed" {
  const selector = log.topics[0]?.toLowerCase();
  const eventName =
    selector === SAFE_EXECUTION_SUCCESS_TOPIC.toLowerCase()
      ? "ExecutionSuccess"
      : selector === SAFE_EXECUTION_FAILURE_TOPIC.toLowerCase()
        ? "ExecutionFailure"
        : null;
  if (!eventName) return null;

  // Safe 1.4 indexes txHash; Safe 1.3 places it in the first data word.
  // Accept exactly those two canonical layouts and require zero payment for
  // the zero-reimbursement project-handle envelope.
  if (log.topics.length === 2) {
    const txHash = log.topics[1];
    if (!txHash || !/^0x[\da-fA-F]{64}$/.test(txHash) || log.data !== `0x${ZERO_WORD}`) {
      return "malformed";
    }
    return { eventName, txHash };
  }
  if (log.topics.length === 1) {
    if (!/^0x[\da-fA-F]{128}$/.test(log.data) || log.data.slice(66) !== ZERO_WORD) {
      return "malformed";
    }
    return { eventName, txHash: log.data.slice(0, 66) as Hex };
  }
  return "malformed";
}

export const SAFE_EXEC_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "ExecutionSuccess",
    anonymous: false,
    inputs: [
      { name: "txHash", type: "bytes32", indexed: true },
      { name: "payment", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ExecutionFailure",
    anonymous: false,
    inputs: [
      { name: "txHash", type: "bytes32", indexed: true },
      { name: "payment", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * A successful outer transaction is not enough for Safe: execTransaction can
 * return false while the outer call remains mined successfully. Require the
 * canonical Safe event for the exact EIP-712 hash which was reviewed.
 */
export function requireSafeExecutionSuccess(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  safe: Address,
  expectedSafeTxHash: Hex,
): void {
  if (receipt.status !== "success") {
    throw new Error("The Safe execution transaction reverted.");
  }

  let matchedSuccess = false;
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, safe)) continue;
    const event = exactSafeExecutionEvent(log);
    if (event === "malformed") {
      throw new Error("Safe emitted a malformed execution result event.");
    }
    if (!event || event.txHash.toLowerCase() !== expectedSafeTxHash.toLowerCase()) continue;
    if (event.eventName === "ExecutionFailure") {
      throw new Error("Safe reported ExecutionFailure for the reviewed transaction.");
    }
    matchedSuccess = true;
  }
  if (!matchedSuccess) {
    throw new Error("The receipt has no Safe ExecutionSuccess for the reviewed transaction.");
  }
}

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const SAFE_SERVICE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};

function serviceBase(chainId: number): string | null {
  const prefix = SAFE_SERVICE_PREFIX[chainId];
  return prefix ? `https://api.safe.global/tx-service/${prefix}` : null;
}

export function safeQueueLink(chainId: number, safe: Address): string | null {
  const prefix = SAFE_SERVICE_PREFIX[chainId];
  return prefix ? `https://app.safe.global/transactions/queue?safe=${prefix}:${safe}` : null;
}

export function safeMessage(tx: SafeQueuedTransaction) {
  return {
    to: tx.to,
    value: BigInt(tx.value ?? 0),
    data: tx.data ?? "0x",
    operation: Number(tx.operation ?? 0),
    safeTxGas: BigInt(tx.safeTxGas ?? 0),
    baseGas: BigInt(tx.baseGas ?? 0),
    gasPrice: BigInt(tx.gasPrice ?? 0),
    gasToken: tx.gasToken ?? zeroAddress,
    refundReceiver: tx.refundReceiver ?? zeroAddress,
    nonce: BigInt(tx.nonce),
  };
}

export function safeTransactionHash(
  chainId: number,
  safe: Address,
  tx: SafeQueuedTransaction,
): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: safeMessage(tx),
  });
}

export async function listPendingSafeTransactions(
  chainId: number,
  safe: Address,
  currentNonce: number,
): Promise<SafeQueuedTransaction[]> {
  const base = serviceBase(chainId);
  if (!base) throw new Error("Safe queue service is unavailable on this chain.");
  let next: string | null =
    `${base}/api/v1/safes/${getAddress(safe)}/multisig-transactions/?executed=false&trusted=true&ordering=nonce&limit=100&nonce__gte=${currentNonce}`;
  const transactions: SafeQueuedTransaction[] = [];
  for (let page = 0; next && page < 10; page += 1) {
    const response = await fetch(next);
    if (!response.ok) throw new Error(`Safe queue service returned ${response.status}.`);
    const body = (await response.json()) as {
      next?: string | null;
      results?: SafeQueuedTransaction[];
    };
    transactions.push(...(body.results ?? []));
    if (!body.next) {
      next = null;
    } else {
      const candidate = new URL(body.next, base).toString();
      if (!candidate.startsWith(`${base}/api/v1/`)) {
        throw new Error("Safe queue service returned an unexpected pagination URL.");
      }
      next = candidate;
    }
  }
  if (next) throw new Error("Safe queue has more than 1,000 pending transactions.");
  return transactions.filter((tx) => Number(tx.nonce) >= currentNonce);
}

export async function submitSafeConfirmation(
  chainId: number,
  tx: SafeQueuedTransaction,
  signature: Hex,
): Promise<void> {
  const base = serviceBase(chainId);
  const hash = tx.safeTxHash ?? tx.contractTransactionHash;
  if (!base || !hash) throw new Error("The queued Safe transaction has no service hash.");
  const response = await fetch(`${base}/api/v1/multisig-transactions/${hash}/confirmations/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature }),
  });
  if (!response.ok && response.status !== 201) {
    throw new Error(`Safe confirmation service returned ${response.status}.`);
  }
}

/**
 * The signature bytes for one confirmation, or null when it contributes nothing.
 *
 * An exact 130-hex filter accepted ONLY 65-byte ECDSA signatures, silently dropping EIP-1271
 * contract-signer confirmations — which are variable length. A Safe owned by a smart account
 * therefore under-counted its own threshold and "Execute" never unlocked, even though the
 * Safe app itself executed the same transaction fine.
 */
function signatureBytes(confirmation: SafeConfirmation): string | null {
  const signature = confirmation.signature?.replace(/^0x/, "");
  if (signature) {
    // Even-length hex of at least 65 bytes. ECDSA is exactly 130 chars; a contract signature
    // is longer and carries its own v=0 marker.
    return /^[0-9a-fA-F]+$/.test(signature) && signature.length % 2 === 0 && signature.length >= 130
      ? signature
      : null;
  }
  if (!confirmation.owner) return null;
  return (
    confirmation.owner.replace(/^0x/, "").toLowerCase().padStart(64, "0") + "0".repeat(64) + "01"
  );
}

export function usableSafeConfirmations(
  tx: SafeQueuedTransaction,
  allowedOwners?: readonly Address[],
): SafeConfirmation[] {
  const allowed = allowedOwners ? new Set(allowedOwners.map((owner) => owner.toLowerCase())) : null;
  const byOwner = new Map<string, SafeConfirmation>();
  for (const confirmation of tx.confirmations ?? []) {
    if (!signatureBytes(confirmation)) continue;
    const key = confirmation.owner.toLowerCase();
    if (allowed && !allowed.has(key)) continue;
    const existing = byOwner.get(key);
    if (!existing || (!existing.signature && confirmation.signature)) {
      byOwner.set(key, confirmation);
    }
  }
  // Safe requires signatures in ASCENDING NUMERIC owner order; `localeCompare` sorts them as
  // strings, which disagrees whenever hex digits and letters interleave (e.g. 0x9… vs 0xa…)
  // and yields GS026 at execution.
  return [...byOwner.values()].sort((a, b) => {
    const left = BigInt(a.owner);
    const right = BigInt(b.owner);
    return left === right ? 0 : left < right ? -1 : 1;
  });
}

export function safeExecutionArgs(tx: SafeQueuedTransaction, allowedOwners?: readonly Address[]) {
  const signatures = `0x${usableSafeConfirmations(tx, allowedOwners)
    .map(signatureBytes)
    .join("")}` as Hex;
  return [
    getAddress(tx.to),
    BigInt(tx.value ?? 0),
    tx.data ?? "0x",
    Number(tx.operation ?? 0),
    BigInt(tx.safeTxGas ?? 0),
    BigInt(tx.baseGas ?? 0),
    BigInt(tx.gasPrice ?? 0),
    tx.gasToken ?? zeroAddress,
    tx.refundReceiver ?? zeroAddress,
    signatures,
  ] as const;
}

// ── Proposing a new transaction ───────────────────────────────────────────────

/** The zero-gas SafeTx shape this app proposes: a plain CALL with no refund parameters. */
export function safeProposalFor(
  call: { to: Address; data: Hex; value?: bigint },
  nonce: number,
): SafeQueuedTransaction {
  return {
    to: getAddress(call.to),
    value: (call.value ?? 0n).toString(),
    data: call.data,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
    confirmations: [],
  };
}

/** Whether a queued transaction is this exact call (target, calldata, value, plain CALL). */
export function queuedTransactionMatchesCall(
  tx: SafeQueuedTransaction,
  call: { to: Address; data: Hex; value?: bigint },
): boolean {
  return (
    isAddressEqual(tx.to, call.to) &&
    (tx.data ?? "0x").toLowerCase() === call.data.toLowerCase() &&
    BigInt(tx.value ?? 0) === (call.value ?? 0n) &&
    Number(tx.operation ?? 0) === 0
  );
}

/**
 * The nonce a new proposal takes: right after everything already queued, and
 * never below the Safe's own nonce. Reusing a queued nonce would silently
 * offer a REPLACEMENT of that transaction, which is never what an operator
 * adding a new call means.
 */
export function nextProposalNonce(
  currentNonce: number,
  pending: readonly SafeQueuedTransaction[],
): number {
  const highest = pending.reduce(
    (value, tx) => Math.max(value, Number(tx.nonce)),
    currentNonce - 1,
  );
  return Math.max(currentNonce, highest + 1);
}

/**
 * Queue a signed proposal with the Safe Transaction Service so the Safe's
 * other signers can confirm and execute it (here, or in the Safe app). The
 * hash is recomputed from the exact payload rather than trusted from anywhere
 * else, and every address is checksummed — the service rejects lowercase.
 */
export async function proposeSafeTransaction(
  chainId: number,
  safe: Address,
  tx: SafeQueuedTransaction,
  sender: Address,
  signature: Hex,
): Promise<Hex> {
  const base = serviceBase(chainId);
  if (!base) throw new Error("Safe queue service is unavailable on this chain.");
  const safeTxHash = safeTransactionHash(chainId, safe, tx);
  const response = await fetch(`${base}/api/v1/safes/${getAddress(safe)}/multisig-transactions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: getAddress(tx.to),
      value: String(tx.value ?? 0),
      data: tx.data ?? "0x",
      operation: Number(tx.operation ?? 0),
      safeTxGas: String(tx.safeTxGas ?? 0),
      baseGas: String(tx.baseGas ?? 0),
      gasPrice: String(tx.gasPrice ?? 0),
      gasToken: tx.gasToken ?? zeroAddress,
      refundReceiver: tx.refundReceiver ?? zeroAddress,
      nonce: String(tx.nonce),
      contractTransactionHash: safeTxHash,
      sender: getAddress(sender),
      signature,
      origin: "revnet.money",
    }),
  });
  if (!response.ok && response.status !== 201) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Safe proposal service returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
    );
  }
  return safeTxHash;
}
