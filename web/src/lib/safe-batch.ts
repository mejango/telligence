"use client";

import { chainDisplayName } from "@/app/constants";
import { rolloutAddress, rolloutChain } from "@/lib/protocol-rollout";
import {
  jbBuybackHookAbi,
  jbBuybackHookRegistryAbi,
  jbControllerAbi,
  jbRouterTerminalRegistryAbi,
  jbV6ContractAddress,
  NATIVE_TOKEN,
  revOwnerAbi,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import { multiSendCallsOf } from "@bananapus/nana-sdk-core/safe";
import { useMemo, useSyncExternalStore } from "react";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";

// ── Step kinds (data, not code paths) ────────────────────────────────────────

export type BatchStepKind =
  | "setHookFor"
  | "setPoolFor"
  | "setTerminalFor"
  | "setTwapWindowOf"
  | "initializePoolFor"
  | "setOperatorOf"
  | "setReservedSplitHook";

/** The chain-agnostic inputs a step was built from: addresses as strings, numbers as bigint. */
export type BatchStepValues = Record<string, Address | bigint>;

export type BatchStep = {
  id: string;
  kind: BatchStepKind;
  chainId: number;
  projectId: number;
  to: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  data: Hex;
  value: 0n;
  label: string;
  contractName: string;
  values: BatchStepValues;
};

type ContractName = keyof typeof jbV6ContractAddress;

type StepKindDefinition = {
  kind: BatchStepKind;
  label: string;
  /** Per-chain address lookup; `setTwapWindowOf` targets the project's resolved hook instead. */
  contract: ContractName;
  abi: Abi;
  functionName: string;
  /** Value names in argument order; every function takes the project id first. */
  inputs: readonly string[];
  /** The arguments, where they are not the project id followed by the inputs. */
  args?: (projectId: bigint, values: BatchStepValues) => readonly unknown[];
  /** Values (or the target) differ per chain, so mirroring re-resolves them there. */
  perChain?: boolean;
  describe: (values: BatchStepValues, chainId: number) => string;
};

function tokenLabel(token: unknown, chainId: number): string {
  if (typeof token !== "string" || !isAddress(token)) return String(token);
  if (isAddressEqual(token, NATIVE_TOKEN) || isAddressEqual(token, zeroAddress)) return "Native";
  const usdc = USDC_ADDRESSES[chainId as keyof typeof USDC_ADDRESSES];
  if (usdc && isAddressEqual(token, usdc)) return "USDC";
  return shortAddress(token);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const STEP_KINDS: Record<BatchStepKind, StepKindDefinition> = {
  setHookFor: {
    kind: "setHookFor",
    label: "Set buyback hook",
    contract: "JBBuybackHookRegistry",
    abi: jbBuybackHookRegistryAbi,
    functionName: "setHookFor",
    inputs: ["hook"],
    perChain: true,
    describe: (values) => `Hook ${shortAddress(String(values.hook))}`,
  },
  setPoolFor: {
    kind: "setPoolFor",
    label: "Set buyback pool",
    contract: "JBBuybackHookRegistry",
    abi: jbBuybackHookRegistryAbi,
    functionName: "setPoolFor",
    inputs: ["fee", "tickSpacing", "twapWindow", "terminalToken"],
    perChain: true,
    describe: (values, chainId) =>
      `${tokenLabel(values.terminalToken, chainId)} pool, fee ${values.fee}, tick spacing ${values.tickSpacing}, TWAP ${values.twapWindow}s`,
  },
  setTerminalFor: {
    kind: "setTerminalFor",
    label: "Set router terminal",
    contract: "JBRouterTerminalRegistry",
    abi: jbRouterTerminalRegistryAbi,
    functionName: "setTerminalFor",
    inputs: ["terminal"],
    perChain: true,
    describe: (values) => `Terminal ${shortAddress(String(values.terminal))}`,
  },
  setTwapWindowOf: {
    kind: "setTwapWindowOf",
    label: "Set TWAP window",
    contract: "JBBuybackHook",
    abi: jbBuybackHookAbi,
    functionName: "setTwapWindowOf",
    inputs: ["terminalToken", "twapWindow"],
    perChain: true,
    describe: (values, chainId) =>
      `${tokenLabel(values.terminalToken, chainId)} pool, TWAP ${values.twapWindow}s`,
  },
  initializePoolFor: {
    kind: "initializePoolFor",
    label: "Initialize buyback pool",
    contract: "JBBuybackHookRegistry",
    abi: jbBuybackHookRegistryAbi,
    functionName: "initializePoolFor",
    inputs: ["fee", "tickSpacing", "twapWindow", "terminalToken", "sqrtPriceX96"],
    perChain: true,
    describe: (values, chainId) =>
      `${tokenLabel(values.terminalToken, chainId)} pool, fee ${values.fee}, tick spacing ${values.tickSpacing}, TWAP ${values.twapWindow}s, price ${values.sqrtPriceX96}`,
  },
  setOperatorOf: {
    kind: "setOperatorOf",
    label: "Transfer revnet operator",
    contract: "REVOwner",
    abi: revOwnerAbi,
    functionName: "setOperatorOf",
    inputs: ["operator"],
    describe: (values) =>
      typeof values.operator === "string" && isAddressEqual(values.operator, zeroAddress)
        ? "Relinquished (no operator)"
        : `Operator ${shortAddress(String(values.operator))}`,
  },
  // The stage's whole reserved split goes to one hook: the only shape this step writes.
  setReservedSplitHook: {
    kind: "setReservedSplitHook",
    label: "Set reserved split hook",
    contract: "JBController",
    abi: jbControllerAbi,
    functionName: "setSplitGroupsOf",
    inputs: ["rulesetId", "hook"],
    perChain: true,
    args: (projectId, values) => [
      projectId,
      values.rulesetId,
      [
        {
          groupId: RESERVED_TOKEN_SPLIT_GROUP_ID,
          splits: [
            {
              percent: 1_000_000_000,
              projectId: 0n,
              beneficiary: zeroAddress,
              preferAddToBalance: false,
              lockedUntil: 0,
              hook: values.hook,
            },
          ],
        },
      ],
    ],
    describe: (values) => `100% to hook ${shortAddress(String(values.hook))}`,
  },
};

/** `JBSplitGroupIds.RESERVED_TOKENS`. */
export const RESERVED_TOKEN_SPLIT_GROUP_ID = 1n;

// A kind with its own argument shape is built only by its preset, never from a card's write.
const KIND_BY_FUNCTION = new Map(
  Object.values(STEP_KINDS)
    .filter((definition) => !definition.args)
    .map((definition) => [definition.functionName, definition.kind]),
);

const DEPENDENCIES: readonly {
  kind: BatchStepKind;
  after: BatchStepKind;
  message: string;
}[] = [
  {
    kind: "setPoolFor",
    after: "setHookFor",
    message:
      "Set the buyback hook before registering its pool. setPoolFor registers on the project's current hook.",
  },
  {
    kind: "initializePoolFor",
    after: "setHookFor",
    message:
      "Set the buyback hook before opening its pool. initializePoolFor registers on the project's current hook.",
  },
];

/** A v6 contract's address on a chain, or undefined where it isn't deployed. */
export function contractAddressOn(contract: ContractName, chainId: number): Address | undefined {
  const rollout = rolloutChain(chainId);
  if (rollout && contract in rollout.contracts) {
    return rolloutAddress(contract as keyof typeof rollout.contracts, chainId) ?? undefined;
  }
  const deployments = jbV6ContractAddress[contract] as Partial<Record<number, Address>>;
  const address = deployments?.[chainId];
  return address ? getAddress(address) : undefined;
}

/**
 * A step's identity in its chain's batch. A pool registration is one per terminal token whatever
 * its operation: Native and USDC registrations don't replace each other, and a later `setPoolFor`
 * replaces a queued `initializePoolFor` for the same token.
 */
export function stepKey(step: Pick<BatchStep, "kind" | "to" | "values">): string {
  if (step.kind === "setPoolFor" || step.kind === "initializePoolFor") {
    return `setPoolFor:${step.to.toLowerCase()}:${String(step.values.terminalToken).toLowerCase()}`;
  }
  return `${step.kind}:${step.to.toLowerCase()}`;
}

/**
 * Build one step from its chain-agnostic values. `to` defaults to the kind's
 * contract on that chain; kinds that target a per-project contract (the
 * resolved buyback hook) pass it explicitly.
 */
export function buildStep({
  kind,
  chainId,
  projectId,
  values,
  to,
}: {
  kind: BatchStepKind;
  chainId: number;
  projectId: number;
  values: BatchStepValues;
  to?: Address;
}): BatchStep {
  const definition = STEP_KINDS[kind];
  const target = to ?? contractAddressOn(definition.contract, chainId);
  if (!target) {
    throw new Error(`${definition.contract} is not deployed on ${chainDisplayName(chainId)}.`);
  }
  if (definition.inputs.some((name) => values[name] === undefined)) {
    throw new Error(`${definition.label}: missing a value.`);
  }
  const args = definition.args?.(BigInt(projectId), values) ?? [
    BigInt(projectId),
    ...definition.inputs.map((name) => values[name]),
  ];
  const step = {
    kind,
    chainId,
    projectId,
    to: getAddress(target),
    abi: definition.abi,
    functionName: definition.functionName,
    args,
    data: encodeFunctionData({ abi: definition.abi, functionName: definition.functionName, args }),
    value: 0n as const,
    label: definition.label,
    contractName: definition.contract,
    values: { ...values },
  };
  return { id: stepKey(step), ...step };
}

/** The step an operator card's write becomes when it is added to the batch instead of sent. */
export function stepFromWrite(write: {
  chainId: number;
  address: Address;
  functionName: string;
  args: readonly unknown[];
}): BatchStep {
  const kind = KIND_BY_FUNCTION.get(write.functionName);
  if (!kind) throw new Error(`${write.functionName} cannot be batched.`);
  const [projectId, ...rest] = write.args;
  const values = Object.fromEntries(
    STEP_KINDS[kind].inputs.map((name, index) => [name, normalizeValue(rest[index])]),
  );
  return buildStep({
    kind,
    chainId: write.chainId,
    projectId: Number(projectId),
    values,
    to: write.address,
  });
}

function normalizeValue(value: unknown): Address | bigint {
  if (typeof value === "string" && isAddress(value)) return getAddress(value);
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  throw new Error(`Unsupported batch value ${String(value)}.`);
}

export function describeStep(step: BatchStep): string {
  return STEP_KINDS[step.kind].describe(step.values, step.chainId);
}

// ── Pure batch operations ────────────────────────────────────────────────────

export type BatchProblem = { index: number; message: string };

export type BatchCall = {
  to: Address;
  data: Hex;
  value: bigint;
  /** Needs an earlier call's effect, so it cannot simulate alone. */
  dependsOnPrior: boolean;
};

/** Dependency rules apply only when BOTH kinds are present; nothing is ever reordered here. */
export function checkBatchOrder(steps: readonly BatchStep[]): {
  ok: boolean;
  problems: BatchProblem[];
} {
  const problems: BatchProblem[] = [];
  for (const rule of DEPENDENCIES) {
    if (!steps.some((step) => step.kind === rule.after)) continue;
    steps.forEach((step, index) => {
      if (step.kind !== rule.kind) return;
      const satisfied = steps.slice(0, index).some((earlier) => earlier.kind === rule.after);
      if (!satisfied) problems.push({ index, message: rule.message });
    });
  }
  return { ok: problems.length === 0, problems };
}

export function composeBatch(steps: readonly BatchStep[]): {
  calls: BatchCall[];
  problems: BatchProblem[];
} {
  const calls = steps.map((step, index) => ({
    to: step.to,
    data: step.data,
    value: 0n,
    dependsOnPrior: DEPENDENCIES.some(
      (rule) =>
        rule.kind === step.kind &&
        steps.slice(0, index).some((earlier) => earlier.kind === rule.after),
    ),
  }));
  return { calls, problems: checkBatchOrder(steps).problems };
}

/** Adding a step whose key already exists replaces it in place; never a duplicate. */
export function upsertStep(steps: readonly BatchStep[], step: BatchStep): BatchStep[] {
  const key = stepKey(step);
  const index = steps.findIndex((existing) => stepKey(existing) === key);
  if (index < 0) return [...steps, step];
  return steps.map((existing, position) => (position === index ? step : existing));
}

export function moveStep(steps: readonly BatchStep[], from: number, to: number): BatchStep[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) {
    return [...steps];
  }
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function removeStep(steps: readonly BatchStep[], index: number): BatchStep[] {
  return steps.filter((_, position) => position !== index);
}

export type StepResolver = (
  step: BatchStep,
  chainId: number,
  projectId: number,
) => Promise<{ to?: Address; values: BatchStepValues } | null>;

/**
 * Rebuild one chain's steps for another chain: same values, the kind's
 * contract re-resolved there. Per-chain kinds go through `resolve` (live reads
 * on the target chain) and are dropped, with the reason, when that returns null.
 */
export async function mirrorBatch(
  steps: readonly BatchStep[],
  fromChainId: number,
  target: { chainId: number; projectId: number },
  resolve: StepResolver,
): Promise<{ steps: BatchStep[]; skipped: { label: string; reason: string }[] }> {
  const mirrored: BatchStep[] = [];
  const skipped: { label: string; reason: string }[] = [];
  const chain = chainDisplayName(target.chainId);
  const sourceSteps = steps.filter((step) => step.chainId === fromChainId);
  const order = checkBatchOrder(sourceSteps);
  if (!order.ok) {
    return {
      steps: [],
      skipped: order.problems.map(({ index, message }) => ({
        label: sourceSteps[index]!.label,
        reason: message,
      })),
    };
  }
  let hookSelectionSkipped = false;
  for (const step of sourceSteps) {
    const definition = STEP_KINDS[step.kind];
    if (
      ["setPoolFor", "initializePoolFor", "setTwapWindowOf"].includes(step.kind) &&
      hookSelectionSkipped
    ) {
      skipped.push({
        label: step.label,
        reason: `The preceding buyback hook selection could not be resolved on ${chain}.`,
      });
      continue;
    }
    try {
      if (definition.perChain) {
        const resolved = await resolve(step, target.chainId, target.projectId);
        if (!resolved) {
          if (step.kind === "setHookFor") hookSelectionSkipped = true;
          skipped.push({
            label: step.label,
            reason: `${step.label}: its values are chain-specific and could not be resolved on ${chain}.`,
          });
          continue;
        }
        mirrored.push(
          buildStep({
            kind: step.kind,
            chainId: target.chainId,
            projectId: target.projectId,
            values: resolved.values,
            to: resolved.to,
          }),
        );
        continue;
      }
      mirrored.push(
        buildStep({
          kind: step.kind,
          chainId: target.chainId,
          projectId: target.projectId,
          values: step.values,
        }),
      );
    } catch (cause) {
      if (step.kind === "setHookFor") hookSelectionSkipped = true;
      skipped.push({ label: step.label, reason: (cause as Error).message });
    }
  }
  return { steps: mirrored, skipped };
}

// ── Queued batches ───────────────────────────────────────────────────────────

/** "Batch (N calls)" for a queued MultiSendCallOnly delegatecall, else null. */
export function describeQueuedBatch(tx: Parameters<typeof multiSendCallsOf>[0]): string | null {
  const calls = multiSendCallsOf(tx);
  return calls ? `Batch (${calls.length} call${calls.length === 1 ? "" : "s"})` : null;
}

// ── Tray storage ─────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "revnet:safe-batch:v1";

export function batchStorageKey(chainId: number, projectId: number): string {
  return `${STORAGE_PREFIX}:${chainId}:${projectId}`;
}

type PersistedStep = {
  kind: BatchStepKind;
  chainId: number;
  projectId: number;
  to: Address;
  values: BatchStepValues;
  data: Hex;
};

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $batchBigInt: item.toString() } : item,
  );
}

