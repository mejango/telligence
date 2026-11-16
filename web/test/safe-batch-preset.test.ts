import { migratedPoolKey, type V4PoolKey } from "@/lib/buyback-pool-migration";
import { rolloutAddress, rolloutTargets } from "@/lib/protocol-rollout";
import { addStepsToBatch, buildStep, mirrorBatch, readBatch, upsertStep } from "@/lib/safe-batch";
import {
  mapTerminalToken,
  MIGRATION_MIRROR_LINE,
  resolvePreset,
  SAFE_BATCH_PRESETS,
  stepResolverFor,
  type PresetReadClient,
} from "@/lib/safe-batch-presets";
import { NATIVE_TOKEN, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import {
  uniswapV4PoolId,
  uniswapV4PoolStateSlot,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";

// The previous hook remains here deliberately: these tests exercise migration from a retired generation.

// Model a staged rollout explicitly so future mainnet data regeneration needs no test rewrite.
vi.mock("@/lib/protocol-rollout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol-rollout")>();
  return {
    ...actual,
    rolloutTargets: (chainId: number) =>
      [84532, 11155111, 421614].includes(chainId) ? actual.rolloutTargets(chainId) : null,
  };
});

const preset = SAFE_BATCH_PRESETS[0]!;
const targets = rolloutTargets(84532)!;
const OLD_HOOK = getAddress("0xb222da5a71e8fb89a5a38b7c920eab5dfbc74b91");
const POOL_HOOK = rolloutAddress("JBUniswapV4Hook", 84532)!;
const OLD_PRICE = 79_228_162_514_264_337_593_543_950_336n;
const NEW_PRICE = 2n * OLD_PRICE;
const OLD_TERMINAL = "0x5555555555555555555555555555555555555555" as Address;
const BASE_USDC = USDC_ADDRESSES[8453] as Address;

type Pools = Partial<Record<string, { twap: bigint; fee: number; tickSpacing: number }>>;

/** The PoolManager slot0 word for a key, as `extsload` returns it. */
function slotOf(key: V4PoolKey): string {
  return uniswapV4PoolStateSlot(uniswapV4PoolId(key)).toLowerCase();
}
/** The key the stub's current hook reports for a native pool. */
function oldNativeKey(fee: number, tickSpacing: number): V4PoolKey {
  return { currency0: zeroAddress, currency1: zeroAddress, fee, tickSpacing, hooks: OLD_HOOK };
}
/** A 3000/60 native pool live on both the old and the new V4 hook. */
const BOTH_POOLS_PRICED = {
  [slotOf(oldNativeKey(3_000, 60))]: OLD_PRICE,
  [slotOf(migratedPoolKey(oldNativeKey(3_000, 60), POOL_HOOK))]: OLD_PRICE,
};
const word = (price: bigint) => `0x${price.toString(16).padStart(64, "0")}`;

