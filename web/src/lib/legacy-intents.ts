/**
 * REMOVE AFTER ONE RELEASE. Frozen copies of the intent namespaces revnet built before SDK 2.38's
 * builders (origin/main 71c24286, #80), exactly as that code built them. A write whose key
 * changed passes these as `legacy`, so an attempt that build left unresolved still holds its
 * retry, whatever calldata the retry regenerates. Nothing here keys a new write on its own except
 * a write the SDK builders don't cover, which keeps the namespace it had.
 */
import { intent, writeIntentKey, type IntentValue } from "@bananapus/nana-sdk-core/review";
import { decodeAbiParameters, encodeFunctionData, type Abi, type Address, type Hex } from "viem";

type Params = { readonly [name: string]: IntentValue | undefined };

/** A decoded ABI value as an intent value: addresses and bytes tagged, numbers kept. */
function abiIntent(value: unknown): IntentValue {
  if (typeof value === "string")
    return /^0x[0-9a-fA-F]{40}$/.test(value)
      ? intent.address(value)
      : /^0x[0-9a-fA-F]*$/.test(value)
        ? intent.hex(value)
        : value;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map(abiIntent);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, abiIntent(item)]));
  return null;
}

const ON_TOKEN = new Set([0x00, 0x01, 0x03, 0x04]);
const MINTS = new Set([0x02, 0x05]);
const POOL_KEY = [
  {
    type: "tuple",
    components: [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
  },
] as const;

function liquidityTargets(unlockData: unknown): IntentValue {
  try {
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      unlockData as Hex,
    );
    const codes = actions.slice(2).match(/../g) ?? [];
    if (codes.length !== params.length) return "unread";
    const positions = new Set<string>();
    const pools = new Set<string>();
    codes.forEach((hex, index) => {
      const code = parseInt(hex, 16);
      const param = params[index]!;
      if (ON_TOKEN.has(code))
        positions.add(decodeAbiParameters([{ type: "uint256" }], param)[0].toString());
      else if (MINTS.has(code))
        pools.add(JSON.stringify(abiIntent(decodeAbiParameters(POOL_KEY, param)[0])));
    });
    return {
      positions: [...positions].sort().map((id) => BigInt(id)),
      pools: [...pools].sort(),
    };
  } catch {
    return "unread";
  }
}

type Write = { address?: Address; functionName?: unknown; args?: readonly unknown[] };

/** The namespace that build gave a write by its call alone (approvals, liquidity, Safe execution). */
export function legacyCallNamespace(write: Write): string | undefined {
  const to = write.address ? intent.address(write.address) : null;
  const args = write.args ?? [];
  if (write.functionName === "approve" && args.length === 2)
    return writeIntentKey("approve", { to, spender: abiIntent(args[0]) });
  if (write.functionName === "approve" && args.length === 4)
    return writeIntentKey("permit2-approve", {
      to,
      token: abiIntent(args[0]),
      spender: abiIntent(args[1]),
    });
  if (write.functionName === "modifyLiquidities")
    return writeIntentKey("lp", { to, targets: liquidityTargets(args[0]) });
  if (write.functionName === "execTransaction" && args.length === 10)
    return writeIntentKey("safe-exec", { to, transaction: abiIntent(args.slice(0, 9)) });
  return undefined;
}

/** The namespace that build gave every Safe batch. */
export function legacyBatchNamespace(
  calls: readonly (Write & { abi: Abi; value?: bigint })[],
): string {
  return writeIntentKey("batch", {
    calls: calls.map(
      (call) =>
        legacyCallNamespace(call) ?? {
          to: call.address ? intent.address(call.address) : null,
          value: call.value ?? 0n,
          data: intent.hex(
            encodeFunctionData({
              abi: call.abi,
              functionName: call.functionName as string,
              args: call.args as unknown[],
            }),
          ),
        },
    ),
  });
}

/**
 * Every key that build's form provenance could give an amount: the typed value, an option the
 * user picked, or the app's seed.
 */
function chosen(value: IntentValue, field: string, policies: readonly string[]): IntentValue[] {
  return [value, `auto:${field}`, ...policies.map((policy) => `policy:${policy}`)];
}

/** The amount buttons that build offered (10%, 25%, 50% and Max), by the names it keyed them by. */
const AMOUNT_OPTIONS = ["max", "10%", "25%", "50%"];

const key = (action: string, params: Params) => writeIntentKey(action, params);

export const legacyIntents = {
  pay: (projectId: number | bigint, beneficiary: string) => [
    key("pay", { projectId: BigInt(projectId), beneficiary: intent.address(beneficiary) }),
  ],
  cashOut: (c: {
    projectId: number | bigint;
    token: string;
    amount: bigint;
    beneficiary: string;
  }) =>
    chosen(c.amount, "amount", AMOUNT_OPTIONS).map((amount) =>
      key("cash-out", {
        projectId: BigInt(c.projectId),
        token: intent.address(c.token),
        amount,
        beneficiary: intent.address(c.beneficiary),
      }),
    ),
  bridge: (b: { sucker: string; token: string; amount: bigint }) =>
    chosen(b.amount, "amount", AMOUNT_OPTIONS).map((amount) =>
      key("bridge", { sucker: intent.address(b.sucker), token: intent.address(b.token), amount }),
    ),
  toRemote: (sucker: string, token: string) => [
    key("to-remote", { sucker: intent.address(sucker), token: intent.address(token) }),
  ],
  sync: (sucker: string) => [key("sucker-sync", { sucker: intent.address(sucker) })],
  repay: (loanId: string | number | bigint) => [key("repay", { loanId: BigInt(loanId) })],
  reallocate: (loanId: string | number | bigint) => [key("reallocate", { loanId: BigInt(loanId) })],
  borrow: (b: {
    revnetId: number | bigint;
    token: string;
    collateral: bigint;
    prepaidFeePercent: number;
  }) =>
    chosen(b.collateral, "collateral", AMOUNT_OPTIONS).map((collateral) =>
      key("borrow", {
        revnetId: b.revnetId as IntentValue,
        token: intent.address(b.token),
        collateral,
        prepaidFeePercent: b.prepaidFeePercent,
      }),
    ),
  /** That build keyed a launch by its config's hash (`launchConfigHash`). */
  launch: (configHash: Hex) => [key("launch", { config: intent.hex(configHash) })],
} satisfies Record<string, (...args: never[]) => string[]>;