function deserialize(raw: string): unknown {
  return JSON.parse(raw, (_key, item: unknown) =>
    item && typeof item === "object" && Object.keys(item).length === 1 && "$batchBigInt" in item
      ? BigInt(String(item.$batchBigInt))
      : item,
  );
}

function isPersistedStep(value: unknown): value is PersistedStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.kind === "string" &&
    step.kind in STEP_KINDS &&
    typeof step.chainId === "number" &&
    typeof step.projectId === "number" &&
    typeof step.to === "string" &&
    isAddress(step.to) &&
    typeof step.data === "string" &&
    !!step.values &&
    typeof step.values === "object" &&
    Object.values(step.values as Record<string, unknown>).every(
      (item) => typeof item === "bigint" || (typeof item === "string" && isAddress(item)),
    )
  );
}

/** The chain's queued steps; anything unreadable or inconsistent is discarded, never repaired. */
export function readBatch(chainId: number, projectId: number): BatchStep[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(batchStorageKey(chainId, projectId));
    if (!raw) return [];
    const parsed = deserialize(raw);
    if (!Array.isArray(parsed) || !parsed.every(isPersistedStep)) return [];
    const steps = parsed.map((persisted) =>
      buildStep({
        kind: persisted.kind,
        chainId: persisted.chainId,
        projectId: persisted.projectId,
        values: persisted.values,
        to: persisted.to,
      }),
    );
    // Rebuilt calldata must match what was saved; drift means the ABI or the
    // stored values changed under the batch, and the whole tray starts over.
    const consistent = steps.every(
      (step, index) =>
        step.chainId === chainId &&
        step.projectId === projectId &&
        step.data.toLowerCase() === parsed[index].data.toLowerCase(),
    );
    return consistent ? steps : [];
  } catch {
    return [];
  }
}