/** A fake chain: which targets have code, the project's current hook/terminal, and its pools per hook. */
function stubClient({
  deployed = [targets.hook, targets.terminal],
  hookOf = OLD_HOOK,
  terminalOf = OLD_TERMINAL,
  pools = {},
  carried = {},
  allowed = true,
  prices = {},
  coverage = 1_800,
  meanTick = 0,
  reservedSplits = [],
}: {
  deployed?: Address[];
  allowed?: boolean;
  hookOf?: Address;
  terminalOf?: Address;
  /** Pools on the current hook, keyed by the read token (address(0) for native). */
  pools?: Pools;
  /** TWAP windows already registered on the target hook. */
  carried?: Partial<Record<string, bigint>>;
  /** Live sqrtPriceX96 per pool key; any other pool is uninitialized. */
  prices?: Record<string, bigint>;
  /** The longest window the old V4 hook can observe, in seconds; 0 when it holds no history. */
  coverage?: number;
  /** The old pool's mean tick over the observed window. */
  meanTick?: number;
  /** The current stage's reserved splits. */
  reservedSplits?: readonly object[];
}): PresetReadClient {
  const lower = (value: unknown) => String(value).toLowerCase();
  return {
    getCode: async ({ address }: { address: Address }) =>
      deployed.some((item) => lower(item) === lower(address)) ? "0x6001" : "0x",
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const token = lower(args?.[1]);
      switch (functionName) {
        case "isHookAllowed":
        case "isTerminalAllowed":
          return allowed;
        case "hookOf":
          return hookOf;
        case "terminalOf":
          return terminalOf;
        case "twapWindowOf":
          if (lower(address) === lower(targets.hook)) return carried[token] ?? 0n;
          return pools[token]?.twap ?? 0n;
        case "poolKeyOf": {
          const pool = pools[token];
          return {
            currency0: zeroAddress,
            currency1: zeroAddress,
            fee: pool?.fee ?? 0,
            tickSpacing: pool?.tickSpacing ?? 0,
            hooks: address,
          };
        }
        case "extsload":
          return word(prices[lower(args?.[0])] ?? 0n);
        case "observe": {
          const [period] = args?.[1] as number[];
          if (period! > coverage)
            throw Object.assign(new Error("reverted"), { name: "ContractFunctionRevertedError" });
          return [
            [0n, BigInt(meanTick * period!)],
            [0n, 0n],
          ];
        }
        case "currentRulesetOf":
          return [{ id: 1781587898 }, {}];
        case "splitsOf":
          return reservedSplits;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  } as unknown as PresetReadClient;
}

describe("Move to buyback 2.0.0 + gateway", () => {
  it("is unavailable where either target has no code", async () => {
    const client = stubClient({ deployed: [targets.hook] });
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 6, client })).resolves.toEqual({
      status: "unavailable",
      message: "Not deployed on Base Sepolia yet.",
    });
  });

  it("keeps a mainnet unavailable when the staged fixture omits its canonical deployment", async () => {
    await expect(
      resolvePreset(preset, { chainId: 8453, projectId: 6, client: stubClient({}) }),
    ).resolves.toEqual({
      status: "unavailable",
      message: "Not deployed on Base yet.",
    });
  });

  it("tells an unreadable chain apart from an undeployed one", async () => {
    const client = {
      ...stubClient({}),
      getCode: async () => {
        throw new Error("origin not allowed");
      },
    } as unknown as PresetReadClient;
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 6, client })).resolves.toEqual({
      status: "unavailable",
      message: "Could not read Base Sepolia: origin not allowed",
    });
  });

  it.each([
    "hookOf",
    "old window",
    "target window",
    "terminalOf",
    "isHookAllowed",
    "isTerminalAllowed",
  ])("refuses migration when the required %s read fails", async (failure) => {
    const base = stubClient({
      pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } },
    });
    const client = {
      ...base,
      readContract: async (request: { address: Address; functionName: string }) => {
        const targetHook = request.address.toLowerCase() === targets.hook.toLowerCase();
        if (
          request.functionName === failure ||
          (request.functionName === "twapWindowOf" &&
            (failure === "target window" ? targetHook : failure === "old window" && !targetHook))
        ) {
          throw new Error("RPC unavailable");
        }
        return (base.readContract as (request: unknown) => Promise<unknown>)(request);
      },
    } as unknown as PresetReadClient;
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 2, client })).rejects.toThrow(
      "RPC unavailable",
    );
  });

  it("does not prepare or mirror targets that the live registries disallow", async () => {
    const unavailable = await resolvePreset(preset, {
      chainId: 84532,
      projectId: 2,
      client: stubClient({ allowed: false }),
    });
    expect(unavailable.status).toBe("unavailable");
    const migration = await resolvePreset(preset, {
      chainId: 84532,
      projectId: 2,
      client: stubClient({
        pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } },
        prices: BOTH_POOLS_PRICED,
      }),
    });
    if (migration.status !== "ready") throw new Error(migration.message);
    const mirrored = await mirrorBatch(
      migration.steps,
      84532,
      { chainId: 11155111, projectId: 2 },
      stepResolverFor(() => stubClient({ allowed: false })),
    );
    expect(mirrored.steps).toEqual([]);
    expect(mirrored.skipped).toHaveLength(3);
  });

  const OLD_LP_SPLIT_HOOK = "0x22988374af49507fec1ee78811fBc47d10D5e639" as Address;
  const NEW_LP_SPLIT_HOOK = getAddress("0xef8993f50363461007bed2f54e98bbef9854148a");
  const wholeSplitTo = (hook: Address, overrides: object = {}) => ({
    percent: 1_000_000_000,
    projectId: 0n,
    beneficiary: zeroAddress,
    preferAddToBalance: false,
    lockedUntil: 0,
    hook,
    ...overrides,
  });
  const current = { hookOf: targets.hook, terminalOf: targets.terminal };

  it("moves a reserved split from the old market maker hook to the current one", async () => {
    const client = stubClient({
      ...current,
      deployed: [targets.hook, targets.terminal, NEW_LP_SPLIT_HOOK],
      reservedSplits: [wholeSplitTo(OLD_LP_SPLIT_HOOK)],
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 4, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => [step.kind, step.label, step.contractName])).toEqual([
      ["setReservedSplitHook", "Set reserved split hook", "JBController"],
    ]);
    expect(result.steps[0]!.values).toEqual({ rulesetId: 1781587898n, hook: NEW_LP_SPLIT_HOOK });
    // Pinned in juicebox-money's preset test too: co-signers on either client must sign identical calldata.
    expect(result.steps[0]!.data).toMatchInlineSnapshot(
      `"0x8a36dffd0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000006a30dfba000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000003b9aca000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ef8993f50363461007bed2f54e98bbef9854148a"`,
    );
  });

  it.each([
    ["is already on the current hook", [wholeSplitTo(NEW_LP_SPLIT_HOOK)]],
    ["has no reserved split", []],
    [
      "shares the split with another recipient",
      [
        wholeSplitTo(OLD_LP_SPLIT_HOOK, { percent: 500_000_000 }),
        wholeSplitTo(zeroAddress, { percent: 500_000_000, beneficiary: OLD_TERMINAL }),
      ],
    ],
    ["locked the split", [wholeSplitTo(OLD_LP_SPLIT_HOOK, { lockedUntil: 1 })]],
  ])("leaves the reserved split alone when the project %s", async (_name, reservedSplits) => {
    const client = stubClient({
      ...current,
      deployed: [targets.hook, targets.terminal, NEW_LP_SPLIT_HOOK],
      reservedSplits,
    });
    await expect(
      resolvePreset(preset, { chainId: 84532, projectId: 4, client }),
    ).resolves.toMatchObject({ status: "nothing" });
  });

  it("leaves the reserved split alone where the current hook has no code", async () => {
    const client = stubClient({ ...current, reservedSplits: [wholeSplitTo(OLD_LP_SPLIT_HOOK)] });
    await expect(
      resolvePreset(preset, { chainId: 84532, projectId: 4, client }),
    ).resolves.toMatchObject({ status: "nothing" });
  });

  it("reports nothing to do when the hook and gateway are already current", async () => {
    const client = stubClient({ hookOf: targets.hook, terminalOf: targets.terminal });
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 6, client })).resolves.toEqual({
      status: "nothing",
      message: "Nothing to do on Base Sepolia: already on the current hook and gateway.",
    });
  });

  it("opens the native pool on the new V4 hook at the old pool's price", async () => {
    const oldKey = oldNativeKey(10_000, 200);
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 172_800n, fee: 10_000, tickSpacing: 200 } },
      prices: { [slotOf(oldKey)]: OLD_PRICE },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual([
      "setHookFor",
      "initializePoolFor",
      "setTerminalFor",
    ]);
    expect(result.steps[1]!.values).toEqual({
      fee: 10_000n,
      tickSpacing: 200n,
      twapWindow: 1_800n,
      terminalToken: NATIVE_TOKEN,
      sqrtPriceX96: OLD_PRICE,
    });
    // Pinned in juicebox-money's preset test too: co-signers on either client must sign identical calldata.
    expect(result.steps.map((step) => step.data)).toEqual([
      "0x779b0290000000000000000000000000000000000000000000000000000000000000000200000000000000000000000080717f09461a3fb08364fe8c5259220f7d06e0af",
      "0x49e303830000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000708000000000000000000000000000000000000000000000000000000000000eeee0000000000000000000000000000000000000001000000000000000000000000",
      "0xf3e37d010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000e2c259b2fcfd2d57ebcda9b3d2d10bdb1b2cd977",
    ]);
    expect(result.notes).toEqual([
      "Native pool: the old window was the deployer default (48h); 30 minutes will be stored.",
      "Native pool: starts at the old pool's average price over 30 minutes with no TWAP history; LPs move their own liquidity.",
    ]);
  });

  it("registers a new pool that already exists instead of initializing it at another price", async () => {
    const oldKey = oldNativeKey(10_000, 200);
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 1_800n, fee: 10_000, tickSpacing: 200 } },
      prices: {
        [slotOf(oldKey)]: OLD_PRICE,
        [slotOf(migratedPoolKey(oldKey, POOL_HOOK))]: OLD_PRICE + OLD_PRICE / 1_000n,
      },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual([
      "setHookFor",
      "setPoolFor",
      "setTerminalFor",
    ]);
    expect(result.steps[1]!.values).toEqual({
      fee: 10_000n,
      tickSpacing: 200n,
      twapWindow: 1_800n,
      terminalToken: NATIVE_TOKEN,
    });
    expect(result.notes).toEqual([]);
  });

  it("carries nothing from an old pool with no price", async () => {
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 1_800n, fee: 10_000, tickSpacing: 200 } },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
    expect(result.notes).toEqual([
      "Native pool has no price to carry; set it up on the new hook directly.",
    ]);
  });

  it("stores 30 minutes over a replaced window and writes USDC pools with the chain's USDC address", async () => {
    const client = stubClient({
      pools: {
        [USDC_ADDRESSES[84532].toLowerCase()]: { twap: 900n, fee: 10_000, tickSpacing: 200 },
      },
      prices: { [slotOf(oldNativeKey(10_000, 200))]: OLD_PRICE },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 6, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps[1]!.values).toEqual({
      fee: 10_000n,
      tickSpacing: 200n,
      twapWindow: 1_800n,
      terminalToken: USDC_ADDRESSES[84532],
      sqrtPriceX96: OLD_PRICE,
    });
    expect(result.notes).toEqual([
      "USDC pool: the old window was 900s; 30 minutes will be stored.",
      "USDC pool: starts at the old pool's average price over 30 minutes with no TWAP history; LPs move their own liquidity.",
    ]);
  });

  it("adds no setPoolFor when the project has no pool", async () => {
    const result = await resolvePreset(preset, {
      chainId: 11155111,
      projectId: 6,
      client: stubClient({}),
    });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
  });

  it("skips a pool the new hook already carries and a terminal already set", async () => {
    const client = stubClient({
      terminalOf: targets.terminal,
      pools: { [zeroAddress]: { twap: 900n, fee: 3_000, tickSpacing: 60 } },
      carried: { [zeroAddress]: 900n },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor"]);
    expect(result.notes).toEqual(["Native pool is already registered on the new hook."]);
  });
});

describe("mirroring per-chain steps", () => {
  it("cannot mirror migration selections or their dependent pool onto chains absent from the staged fixture", async () => {
    const migration = await resolvePreset(preset, {
      chainId: 84532,
      projectId: 2,
      client: stubClient({
        pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } },
        prices: BOTH_POOLS_PRICED,
      }),
    });
    if (migration.status !== "ready") throw new Error(migration.message);
    const sepoliaPoolHook = rolloutAddress("JBUniswapV4Hook", 11155111)!;
    const resolver = stepResolverFor(() =>
      stubClient({
        pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } },
        prices: {
          [slotOf(oldNativeKey(3_000, 60))]: OLD_PRICE,
          [slotOf(migratedPoolKey(oldNativeKey(3_000, 60), sepoliaPoolHook))]: OLD_PRICE,
        },
      }),
    );
    for (const chainId of [1, 10, 8453, 42161, 11155420]) {
      const result = await mirrorBatch(migration.steps, 84532, { chainId, projectId: 2 }, resolver);
      expect(result.steps).toEqual([]);
      expect(result.skipped).toHaveLength(3);
    }
    const reordered = await mirrorBatch(
      [migration.steps[1]!, migration.steps[0]!, migration.steps[2]!],
      84532,
      { chainId: 8453, projectId: 2 },
      resolver,
    );
    expect(reordered.steps).toEqual([]);
    expect(reordered.skipped).toHaveLength(1);
    // A deployed destination is refused too: the preset resolves each chain from its own state.
    const available = await mirrorBatch(
      [
        ...migration.steps,
        buildStep({
          kind: "setOperatorOf",
          chainId: 84532,
          projectId: 2,
          values: { operator: OLD_TERMINAL },
        }),
      ],
      84532,
      { chainId: 11155111, projectId: 2 },
      resolver,
    );
    expect(available.skipped.map((item) => item.reason)).toEqual([
      MIGRATION_MIRROR_LINE,
      "The preceding buyback hook selection could not be resolved on Sepolia.",
      MIGRATION_MIRROR_LINE,
    ]);
    expect(MIGRATION_MIRROR_LINE).toBe(
      'Use the "Move to buyback 2.0.0 + gateway" preset; it resolves every chain at once.',
    );
    // A step that is not part of the move still mirrors as before.
    expect(available.steps.map((step) => step.kind)).toEqual(["setOperatorOf"]);
  });

  it("refuses an existing new pool priced more than 1% off the old pool's TWAP", async () => {
    const oldKey = oldNativeKey(10_000, 200);
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 1_800n, fee: 10_000, tickSpacing: 200 } },
      prices: {
        [slotOf(oldKey)]: OLD_PRICE,
        [slotOf(migratedPoolKey(oldKey, POOL_HOOK))]: NEW_PRICE,
      },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
    expect(result.notes).toEqual([
      "Native pool: the new pool is priced more than 1% off the old one; not registered.",
    ]);
  });

  it("refuses a pool whose old history cannot be observed, never using spot", async () => {
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 1_800n, fee: 10_000, tickSpacing: 200 } },
      prices: { [slotOf(oldNativeKey(10_000, 200))]: NEW_PRICE },
      coverage: 0,
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
    expect(result.notes).toEqual([
      "Native pool: the old pool's price history can't be read; not carried.",
    ]);
  });

  it("initializes at the TWAP over the longest window the old hook can answer", async () => {
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 1_800n, fee: 10_000, tickSpacing: 200 } },
      prices: { [slotOf(oldNativeKey(10_000, 200))]: NEW_PRICE },
      coverage: 600,
      meanTick: -7,
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps[1]!.values.sqrtPriceX96).toBe(uniswapV4SqrtPriceX96AtTick(-7));
    expect(result.notes).toEqual([
      "Native pool: starts at the old pool's average price over 5 minutes with no TWAP history; LPs move their own liquidity.",
    ]);
  });

  it("maps USDC to the target chain's USDC and leaves native alone", () => {
    expect(mapTerminalToken(BASE_USDC, 8453, 10)).toBe(USDC_ADDRESSES[10]);
    expect(mapTerminalToken(NATIVE_TOKEN, 8453, 10)).toBe(NATIVE_TOKEN);
    expect(mapTerminalToken(OLD_TERMINAL, 8453, 10)).toBeNull();
  });

  it("re-reads the pool key on the target chain and keeps the chosen window", async () => {
    const resolve = stepResolverFor(() =>
      stubClient({ pools: { [zeroAddress]: { twap: 600n, fee: 3_000, tickSpacing: 60 } } }),
    );
    const step = buildStep({
      kind: "setPoolFor",
      chainId: 8453,
      projectId: 2,
      values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
    });
    await expect(resolve(step, 10, 7)).resolves.toEqual({
      values: { fee: 3_000n, tickSpacing: 60n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
    });
    const twap = buildStep({
      kind: "setTwapWindowOf",
      chainId: 8453,
      projectId: 2,
      values: { terminalToken: NATIVE_TOKEN, twapWindow: 900n },
      to: OLD_HOOK,
    });
    await expect(resolve(twap, 10, 7)).resolves.toEqual({
      to: OLD_HOOK,
      values: { terminalToken: NATIVE_TOKEN, twapWindow: 900n },
    });
  });

  it("refuses where the target chain has no such pool, and never mirrors a pool initialization", async () => {
    const resolve = stepResolverFor(() => stubClient({}));
    const step = buildStep({
      kind: "setPoolFor",
      chainId: 8453,
      projectId: 2,
      values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
    });
    await expect(resolve(step, 10, 7)).resolves.toBeNull();
    const init = buildStep({
      kind: "initializePoolFor",
      chainId: 8453,
      projectId: 2,
      values: {
        fee: 10_000n,
        tickSpacing: 200n,
        twapWindow: 1_800n,
        terminalToken: NATIVE_TOKEN,
        sqrtPriceX96: 1n,
      },
    });
    await expect(resolve(init, 10, 7)).resolves.toBeNull();
  });
});

