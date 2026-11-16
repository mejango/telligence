import { chainDisplayName } from "@/app/constants";
import {
  migratedPoolKey,
  poolMove,
  poolSqrtPriceX96,
  poolTwapSqrtPriceX96,
  pricesAgree,
  type V4PoolKey,
} from "@/lib/buyback-pool-migration";
import { rolloutAddress, rolloutTargets } from "@/lib/protocol-rollout";
import {
  buildStep,
  contractAddressOn,
  RESERVED_TOKEN_SPLIT_GROUP_ID,
  stepKey,
  type BatchStep,
  type BatchStepRef,
  type BatchStepValues,
  type StepResolver,
} from "@/lib/safe-batch";
import {
  jbBuybackHookAbi,
  jbBuybackHookRegistryAbi,
  jbControllerAbi,
  jbRouterTerminalRegistryAbi,
  jbSplitsAbi,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import { getAddress, isAddressEqual, zeroAddress, type Address, type PublicClient } from "viem";

export type SafeBatchPreset = {
  id: string;
  title: string;
  description: string;
  steps: readonly ("setHookFor" | "setPoolFor" | "setTerminalFor" | "setReservedSplitHook")[];
};

export const SAFE_BATCH_PRESETS: readonly SafeBatchPreset[] = [
  {
    id: "buyback-2-0-0-gateway",
    title: "Move to buyback 2.0.0 + gateway",
    description:
      "Points the project at the current buyback hook and router gateway, and opens its pool on the new hook at the old pool's price. A reserved split still on the old market maker hook moves to the current one.",
    steps: ["setHookFor", "setPoolFor", "setTerminalFor", "setReservedSplitHook"],
  },
];

/** `JBBuybackHook.MAX_TWAP_WINDOW`: the deployer default, which the hook stores as 30 minutes. */
const MAX_TWAP_WINDOW = 172_800n;
/**
 * The window every migrated pool is registered with, whatever the old hook held.
 * Must match juicebox-money's preset: Safe co-signers on either client only meet on identical calldata.
 */
const PRESET_TWAP_WINDOW = 1_800n;

/**
 * The LP split hook 1.0.0 clone, at one address on every chain. A reserved split still on it
 * moves to `JBP6FeeLPSplitHook`. Must match juicebox-money's preset.
 */
const OLD_LP_SPLIT_HOOK = "0x22988374af49507fec1ee78811fBc47d10D5e639";

export type PresetResolution =
  | { status: "unavailable"; message: string }
  | { status: "nothing"; message: string }
  /** `dropped`: queued pool registrations this resolution refuses, removed when it is added. */
  | { status: "ready"; steps: BatchStep[]; notes: string[]; dropped: BatchStepRef[] };

export type PresetReadClient = Pick<PublicClient, "getCode" | "readContract">;

type TokenProbe = { label: string; read: Address; write: Address };

/** Native reads as address(0) and writes as the 0xEEEe sentinel; USDC is its chain address. */
function tokenProbes(chainId: number): TokenProbe[] {
  const probes: TokenProbe[] = [{ label: "Native", read: zeroAddress, write: NATIVE_TOKEN }];
  const usdc = USDC_ADDRESSES[chainId as keyof typeof USDC_ADDRESSES];
  if (usdc) probes.push({ label: "USDC", read: getAddress(usdc), write: getAddress(usdc) });
  return probes;
}

async function hasCode(client: PresetReadClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return !!code && code !== "0x";
}

async function selectionAllowed(
  client: PresetReadClient,
  chainId: number,
  kind: "hook" | "terminal",
  target: Address,
): Promise<boolean> {
  if (kind === "hook") {
    const registry = contractAddressOn("JBBuybackHookRegistry", chainId);
    return (
      !!registry &&
      (await client.readContract({
        address: registry,
        abi: jbBuybackHookRegistryAbi,
        functionName: "isHookAllowed",
        args: [target],
      }))
    );
  }
  const registry = contractAddressOn("JBRouterTerminalRegistry", chainId);
  return (
    !!registry &&
    (await client.readContract({
      address: registry,
      abi: jbRouterTerminalRegistryAbi,
      functionName: "isTerminalAllowed",
      args: [target],
    }))
  );
}

async function twapWindowOn(
  client: PresetReadClient,
  hook: Address,
  projectId: bigint,
  token: Address,
): Promise<bigint> {
  return client.readContract({
    address: hook,
    abi: jbBuybackHookAbi,
    functionName: "twapWindowOf",
    args: [projectId, token],
  });
}

async function currentHookOf(
  client: PresetReadClient,
  chainId: number,
  projectId: bigint,
): Promise<Address | null> {
  const registry = contractAddressOn("JBBuybackHookRegistry", chainId);
  if (!registry) return null;
  const hook = await client.readContract({
    address: registry,
    abi: jbBuybackHookRegistryAbi,
    functionName: "hookOf",
    args: [projectId],
  });
  return hook && !isAddressEqual(hook, zeroAddress) ? getAddress(hook) : null;
}

type PoolStep =
  | { kind: "setPoolFor" | "initializePoolFor"; values: BatchStepValues; notes: string[] }
  | { kind: "skip"; notes: string[] };

/** "30 minutes" for 1800 seconds; seconds when not whole minutes. */
function windowLabel(seconds: bigint | number): string {
  const value = BigInt(seconds);
  return value % 60n === 0n ? `${value / 60n} minute${value === 60n ? "" : "s"}` : `${value}s`;
}

/**
 * One terminal token's pool carried onto the target hook, from this chain's own state: an existing
 * new pool is registered only when it trades within 1% of the old pool's TWAP, otherwise the pool
 * opens at that TWAP. Null when the old hook has no pool for the token.
 */
async function poolStepOn(
  client: PresetReadClient,
  chainId: number,
  pid: bigint,
  currentHook: Address,
  targetHook: Address,
  poolHook: Address,
  probe: TokenProbe,
): Promise<PoolStep | null> {
  const twapWindow = PRESET_TWAP_WINDOW;
  const oldWindow = await twapWindowOn(client, currentHook, pid, probe.read);
  if (oldWindow <= 0n) return null;
  const carried = await twapWindowOn(client, targetHook, pid, probe.read);
  if (carried > 0n) {
    return { kind: "skip", notes: [`${probe.label} pool is already registered on the new hook.`] };
  }
  const oldKey = (await client.readContract({
    address: currentHook,
    abi: jbBuybackHookAbi,
    functionName: "poolKeyOf",
    args: [pid, probe.read],
  })) as V4PoolKey;
  const newKey = migratedPoolKey(oldKey, poolHook);
  const [reference, newPrice] = await Promise.all([
    poolTwapSqrtPriceX96(client, chainId, oldKey, Number(PRESET_TWAP_WINDOW)),
    poolSqrtPriceX96(client, chainId, newKey),
  ]);
  if (!reference) {
    return {
      kind: "skip",
      notes: [`${probe.label} pool: the old pool's price history can't be read; not carried.`],
    };
  }
  const move = poolMove(reference.sqrtPriceX96, newPrice);
  if (move.kind === "none") {
    return {
      kind: "skip",
      notes: [`${probe.label} pool has no price to carry; set it up on the new hook directly.`],
    };
  }
  if (move.kind === "setPoolFor" && !pricesAgree(newPrice, reference.sqrtPriceX96)) {
    return {
      kind: "skip",
      notes: [
        `${probe.label} pool: the new pool is priced more than 1% off the old one; not registered.`,
      ],
    };
  }
  const notes: string[] = [];
  if (oldWindow === MAX_TWAP_WINDOW) {
    notes.push(
      `${probe.label} pool: the old window was the deployer default (48h); ${windowLabel(twapWindow)} will be stored.`,
    );
  } else if (oldWindow !== twapWindow) {
    notes.push(
      `${probe.label} pool: the old window was ${oldWindow}s; ${windowLabel(twapWindow)} will be stored.`,
    );
  }
  if (move.kind === "initializePoolFor") {
    notes.push(
      `${probe.label} pool: starts at the old pool's average price over ${windowLabel(reference.window)} with no TWAP history; LPs move their own liquidity.`,
    );
  }
  return {
    kind: move.kind,
    notes,
    values: {
      fee: BigInt(newKey.fee),
      tickSpacing: BigInt(newKey.tickSpacing),
      twapWindow,
      terminalToken: probe.write,
      ...(move.kind === "initializePoolFor" ? { sqrtPriceX96: move.sqrtPriceX96 } : {}),
    },
  };
}

/**
 * The current stage's reserved split hook, when the whole split goes to the old market maker
 * hook and the current one is deployed here. Any other split shape is left alone.
 */
async function reservedSplitHookMove(
  client: PresetReadClient,
  chainId: number,
  projectId: bigint,
): Promise<BatchStepValues | null> {
  const controller = contractAddressOn("JBController", chainId);
  const splitsContract = contractAddressOn("JBSplits", chainId);
  const hook = contractAddressOn("JBP6FeeLPSplitHook", chainId);
  if (!controller || !splitsContract || !hook) return null;
  const [{ id }] = await client.readContract({
    address: controller,
    abi: jbControllerAbi,
    functionName: "currentRulesetOf",
    args: [projectId],
  });
  const splits = await client.readContract({
    address: splitsContract,
    abi: jbSplitsAbi,
    functionName: "splitsOf",
    args: [projectId, BigInt(id), RESERVED_TOKEN_SPLIT_GROUP_ID],
  });
  const [split] = splits;
  if (
    splits.length !== 1 ||
    !split ||
    split.percent !== 1_000_000_000 ||
    split.projectId !== 0n ||
    split.preferAddToBalance ||
    Number(split.lockedUntil) !== 0 ||
    !isAddressEqual(split.beneficiary, zeroAddress) ||
    !isAddressEqual(split.hook, OLD_LP_SPLIT_HOOK)
  ) {
    return null;
  }
  if (!(await hasCode(client, hook))) return null;
  return { rulesetId: BigInt(id), hook };
}

/**
 * Resolve the preset against one chain's live state: skip what is already
 * applied, carry each existing pool onto the target hook, and say plainly
 * when the targets are not deployed there or nothing is left to do.
 */
export async function resolvePreset(
  preset: SafeBatchPreset,
  { chainId, projectId, client }: { chainId: number; projectId: number; client: PresetReadClient },
): Promise<PresetResolution> {
  const chain = chainDisplayName(chainId);
  const targets = rolloutTargets(chainId);
  if (!targets) return { status: "unavailable", message: `Not deployed on ${chain} yet.` };
  // An RPC that cannot answer is not "no code": say which so nobody waits on a deployment.
  let deployed: boolean;
  try {
    const [hook, terminal] = await Promise.all([
      hasCode(client, targets.hook),
      hasCode(client, targets.terminal),
    ]);
    deployed = hook && terminal;
  } catch (cause) {
    return {
      status: "unavailable",
      message: `Could not read ${chain}: ${(cause as { shortMessage?: string; message?: string }).shortMessage ?? (cause as Error).message}`,
    };
  }
  if (!deployed) return { status: "unavailable", message: `Not deployed on ${chain} yet.` };

  const allowed = await Promise.all([
    selectionAllowed(client, chainId, "hook", targets.hook),
    selectionAllowed(client, chainId, "terminal", targets.terminal),
  ]);
  if (!allowed.every(Boolean))
    return {
      status: "unavailable",
      message: `The migration targets are not allowlisted on ${chain}.`,
    };

  const pid = BigInt(projectId);
  const steps: BatchStep[] = [];
  const notes: string[] = [];
  const dropped: BatchStepRef[] = [];

  const currentHook = await currentHookOf(client, chainId, pid);
  const poolHook = rolloutAddress("JBUniswapV4Hook", chainId);
  const onTargetHook = !!currentHook && isAddressEqual(currentHook, targets.hook);
  if (preset.steps.includes("setHookFor") && !onTargetHook) {
    steps.push(
      buildStep({
        kind: "setHookFor",
        chainId,
        projectId,
        values: { hook: getAddress(targets.hook) },
      }),
    );
  }

  // Probed on the target hook too, so a queued registration of a pool it already holds is dropped.
  if (preset.steps.includes("setPoolFor") && currentHook) {
    if (!poolHook) {
      return { status: "unavailable", message: `The current V4 hook is not recorded on ${chain}.` };
    }
    for (const probe of tokenProbes(chainId)) {
      const pool = await poolStepOn(
        client,
        chainId,
        pid,
        currentHook,
        targets.hook,
        poolHook,
        probe,
      );
      if (!pool) continue;
      notes.push(...pool.notes);
      if (pool.kind !== "skip") {
        steps.push(buildStep({ kind: pool.kind, chainId, projectId, values: pool.values }));
      } else {
        const to = contractAddressOn("JBBuybackHookRegistry", chainId)!;
        const values = { terminalToken: probe.write };
        dropped.push({ chainId, projectId, id: stepKey({ kind: "setPoolFor", to, values }) });
      }
    }
  }

  if (preset.steps.includes("setTerminalFor")) {
    const routerRegistry = contractAddressOn("JBRouterTerminalRegistry", chainId);
    const terminal = routerRegistry
      ? await client.readContract({
          address: routerRegistry,
          abi: jbRouterTerminalRegistryAbi,
          functionName: "terminalOf",
          args: [pid],
        })
      : null;
    if (!terminal || !isAddressEqual(terminal, targets.terminal)) {
      steps.push(
        buildStep({
          kind: "setTerminalFor",
          chainId,
          projectId,
          values: { terminal: getAddress(targets.terminal) },
        }),
      );
    }
  }

  if (preset.steps.includes("setReservedSplitHook")) {
    const values = await reservedSplitHookMove(client, chainId, pid);
    if (values) {
      steps.push(buildStep({ kind: "setReservedSplitHook", chainId, projectId, values }));
    }
  }

  if (!steps.length) {
    return {
      status: "nothing",
      message: `Nothing to do on ${chain}: already on the current hook and gateway.`,
    };
  }
  return { status: "ready", steps, notes, dropped };
}

/** The same token class on another chain: native stays native, USDC becomes that chain's USDC. */
export function mapTerminalToken(
  token: Address,
  fromChainId: number,
  toChainId: number,
): Address | null {
  if (isAddressEqual(token, NATIVE_TOKEN) || isAddressEqual(token, zeroAddress)) return token;
  const from = USDC_ADDRESSES[fromChainId as keyof typeof USDC_ADDRESSES];
  const to = USDC_ADDRESSES[toChainId as keyof typeof USDC_ADDRESSES];
  if (from && to && isAddressEqual(token, from)) return getAddress(to);
  return null;
}

/** Shared with juicebox-money: a migration step is never mirrored. */
export const MIGRATION_MIRROR_LINE = `Use the "${SAFE_BATCH_PRESETS[0]!.title}" preset; it resolves every chain at once.`;

/**
 * How "Same on every chain" rebuilds a per-chain step: pool parameters come
 * from the target chain's live pool, the hook target from its registry, and a
 * pool initialization (chain-specific price) is refused outright.
 */
export function stepResolverFor(clientFor: (chainId: number) => PresetReadClient): StepResolver {
  return async (step, chainId, projectId) => {
    const client = clientFor(chainId);
    const pid = BigInt(projectId);
    if (step.kind === "setHookFor" || step.kind === "setTerminalFor") {
      const source = rolloutTargets(step.chainId);
      const target = rolloutTargets(chainId);
      if (!source || !target) return null;
      const key = step.kind === "setHookFor" ? "hook" : "terminal";
      const selected = step.values[key];
      // Custom selections require an explicit edit on each target network.
      if (typeof selected !== "string" || !isAddressEqual(selected, source[key])) return null;
      // The move to the rollout targets is resolved per chain by its preset, never copied; the
      // pool registrations after this selection are dropped with it.
      throw new Error(MIGRATION_MIRROR_LINE);
    }
    // Its ruleset id is this chain's; the preset reads each chain's own.
    if (step.kind === "setReservedSplitHook") throw new Error(MIGRATION_MIRROR_LINE);
    if (step.kind === "initializePoolFor") return null;
    const token = mapTerminalToken(step.values.terminalToken as Address, step.chainId, chainId);
    if (!token) return null;
    const hook = await currentHookOf(client, chainId, pid);
    if (!hook) return null;
    const read = isAddressEqual(token, NATIVE_TOKEN) ? zeroAddress : token;
    const window = await twapWindowOn(client, hook, pid, read);
    if (window <= 0n) return null;
    if (step.kind === "setTwapWindowOf") {
      return { to: hook, values: { ...step.values, terminalToken: token } };
    }
    if (step.kind === "setPoolFor") {
      const key = await client.readContract({
        address: hook,
        abi: jbBuybackHookAbi,
        functionName: "poolKeyOf",
        args: [pid, read],
      });
      return {
        values: {
          ...step.values,
          fee: BigInt(key.fee),
          tickSpacing: BigInt(key.tickSpacing),
          terminalToken: token,
        },
      };
    }
    return null;
  };
}
