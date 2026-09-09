import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import type {
  CallPrecondition,
  ExpectedPayerDeployment,
  RejectedReceiptEvent,
  ReservedReceiptGuard,
} from "./multichain-guards";
import type { ExpectedPayoutReceipt } from "./payout-receipts";

export type MultichainCall = {
  chainId: number;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  contractName?: string;
  recoveryScope?: string;
  relayrMode?: "raw" | "forwarded";
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ReservedReceiptGuard;
  expectedPayout?: ExpectedPayoutReceipt;
  validate?: () => Promise<void>;
};
export type FrozenBatchCall = Omit<MultichainCall, "validate"> & {
  data: Hex;
  state: "ready" | "submitting" | "submitted" | "safe" | "success";
  hash?: Hash;
};
export type BatchRound = {
  indices: number[];
  bundleUuid?: string;
  state: "ready" | "quoted" | "funding" | "pending" | "success";
};
export type MultichainBatch = {
  id: string;
  scope: string;
  label: string;
  account: Address;
  key: string;
  route: "relayr" | "direct";
  calls: FrozenBatchCall[];
  rounds: BatchRound[];
  status: "pending" | "success";
  createdAt: number;
};
const STORAGE_KEY = "revnet:multichain-batches:v1";

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $batchBigInt: item.toString() } : item,
  );
}
export function readMultichainBatches(): MultichainBatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw, (_key, item: unknown) =>
      item && typeof item === "object" && Object.keys(item).length === 1 && "$batchBigInt" in item
        ? BigInt(String(item.$batchBigInt))
        : item,
    );
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (batch) =>
          !batch ||
          typeof batch.scope !== "string" ||
          typeof batch.account !== "string" ||
          !Array.isArray(batch.calls) ||
          !Array.isArray(batch.rounds),
      )
    )
      throw new Error("Invalid batch journal");
    return parsed;
  } catch {
    throw new Error(
      "Saved multichain recovery data is unavailable. Restore it before creating another batch.",
    );
  }
}
export function saveMultichainBatch(batch: MultichainBatch) {
  if (typeof window === "undefined") throw new Error("Browser recovery storage is required.");
  const previous = readMultichainBatches();
  const next = [batch, ...previous.filter((item) => item.id !== batch.id)];
  const encoded = serialize(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, encoded);
    if (window.localStorage.getItem(STORAGE_KEY) !== encoded)
      throw new Error("Storage write missing");
  } catch {
    throw new Error(
      "The batch could not be saved for recovery. Nothing further will be submitted.",
    );
  }
}
/** Only callers that prove no signature/publication/submission occurred may remove a draft. */
export function removeUnsubmittedBatch(id: string) {
  if (typeof window === "undefined") throw new Error("Browser recovery storage is required.");
  window.localStorage.setItem(
    STORAGE_KEY,
    serialize(readMultichainBatches().filter((batch) => batch.id !== id)),
  );
}
function batchCallData(call: MultichainCall) {
  return encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args });
}
export function batchCallKey(calls: readonly MultichainCall[]) {
  return keccak256(
    stringToHex(
      calls
        .map(
          (call) =>
            `${call.chainId}:${call.address.toLowerCase()}:${call.value ?? 0n}:${batchCallData(call).toLowerCase()}`,
        )
        .join("|"),
    ),
  );
}

/** Preserve every selected allocation while using one independent call per chain in each explicit round. */
export function makeBatchRounds(calls: readonly MultichainCall[]): BatchRound[] {
  const rounds: BatchRound[] = [];
  const occurrences = new Map<number, number>();
  calls.forEach((call, index) => {
    const round = occurrences.get(call.chainId) ?? 0;
    occurrences.set(call.chainId, round + 1);
    rounds[round] ??= { indices: [], state: "ready" };
    rounds[round].indices.push(index);
  });
  return rounds;
}
export function findPendingBatch(account: Address, scope: string) {
  return readMultichainBatches().find(
    (batch) =>
      batch.account.toLowerCase() === account.toLowerCase() &&
      batch.scope === scope &&
      batch.status === "pending",
  );
}
export function createMultichainBatch(
  account: Address,
  scope: string,
  label: string,
  calls: MultichainCall[],
  route: MultichainBatch["route"],
): MultichainBatch {
  if (!scope || !calls.length) throw new Error("Choose at least one destination.");
  const scopes = new Set(calls.map((call) => call.recoveryScope).filter(Boolean));
  const overlap = readMultichainBatches().find(
    (batch) =>
      batch.status === "pending" &&
      batch.account.toLowerCase() === account.toLowerCase() &&
      (batch.scope === scope ||
        batch.calls.some((call) => call.recoveryScope && scopes.has(call.recoveryScope))),
  );
  if (overlap)
    throw new Error(
      `Resume the saved ${overlap.label} batch before changing this operation or its destination selection.`,
    );
  const key = batchCallKey(calls);
  return {
    id: `multichain:${account.toLowerCase()}:${keccak256(stringToHex(scope))}:${Date.now()}`,
    scope,
    label,
    account,
    key,
    route,
    calls: calls.map(({ validate: _validate, ...call }) => ({
      ...call,
      data: batchCallData(call),
      state: "ready",
    })),
    rounds: makeBatchRounds(calls),
    status: "pending",
    createdAt: Date.now(),
  };
}