describe("queued pool registrations", () => {
  const pool = (kind: "setPoolFor" | "initializePoolFor", terminalToken: Address) =>
    buildStep({
      kind,
      chainId: 84532,
      projectId: 2,
      values: {
        fee: 10_000n,
        tickSpacing: 200n,
        twapWindow: 1_800n,
        terminalToken,
        ...(kind === "initializePoolFor" ? { sqrtPriceX96: OLD_PRICE } : {}),
      },
    });

  it("keeps one registration per terminal token, whatever its operation", () => {
    const usdc = USDC_ADDRESSES[84532] as Address;
    const queued = [pool("setPoolFor", usdc), pool("setPoolFor", NATIVE_TOKEN)].reduce(upsertStep, [
      pool("initializePoolFor", NATIVE_TOKEN),
    ]);
    expect(queued.map((step) => [step.kind, step.values.terminalToken])).toEqual([
      ["setPoolFor", NATIVE_TOKEN],
      ["setPoolFor", usdc],
    ]);
  });

  it("removes a queued registration that a fresh resolution refuses", async () => {
    window.localStorage.clear();
    const oldKey = oldNativeKey(10_000, 200);
    const resolveAt = async (newPrice: bigint) => {
      const client = stubClient({
        pools: { [zeroAddress]: { twap: 1_800n, fee: 10_000, tickSpacing: 200 } },
        prices: {
          [slotOf(oldKey)]: OLD_PRICE,
          [slotOf(migratedPoolKey(oldKey, POOL_HOOK))]: newPrice,
        },
      });
      const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
      if (result.status !== "ready") throw new Error(result.message);
      addStepsToBatch(result.steps, result.dropped);
    };
    await resolveAt(OLD_PRICE);
    expect(readBatch(84532, 2).map((step) => step.kind)).toContain("setPoolFor");
    await resolveAt(NEW_PRICE);
    expect(readBatch(84532, 2).map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
  });

  it("removes a queued registration of a pool the current hook already holds", async () => {
    window.localStorage.clear();
    addStepsToBatch([pool("setPoolFor", NATIVE_TOKEN)]);
    const client = stubClient({ hookOf: targets.hook, carried: { [zeroAddress]: 1_800n } });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    addStepsToBatch(result.steps, result.dropped);
    expect(readBatch(84532, 2).map((step) => step.kind)).toEqual(["setTerminalFor"]);
  });
});