export function writeBatch(chainId: number, projectId: number, steps: readonly BatchStep[]): void {
  if (typeof window === "undefined") return;
  const key = batchStorageKey(chainId, projectId);
  try {
    if (!steps.length) {
      window.localStorage.removeItem(key);
    } else {
      const persisted: PersistedStep[] = steps.map((step) => ({
        kind: step.kind,
        chainId: step.chainId,
        projectId: step.projectId,
        to: step.to,
        values: step.values,
        data: step.data,
      }));
      window.localStorage.setItem(key, serialize(persisted));
    }
  } catch {
    // The tray is a convenience; a full or blocked store only loses the queue.
  }
  bump();
}

export function clearBatch(chainId: number, projectId: number): void {
  writeBatch(chainId, projectId, []);
}

/** Upsert steps into their chains' trays. Returns the chain ids touched. */
/** A queued step's identity in one chain's batch. */
export type BatchStepRef = Pick<BatchStep, "chainId" | "projectId" | "id">;

/** Upserts `steps` and removes queued `dropped` steps, which a fresh resolution no longer allows. */
export function addStepsToBatch(
  steps: readonly BatchStep[],
  dropped: readonly BatchStepRef[] = [],
): number[] {
  const byChain = new Map<string, BatchStep[]>();
  for (const step of [...steps, ...dropped]) byChain.set(`${step.chainId}:${step.projectId}`, []);
  for (const step of steps) byChain.get(`${step.chainId}:${step.projectId}`)!.push(step);
  for (const [key, added] of byChain) {
    const [chainId, projectId] = key.split(":").map(Number) as [number, number];
    const gone = new Set(
      dropped.filter((ref) => `${ref.chainId}:${ref.projectId}` === key).map((ref) => ref.id),
    );
    let next = readBatch(chainId, projectId).filter((step) => !gone.has(step.id));
    for (const step of added) next = upsertStep(next, step);
    writeBatch(chainId, projectId, next);
  }
  return [...new Set(steps.map((step) => step.chainId))];
}

let version = 0;
const listeners = new Set<() => void>();
let storageListening = false;

function bump(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListening && typeof window !== "undefined") {
    storageListening = true;
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) bump();
    });
  }
  return () => listeners.delete(listener);
}

const snapshot = () => version;
// The hydration render must match the server, which has no storage: it sees
// -1 and renders an empty tray, then the first client snapshot reads the queue.
const serverSnapshot = () => -1;

export function useSafeBatch(chainId: number, projectId: number): BatchStep[] {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(
    () => (current < 0 ? [] : readBatch(chainId, projectId)),
    [chainId, projectId, current],
  );
}

export function useSafeBatches(
  rows: readonly { chainId: number; projectId: number }[],
): Map<number, BatchStep[]> {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const key = rows.map((row) => `${row.chainId}:${row.projectId}`).join(",");
  return useMemo(
    () =>
      new Map(
        rows.map(
          (row) => [row.chainId, current < 0 ? [] : readBatch(row.chainId, row.projectId)] as const,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers rows; `current` is the store version
    [key, current],
  );
}
