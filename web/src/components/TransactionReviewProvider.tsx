"use client";

import { CallRow, ExactCallCard } from "@/components/ExactCallCard";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resumePendingRelayrBundles, waitForRelayrBundle } from "@/hooks/useReviewedRelayr";
import { resumeSafeProposalTracking } from "@/hooks/useReviewedWriteContract";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_BY_CHAIN } from "@/lib/directPaySwap";
import { canCheckRelayrBundle } from "@/lib/relayr-activity";
import { safeSetupAbi, safeToL2SetupAbi } from "@/lib/safeDeployment";
import {
  dismissTransactionActivity,
  updateTransactionActivity,
  useTransactionActivities,
} from "@/lib/transaction-activity";
import {
  buildTransactionReviewPrompt,
  registerTransactionReviewHandler,
  transactionReviewJson,
  type TransactionReviewCall,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { explorerBaseUrl } from "@/lib/utils";
import {
  JB_CHAINS,
  jbContractAddress,
  jbControllerAbi,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbPermissionsAbi,
  jbProjectsAbi,
  jbSplitsAbi,
  jbTokensAbi,
  SPLITS_TOTAL_PERCENT,
  USDC_ADDRESSES,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { JBPermissionCatalogV6 } from "@bananapus/nana-sdk-core/v6";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  toFunctionSelector,
  zeroAddress,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { useAccount } from "wagmi";

type PendingReview = {
  id: number;
  request: TransactionReviewRequest;
  resolve: (approved: boolean) => void;
};

const SAFE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};
function json(value: unknown): string {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}

function knownAddress(chainId: number, address: unknown): string | null {
  if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/iu.test(address)) return null;
  if (address.toLowerCase() === PERMIT2_ADDRESS.toLowerCase()) return "Permit2";
  if (UNIVERSAL_ROUTER_BY_CHAIN[chainId as JBChainId]?.toLowerCase() === address.toLowerCase()) {
    return "Uniswap Universal Router";
  }
  if (USDC_ADDRESSES[chainId as JBChainId]?.toLowerCase() === address.toLowerCase()) return "USDC";
  const contracts = jbContractAddress["6"] as unknown as Record<
    string,
    Partial<Record<number, Address>>
  >;
  return (
    Object.entries(contracts).find(
      ([, addresses]) => addresses[chainId]?.toLowerCase() === address.toLowerCase(),
    )?.[0] ?? null
  );
}

function knownContract(call: TransactionReviewCall): string | null {
  return call.contractName || knownAddress(call.chainId, call.to);
}

function prettyArgument(call: TransactionReviewCall, argumentIndex: number) {
  const value = call.args?.[argumentIndex];
  const label = knownAddress(call.chainId, value);
  return label ? `${label} | ${String(value)}` : json(value);
}

export type V4PlanStep =
  | {
      action: "INCREASE_LIQUIDITY";
      position: string;
      liquidity: bigint;
      maximumIn: { currency0: bigint; currency1: bigint };
    }
  | {
      action: "DECREASE_LIQUIDITY";
      position: string;
      liquidity: bigint;
      minimumOut: { currency0: bigint; currency1: bigint };
    }
  | {
      action: "MINT_POSITION";
      owner: string;
      pool: {
        currency0: string;
        currency1: string;
        fee: number;
        tickSpacing: number;
        hook: string;
      };
      ticks: { lower: number; upper: number };
      liquidity: bigint;
      maximumIn: { currency0: bigint; currency1: bigint };
    }
  | {
      action: "BURN_POSITION";
      position: string;
      minimumOut: { currency0: bigint; currency1: bigint };
    }
  | { action: "TAKE_PAIR"; currency0: string; currency1: string; recipient: string }
  | { action: "CLOSE_CURRENCY"; currency: string }
  | { action: "SWEEP"; currency: string; recipient: string };

/**
 * Decode a Uniswap V4 PositionManager `unlockData` plan into typed steps.
 * Covers only the actions this app builds (increase/decrease/mint/burn/take/
 * close/sweep); anything unrecognized falls back to the raw argument view — a
 * pretty rendering must never paper over bytes it can't fully account for.
 * Amounts stay in raw token units on purpose: this dialog shows the exact
 * payload. Addresses stay raw here; the renderer resolves known names.
 */
export function describeV4UnlockData(value: unknown): V4PlanStep[] | null {
  if (typeof value !== "string" || !value.startsWith("0x")) return null;
  try {
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      value as Hex,
    );
    const codes = actions.slice(2).match(/.{2}/g) ?? [];
    if (!codes.length || codes.length !== params.length) return null;
    const steps: V4PlanStep[] = [];
    for (const [index, byte] of codes.entries()) {
      const data = params[index];
      switch (parseInt(byte, 16)) {
        case 0x00: {
          const [tokenId, liquidity, amount0Max, amount1Max] = decodeAbiParameters(
            [
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint128" },
              { type: "uint128" },
              { type: "bytes" },
            ],
            data,
          );
          steps.push({
            action: "INCREASE_LIQUIDITY",
            position: `#${tokenId}`,
            liquidity,
            maximumIn: { currency0: amount0Max, currency1: amount1Max },
          });
          break;
        }
        case 0x01: {
          // The liquidity word is a uint256 in the PositionManager's decoder.
          const [tokenId, liquidity, amount0Min, amount1Min] = decodeAbiParameters(
            [
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint128" },
              { type: "uint128" },
              { type: "bytes" },
            ],
            data,
          );
          steps.push({
            action: "DECREASE_LIQUIDITY",
            position: `#${tokenId}`,
            liquidity,
            minimumOut: { currency0: amount0Min, currency1: amount1Min },
          });
          break;
        }
        case 0x02: {
          const [key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner] =
            decodeAbiParameters(
              [
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
                { type: "int24" },
                { type: "int24" },
                { type: "uint256" },
                { type: "uint128" },
                { type: "uint128" },
                { type: "address" },
                { type: "bytes" },
              ],
              data,
            );
          steps.push({
            action: "MINT_POSITION",
            owner,
            pool: {
              currency0: key[0],
              currency1: key[1],
              fee: key[2],
              tickSpacing: key[3],
              hook: key[4],
            },
            ticks: { lower: tickLower, upper: tickUpper },
            liquidity,
            maximumIn: { currency0: amount0Max, currency1: amount1Max },
          });
          break;
        }
        case 0x03: {
          const [tokenId, amount0Min, amount1Min] = decodeAbiParameters(
            [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
            data,
          );
          steps.push({
            action: "BURN_POSITION",
            position: `#${tokenId}`,
            minimumOut: { currency0: amount0Min, currency1: amount1Min },
          });
          break;
        }
        case 0x11: {
          const [currency0, currency1, recipient] = decodeAbiParameters(
            [{ type: "address" }, { type: "address" }, { type: "address" }],
            data,
          );
          steps.push({ action: "TAKE_PAIR", currency0, currency1, recipient });
          break;
        }
        case 0x12: {
          const [currency] = decodeAbiParameters([{ type: "address" }], data);
          steps.push({ action: "CLOSE_CURRENCY", currency });
          break;
        }
        case 0x14: {
          const [currency, recipient] = decodeAbiParameters(
            [{ type: "address" }, { type: "address" }],
            data,
          );
          steps.push({ action: "SWEEP", currency, recipient });
          break;
        }
        default:
          return null;
      }
    }
    return steps;
  } catch {
    return null;
  }
}

/** The pay-confirm row grammar: `Label: value`, addresses resolved to known names. */
function V4PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1">
      <dt className="shrink-0 text-zinc-500">{label}:</dt>
      <dd className="min-w-0 break-all font-mono text-zinc-800">{children}</dd>
    </div>
  );
}

function v4AddressLabel(chainId: number, address: string): string {
  if (address.toLowerCase() === zeroAddress) return `native ETH | ${address}`;
  const label = knownAddress(chainId, address);
  return label ? `${label} | ${address}` : address;
}

function v4Amounts(pair: { currency0: bigint; currency1: bigint }): string {
  return `${pair.currency0} (currency0) + ${pair.currency1} (currency1)`;
}

/** A decoded unlockData plan in the same row grammar the pay confirm uses. */
function V4PlanView({ steps, chainId }: { steps: V4PlanStep[]; chainId: number }) {
  return (
    <div className="mt-1 space-y-3">
      {steps.map((step, index) => {
        const title = (text: string) => (
          <p className="font-bold text-zinc-800">
            {index + 1}. {text}
          </p>
        );
        switch (step.action) {
          case "INCREASE_LIQUIDITY":
            return (
              <dl key={index} className="space-y-0.5">
                {title(`Increase position ${step.position}`)}
                <V4PlanRow label="Liquidity added">{String(step.liquidity)}</V4PlanRow>
                <V4PlanRow label="Maximum in">
                  {v4Amounts(step.maximumIn)} — reverts above this
                </V4PlanRow>
              </dl>
            );
          case "BURN_POSITION":
            return (
              <dl key={index} className="space-y-0.5">
                {title(`Burn position ${step.position}`)}
                <V4PlanRow label="Minimum out">
                  {v4Amounts(step.minimumOut)} — reverts below this
                </V4PlanRow>
              </dl>
            );
          case "DECREASE_LIQUIDITY":
            return (
              <dl key={index} className="space-y-0.5">
                {title(
                  step.liquidity === 0n
                    ? `Collect fees on position ${step.position} (liquidity untouched)`
                    : `Decrease position ${step.position}`,
                )}
                {step.liquidity !== 0n ? (
                  <>
                    <V4PlanRow label="Liquidity">{String(step.liquidity)}</V4PlanRow>
                    <V4PlanRow label="Minimum out">
                      {v4Amounts(step.minimumOut)} — reverts below this
                    </V4PlanRow>
                  </>
                ) : null}
              </dl>
            );
          case "MINT_POSITION":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Mint a new position")}
                <V4PlanRow label="Owner">{v4AddressLabel(chainId, step.owner)}</V4PlanRow>
                <V4PlanRow label="Currency0">
                  {v4AddressLabel(chainId, step.pool.currency0)}
                </V4PlanRow>
                <V4PlanRow label="Currency1">
                  {v4AddressLabel(chainId, step.pool.currency1)}
                </V4PlanRow>
                <V4PlanRow label="Fee">
                  {step.pool.fee} ({step.pool.fee / 10_000}%) | tick spacing {step.pool.tickSpacing}
                </V4PlanRow>
                <V4PlanRow label="Hook">{v4AddressLabel(chainId, step.pool.hook)}</V4PlanRow>
                <V4PlanRow label="Ticks">
                  {step.ticks.lower} → {step.ticks.upper}
                </V4PlanRow>
                <V4PlanRow label="Liquidity">{String(step.liquidity)}</V4PlanRow>
                <V4PlanRow label="Maximum in">{v4Amounts(step.maximumIn)}</V4PlanRow>
              </dl>
            );
          case "TAKE_PAIR":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Take both currencies")}
                <V4PlanRow label="Currency0">{v4AddressLabel(chainId, step.currency0)}</V4PlanRow>
                <V4PlanRow label="Currency1">{v4AddressLabel(chainId, step.currency1)}</V4PlanRow>
                <V4PlanRow label="Recipient">{v4AddressLabel(chainId, step.recipient)}</V4PlanRow>
              </dl>
            );
          case "CLOSE_CURRENCY":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Close currency — settle the net; leftovers return to the caller")}
                <V4PlanRow label="Currency">{v4AddressLabel(chainId, step.currency)}</V4PlanRow>
              </dl>
            );
          case "SWEEP":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Sweep — refund unused balance")}
                <V4PlanRow label="Currency">{v4AddressLabel(chainId, step.currency)}</V4PlanRow>
                <V4PlanRow label="Recipient">{v4AddressLabel(chainId, step.recipient)}</V4PlanRow>
              </dl>
            );
        }
      })}
      <p className="text-zinc-500">The exact bytes are in the raw payload below.</p>
    </div>
  );
}

/** Universal Router sentinels the direct-pay swap builders use. */
const UR_MSG_SENDER = "0x0000000000000000000000000000000000000001";
const UR_ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const UR_CONTRACT_BALANCE = 1n << 255n;

export type UrStep = { title: string; rows: [string, string][] };

function urRecipient(chainId: number, address: string): string {
  if (address.toLowerCase() === UR_MSG_SENDER) return "you (msg.sender)";
  if (address.toLowerCase() === UR_ADDRESS_THIS) return "the router (kept for the next step)";
  return v4AddressLabel(chainId, address);
}

function urAmount(value: bigint): string {
  if (value === UR_CONTRACT_BALANCE) return "the router's entire balance from the previous step";
  if (value === 0n) return "0 (the open amount from the previous step)";
  return value.toString();
}

/** A packed V3 path: 20-byte token, 3-byte fee, 20-byte token, … */
function urV3Path(chainId: number, path: string): string | null {
  const raw = path.slice(2);
  if (raw.length < 86 || (raw.length - 40) % 46 !== 0) return null;
  const parts: string[] = [v4AddressLabel(chainId, `0x${raw.slice(0, 40)}`)];
  for (let offset = 40; offset < raw.length; offset += 46) {
    const fee = parseInt(raw.slice(offset, offset + 6), 16);
    parts.push(
      `-${fee / 10_000}%→`,
      v4AddressLabel(chainId, `0x${raw.slice(offset + 6, offset + 46)}`),
    );
  }
  return parts.join(" ");
}

/** The V4_SWAP command's inner action plan (the shapes the pay builders emit). */
function urV4SwapSteps(chainId: number, input: Hex): UrStep[] | null {
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], input);
  const codes = actions.slice(2).match(/.{2}/g) ?? [];
  if (!codes.length || codes.length !== params.length) return null;
  const steps: UrStep[] = [];
  for (const [index, byte] of codes.entries()) {
    const data = params[index];
    switch (parseInt(byte, 16)) {
      case 0x06: {
        const [swap] = decodeAbiParameters(
          [
            {
              type: "tuple",
              components: [
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
                { type: "bool" },
                { type: "uint128" },
                { type: "uint128" },
                { type: "bytes" },
              ],
            },
          ],
          data,
        );
        const [key, zeroForOne, amountIn, minimumOut] = swap;
        const currencyIn = zeroForOne ? key[0] : key[1];
        const currencyOut = zeroForOne ? key[1] : key[0];
        steps.push({
          title: "Swap in the project's V4 pool (exact input)",
          rows: [
            ["Sell", v4AddressLabel(chainId, currencyIn)],
            ["Buy", v4AddressLabel(chainId, currencyOut)],
            ["Amount in", urAmount(amountIn)],
            ["Minimum out", `${minimumOut} — reverts below this`],
            ["Fee", `${key[2]} (${key[2] / 10_000}%) | tick spacing ${key[3]}`],
            ["Hook", v4AddressLabel(chainId, key[4])],
          ],
        });
        break;
      }
      case 0x0b: {
        const [currency, amount] = decodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
          data,
        );
        steps.push({
          title: "Pay the pool",
          rows: [
            ["Currency", v4AddressLabel(chainId, currency)],
            ["Amount", urAmount(amount)],
          ],
        });
        break;
      }
      case 0x0c: {
        const [currency, maximum] = decodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          data,
        );
        steps.push({
          title: "Pay the pool everything owed",
          rows: [
            ["Currency", v4AddressLabel(chainId, currency)],
            ["At most", maximum.toString()],
          ],
        });
        break;
      }
      case 0x0e: {
        const [currency, recipient, amount] = decodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "uint256" }],
          data,
        );
        steps.push({
          title: "Take the swap output",
          rows: [
            ["Currency", v4AddressLabel(chainId, currency)],
            ["Recipient", urRecipient(chainId, recipient)],
            ["Amount", urAmount(amount)],
          ],
        });
        break;
      }
      default:
        return null;
    }
  }
  return steps;
}

/**
 * Decode a Uniswap Universal Router `execute(commands, inputs, deadline)` into
 * readable steps. Covers only the command shapes the pay flow builds (Permit2
 * permit, wrap, V3 hop, unwrap, V4 swap); anything unrecognized falls back to
 * the raw argument view — a pretty rendering must never paper over bytes it
 * can't fully account for.
 */
export function describeUniversalRouterExecute(
  chainId: number,
  args: readonly unknown[] | undefined,
): UrStep[] | null {
  if (!args || args.length < 2) return null;
  const [commands, inputs] = args as [unknown, unknown];
  if (typeof commands !== "string" || !commands.startsWith("0x") || !Array.isArray(inputs)) {
    return null;
  }
  try {
    const codes = commands.slice(2).match(/.{2}/g) ?? [];
    if (!codes.length || codes.length !== inputs.length) return null;
    const steps: UrStep[] = [];
    for (const [index, byte] of codes.entries()) {
      const data = inputs[index] as Hex;
      switch (parseInt(byte, 16)) {
        case 0x00: {
          const [recipient, amountIn, minimumOut, path, payerIsUser] = decodeAbiParameters(
            [
              { type: "address" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "bytes" },
              { type: "bool" },
            ],
            data,
          );
          const route = urV3Path(chainId, path);
          if (!route) return null;
          steps.push({
            title: "Swap through a V3 pool (exact input)",
            rows: [
              ["Route", route],
              ["Amount in", urAmount(amountIn)],
              [
                "Minimum out",
                minimumOut === 0n
                  ? "0 — the final V4 minimum below is the real floor"
                  : minimumOut.toString(),
              ],
              ["Paid by", payerIsUser ? "you (via Permit2)" : "the router's balance"],
              ["Recipient", urRecipient(chainId, recipient)],
            ],
          });
          break;
        }
        case 0x0a: {
          const [permit] = decodeAbiParameters(
            [
              {
                type: "tuple",
                components: [
                  {
                    type: "tuple",
                    components: [
                      { type: "address" },
                      { type: "uint160" },
                      { type: "uint48" },
                      { type: "uint48" },
                    ],
                  },
                  { type: "address" },
                  { type: "uint256" },
                ],
              },
              { type: "bytes" },
            ],
            data,
          );
          const [details, spender, sigDeadline] = permit;
          steps.push({
            title: "Apply your signed Permit2 authorization",
            rows: [
              ["Token", v4AddressLabel(chainId, details[0])],
              ["Amount", details[1].toString()],
              ["Spender", v4AddressLabel(chainId, spender)],
              ["Expires", new Date(Number(details[2]) * 1000).toLocaleString()],
              ["Signature deadline", new Date(Number(sigDeadline) * 1000).toLocaleString()],
            ],
          });
          break;
        }
        case 0x0b: {
          const [recipient, amount] = decodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            data,
          );
          steps.push({
            title: "Wrap ETH into WETH",
            rows: [
              ["Amount", urAmount(amount)],
              ["Recipient", urRecipient(chainId, recipient)],
            ],
          });
          break;
        }
        case 0x0c: {
          const [recipient, minimum] = decodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            data,
          );
          steps.push({
            title: "Unwrap WETH back to ETH",
            rows: [
              ["Minimum", urAmount(minimum)],
              ["Recipient", urRecipient(chainId, recipient)],
            ],
          });
          break;
        }
        case 0x10: {
          const inner = urV4SwapSteps(chainId, data);
          if (!inner) return null;
          steps.push(...inner);
          break;
        }
        default:
          return null;
      }
    }
    return steps;
  } catch {
    return null;
  }
}

/** A decoded Universal Router plan in the same row grammar as everything else. */
function UrPlanView({ steps, deadline }: { steps: UrStep[]; deadline?: unknown }) {
  return (
    <div className="mt-3 space-y-3">
      {steps.map((step, index) => (
        <dl key={index} className="space-y-0.5">
          <p className="font-bold text-zinc-800">
            {index + 1}. {step.title}
          </p>
          {step.rows.map(([label, value]) => (
            <V4PlanRow key={label} label={label}>
              {value}
            </V4PlanRow>
          ))}
        </dl>
      ))}
      {deadline != null ? (
        <dl className="space-y-0.5">
          <V4PlanRow label="Deadline">
            {new Date(Number(deadline) * 1000).toLocaleString()}
          </V4PlanRow>
        </dl>
      ) : null}
      <p className="text-zinc-500">The exact bytes are in the raw payload below.</p>
    </div>
  );
}

// ── Precise decoders for the remaining opaque arguments ──────────────────────
// Every decoder is strict: it re-encodes what it decoded and compares bytes
// (or validates the full structure) before claiming an interpretation, and
// returns null on ANY mismatch so the raw argument view shows instead — a
// pretty rendering must never paper over bytes it can't fully account for.

export type PrettyStep = { title: string; rows: [string, string][] };

const bigintJson = (value: unknown) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));

/** Strict decode + byte-exact re-encode round trip, else null. */
function roundTripDecode<T extends readonly unknown[]>(
  types: Parameters<typeof decodeAbiParameters>[0],
  payload: Hex,
): T | null {
  try {
    const decoded = decodeAbiParameters(types, payload);
    const reencoded = encodeAbiParameters(types, decoded);
    if (reencoded.toLowerCase() !== payload.toLowerCase()) return null;
    return decoded as unknown as T;
  } catch {
    return null;
  }
}

// ── 1. JB hook metadata (JBMetadataResolver envelope) ────────────────────────

/**
 * Parse the JBMetadataResolver layout exactly as `getDataFor` reads it: a
 * 32-byte reserved word, a word-padded table of `(bytes4 id, uint8 wordOffset)`
 * entries, then word-aligned payload segments. Offsets must be strictly
 * increasing and the segments must tile the remainder of the bytes.
 */
function parseHookMetadataEnvelope(
  value: unknown,
): { reserved: Hex; entries: { id: Hex; payload: Hex }[] } | null {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(value)) return null;
  const body = value.slice(2).toLowerCase();
  if (body.length % 64 !== 0) return null;
  const totalWords = body.length / 64;
  if (totalWords < 3) return null; // reserved word + table word + ≥1 payload word
  const firstOffset = parseInt(body.slice(64 + 8, 64 + 10), 16);
  const tableWords = firstOffset - 1;
  if (tableWords < 1 || firstOffset >= totalWords) return null;
  const tableArea = body.slice(64, 64 + tableWords * 64);
  const entries: { id: Hex; offset: number }[] = [];
  let cursor = 0;
  while (cursor + 10 <= tableArea.length) {
    const chunk = tableArea.slice(cursor, cursor + 10);
    if (/^0+$/.test(chunk)) break;
    const id = chunk.slice(0, 8);
    const offset = parseInt(chunk.slice(8, 10), 16);
    if (/^0+$/.test(id)) return null; // a zero id with a nonzero offset is malformed
    entries.push({ id: `0x${id}`, offset });
    cursor += 10;
  }
  if (!entries.length) return null;
  // The rest of the table must be pure zero padding.
  if (!/^0*$/.test(tableArea.slice(cursor))) return null;
  // The declared entry count must be what sized the table.
  if (Math.ceil((entries.length * 5) / 32) !== tableWords) return null;
  // Offsets must ascend and the payloads must tile the remaining bytes exactly.
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].offset >= totalWords) return null;
    if (i > 0 && entries[i].offset <= entries[i - 1].offset) return null;
  }
  if (entries[0].offset !== firstOffset) return null;
  const segments = entries.map((entry, i) => {
    const start = entry.offset * 64;
    const end = i + 1 < entries.length ? entries[i + 1].offset * 64 : body.length;
    return { id: entry.id, payload: `0x${body.slice(start, end)}` as Hex };
  });
  return { reserved: `0x${body.slice(0, 64)}`, entries: segments };
}

/** Aggregate repeated tier ids into "2× #4" form, preserving first-seen order. */
function tierIdCounts(tierIds: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const id of tierIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => (count > 1 ? `${count}× #${id}` : `#${id}`))
    .join(", ");
}

/**
 * Decode a `pay`/`addToBalanceOf`/`cashOutTokensOf` `metadata` argument into
 * its hook entries, with typed interpretations for the payload shapes this
 * ecosystem's builders produce (721 mints/redeems, buyback routing).
 */
export function describeJBHookMetadata(
  context: "pay" | "cashOut",
  value: unknown,
): PrettyStep[] | null {
  const envelope = parseHookMetadataEnvelope(value);
  if (!envelope) return null;
  const steps: PrettyStep[] = [];
  if (!/^0x0+$/.test(envelope.reserved)) {
    steps.push({
      title: "Protocol-reserved word (nonzero)",
      rows: [["Value", envelope.reserved]],
    });
  }
  for (const entry of envelope.entries) {
    const payloadWords = (entry.payload.length - 2) / 64;
    const base: [string, string][] = [["Hook lookup id", entry.id]];
    // Collect EVERY known shape that byte-exactly round-trips. Exactly one
    // match is an interpretation; several (degenerate payloads like empty
    // arrays) are reported as ambiguous rather than picking one.
    const readings: PrettyStep[] = [];
    if (context === "pay") {
      const mint = roundTripDecode<readonly [boolean, readonly number[]]>(
        [{ type: "bool" }, { type: "uint16[]" }],
        entry.payload,
      );
      if (mint) {
        readings.push({
          title: "721 shop mint instructions",
          rows: [
            ...base,
            ["Tier IDs to mint", mint[1].length ? tierIdCounts(mint[1]) : "none (credits only)"],
            [
              "Allow overspending",
              mint[0] ? "yes — excess becomes pay credits" : "no — any excess reverts",
            ],
          ],
        });
      }
      if (payloadWords === 3) {
        const buyback = roundTripDecode<readonly [bigint, bigint, boolean]>(
          [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }],
          entry.payload,
        );
        if (buyback) {
          readings.push({
            title: "Buyback hook swap instructions",
            rows: [
              ...base,
              ["Amount to swap", buyback[0].toString()],
              ["Minimum swap output", `${buyback[1]} — reverts below this`],
              ["Skip splits on swapped tokens", buyback[2] ? "yes" : "no"],
            ],
          });
        }
      }
    } else {
      if (payloadWords === 2) {
        const buyback = roundTripDecode<readonly [bigint, boolean]>(
          [{ type: "uint256" }, { type: "bool" }],
          entry.payload,
        );
        if (buyback) {
          readings.push({
            title: "Buyback hook cash-out routing",
            rows: [
              ...base,
              ["Minimum swap output", buyback[0].toString()],
              [
                "Force the direct terminal path",
                buyback[1] ? "yes — never route through the pool" : "no",
              ],
            ],
          });
        }
      }
      const redeem = roundTripDecode<readonly [readonly bigint[]]>(
        [{ type: "uint256[]" }],
        entry.payload,
      );
      if (redeem) {
        readings.push({
          title: "721 shop items to redeem",
          rows: [
            ...base,
            ["Token IDs", redeem[0].length ? redeem[0].map((id) => `#${id}`).join(", ") : "none"],
          ],
        });
      }
    }
    if (readings.length === 1) {
      steps.push(readings[0]);
    } else if (readings.length > 1) {
      steps.push({
        title: "Payload matches multiple known shapes — verify against the raw bytes",
        rows: [
          ...base,
          ...readings.map(
            (reading, i) =>
              [
                `Reading ${i + 1}`,
                `${reading.title}: ${reading.rows
                  .slice(base.length)
                  .map(([label, val]) => `${label.toLowerCase()}: ${val}`)
                  .join("; ")}`,
              ] as [string, string],
          ),
        ],
      });
    } else {
      steps.push({
        title: `Unrecognized hook payload (${payloadWords} word${payloadWords === 1 ? "" : "s"})`,
        rows: [...base, ["Payload", entry.payload]],
      });
    }
  }
  return steps;
}

// ── 2. Sucker bridge claim ───────────────────────────────────────────────────

/** A bytes32 that is a left-padded address renders as the address. */
function paddedAddress(value: string): string {
  if (/^0x000000000000000000000000[0-9a-fA-F]{40}$/.test(value)) {
    return `0x${value.slice(26)}`;
  }
  return value;
}

export function describeSuckerClaim(chainId: number, value: unknown): PrettyStep[] | null {
  const claim = value as {
    token?: unknown;
    leaf?: {
      index?: unknown;
      beneficiary?: unknown;
      projectTokenCount?: unknown;
      terminalTokenAmount?: unknown;
      metadata?: unknown;
    };
    proof?: unknown;
  } | null;
  if (
    !claim ||
    typeof claim.token !== "string" ||
    !claim.leaf ||
    typeof claim.leaf.beneficiary !== "string" ||
    typeof claim.leaf.index !== "bigint" ||
    typeof claim.leaf.projectTokenCount !== "bigint" ||
    typeof claim.leaf.terminalTokenAmount !== "bigint" ||
    !Array.isArray(claim.proof) ||
    claim.proof.length !== 32 ||
    !claim.proof.every((hash) => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash))
  ) {
    return null;
  }
  const rows: [string, string][] = [
    ["Terminal token", v4AddressLabel(chainId, claim.token)],
    ["Leaf index", claim.leaf.index.toString()],
    ["Beneficiary", paddedAddress(claim.leaf.beneficiary)],
    ["Project tokens", claim.leaf.projectTokenCount.toString()],
    ["Terminal token amount", claim.leaf.terminalTokenAmount.toString()],
  ];
  if (typeof claim.leaf.metadata === "string" && !/^0x0+$/.test(claim.leaf.metadata)) {
    rows.push(["Leaf metadata", claim.leaf.metadata]);
  }
  rows.push(["Merkle proof", "32 hashes — exact bytes in the raw payload below"]);
  return [{ title: "Claim a bridged balance from the sucker's inbox tree", rows }];
}

// ── 3. Safe execTransaction inner call ───────────────────────────────────────

const SAFE_INNER_ABIS: { name: string; abi: Abi }[] = [
  { name: "JBController", abi: jbControllerAbi as Abi },
  { name: "JBMultiTerminal", abi: jbMultiTerminalAbi as Abi },
  { name: "JBDirectory", abi: jbDirectoryAbi as Abi },
  { name: "JBTokens", abi: jbTokensAbi as Abi },
  { name: "JBPermissions", abi: jbPermissionsAbi as Abi },
  { name: "JBSplits", abi: jbSplitsAbi as Abi },
  { name: "JBProjects", abi: jbProjectsAbi as Abi },
  { name: "ERC-20", abi: erc20Abi as Abi },
];

export function describeSafeInnerCall(value: unknown): PrettyStep[] | null {
  if (typeof value !== "string" || !value.startsWith("0x") || value.length < 10) return null;
  for (const candidate of SAFE_INNER_ABIS) {
    try {
      const decoded = decodeFunctionData({ abi: candidate.abi, data: value as Hex });
      const item = candidate.abi.find(
        (entry) => entry.type === "function" && entry.name === decoded.functionName,
      ) as AbiFunction | undefined;
      const rows: [string, string][] = (decoded.args ?? []).map((argument, index) => [
        item?.inputs[index]?.name || `argument ${index + 1}`,
        bigintJson(argument),
      ]);
      return [
        {
          title: `Queued call — ${candidate.name}.${decoded.functionName}(…)`,
          rows: rows.length ? rows : [["Arguments", "none"]],
        },
      ];
    } catch {
      // try the next candidate ABI
    }
  }
  return null;
}

// ── 4. Safe proxy initializer ────────────────────────────────────────────────

export function describeSafeInitializer(chainId: number, value: unknown): PrettyStep[] | null {
  if (typeof value !== "string" || !value.startsWith("0x")) return null;
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: safeSetupAbi, data: value as Hex }) as typeof decoded;
  } catch {
    return null;
  }
  if (decoded.functionName !== "setup" || !decoded.args) return null;
  // Reject noncanonical encodings so the summary can never disagree with the bytes.
  const canonical = encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: decoded.args as never,
  });
  if (canonical.toLowerCase() !== value.toLowerCase()) return null;
  const [owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver] =
    decoded.args as [readonly string[], bigint, string, string, string, string, bigint, string];
  const rows: [string, string][] = [
    ["Owners", owners.join(", ") || "none"],
    ["Threshold", `${threshold} of ${owners.length}`],
    ["Fallback handler", v4AddressLabel(chainId, fallbackHandler)],
  ];
  if (to.toLowerCase() === zeroAddress && data === "0x") {
    rows.push(["Setup hook", "none"]);
  } else {
    let hook = `DELEGATECALL to ${to} — data in the raw payload below`;
    try {
      const inner = decodeFunctionData({ abi: safeToL2SetupAbi, data: data as Hex });
      if (inner.functionName === "setupToL2" && inner.args) {
        const canonicalInner = encodeFunctionData({
          abi: safeToL2SetupAbi,
          functionName: "setupToL2",
          args: inner.args as never,
        });
        if (canonicalInner.toLowerCase() === data.toLowerCase()) {
          hook = `SafeToL2Setup.setupToL2(${String(inner.args[0])}) via ${to}`;
        }
      }
    } catch {
      // keep the generic delegatecall warning
    }
    rows.push(["Setup hook", hook]);
  }
  if (payment !== 0n || paymentToken.toLowerCase() !== zeroAddress) {
    rows.push([
      "Deployment payment",
      `${payment} of ${v4AddressLabel(chainId, paymentToken)} to ${paymentReceiver} — unusual, verify`,
    ]);
  }
  return [{ title: "Safe setup", rows }];
}

// ── 5. Permission grants ─────────────────────────────────────────────────────

const PERMISSION_NAME_BY_ID = new Map<number, string>(
  JBPermissionCatalogV6.map(({ key, id }) => [id, key]),
);

export function describePermissionsData(chainId: number, value: unknown): PrettyStep[] | null {
  const data = value as { operator?: unknown; projectId?: unknown; permissionIds?: unknown } | null;
  if (
    !data ||
    typeof data.operator !== "string" ||
    (typeof data.projectId !== "bigint" && typeof data.projectId !== "number") ||
    !Array.isArray(data.permissionIds) ||
    !data.permissionIds.every((id) => typeof id === "number" && Number.isInteger(id))
  ) {
    return null;
  }
  const projectId = BigInt(data.projectId);
  const names = (data.permissionIds as number[]).map((id) => {
    const name = PERMISSION_NAME_BY_ID.get(id);
    return name ? `${name} (${id})` : `UNKNOWN PERMISSION (${id})`;
  });
  const rows: [string, string][] = [
    ["Operator", v4AddressLabel(chainId, data.operator)],
    [
      "Scope",
      projectId === 0n
        ? "project 0 — EVERY project this account ever owns"
        : `project #${projectId}`,
    ],
    [
      "Permissions",
      names.length ? names.join(", ") : "none — revokes everything previously granted",
    ],
  ];
  if ((data.permissionIds as number[]).includes(1)) {
    rows.push(["Warning", "ROOT grants every permission across all Juicebox contracts"]);
  }
  return [{ title: "Set operator permissions", rows }];
}

// ── 6. Split groups ──────────────────────────────────────────────────────────

function splitPercent(percent: number): string {
  const share = (percent * 100) / Number(SPLITS_TOTAL_PERCENT);
  return `${Number(share.toFixed(4))}%`;
}

export function describeSplitGroups(chainId: number, value: unknown): PrettyStep[] | null {
  if (!Array.isArray(value)) return null;
  const steps: PrettyStep[] = [];
  for (const group of value as {
    groupId?: unknown;
    splits?: {
      percent?: unknown;
      projectId?: unknown;
      beneficiary?: unknown;
      preferAddToBalance?: unknown;
      lockedUntil?: unknown;
      hook?: unknown;
    }[];
  }[]) {
    if (typeof group?.groupId !== "bigint" || !Array.isArray(group.splits)) return null;
    const groupLabel =
      group.groupId === 1n
        ? "Reserved tokens"
        : group.groupId < 1n << 160n
          ? `Payouts of ${v4AddressLabel(chainId, `0x${group.groupId.toString(16).padStart(40, "0")}`)}`
          : `Group ${group.groupId}`;
    const rows: [string, string][] = [];
    let total = 0;
    for (const [index, split] of group.splits.entries()) {
      if (
        typeof split?.percent !== "number" ||
        typeof split.beneficiary !== "string" ||
        typeof split.projectId !== "bigint"
      ) {
        return null;
      }
      total += split.percent;
      const parts = [
        split.projectId !== 0n
          ? `project #${split.projectId} (beneficiary ${split.beneficiary})`
          : v4AddressLabel(chainId, split.beneficiary),
      ];
      if (typeof split.hook === "string" && split.hook.toLowerCase() !== zeroAddress) {
        parts.push(`via hook ${split.hook}`);
      }
      if (split.preferAddToBalance === true) parts.push("prefers add-to-balance");
      if (typeof split.lockedUntil === "number" && split.lockedUntil > 0) {
        parts.push(`locked until ${new Date(split.lockedUntil * 1000).toLocaleString()}`);
      }
      rows.push([`Split ${index + 1} — ${splitPercent(split.percent)}`, parts.join(" | ")]);
    }
    rows.push([
      "Total",
      `${splitPercent(total)}${total === Number(SPLITS_TOTAL_PERCENT) ? "" : " — the remainder follows the ruleset's default"}`,
    ]);
    steps.push({ title: groupLabel, rows: rows.length > 1 ? rows : [["Splits", "none"]] });
  }
  return steps.length ? steps : null;
}

/** Route an argument to its precise decoded view, or null for the raw default. */
function specialArgumentView(
  call: TransactionReviewCall,
  fn: AbiFunction,
  inputName: string,
  argumentIndex: number,
): React.ReactNode | null {
  const value = call.args?.[argumentIndex];
  if (fn.name === "modifyLiquidities" && inputName === "unlockData") {
    const steps = describeV4UnlockData(value);
    if (steps) return <V4PlanView steps={steps} chainId={call.chainId} />;
  }
  if ((fn.name === "pay" || fn.name === "addToBalanceOf") && inputName === "metadata") {
    const steps = describeJBHookMetadata("pay", value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  if (fn.name === "cashOutTokensOf" && inputName === "metadata") {
    const steps = describeJBHookMetadata("cashOut", value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  if (fn.name === "claim") {
    const steps = describeSuckerClaim(call.chainId, value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  if (fn.name === "execTransaction" && inputName === "data") {
    const steps = describeSafeInnerCall(value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  if (fn.name === "execTransaction" && inputName === "operation") {
    return (
      <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono">
        {value === 1 || value === 1n
          ? "1 — DELEGATECALL: runs foreign code with the Safe's own storage and funds"
          : value === 0 || value === 0n
            ? "0 — CALL"
            : String(value)}
      </pre>
    );
  }
  if (fn.name === "createProxyWithNonce" && inputName === "initializer") {
    const steps = describeSafeInitializer(call.chainId, value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  if (fn.name === "setPermissionsFor" && inputName === "permissionsData") {
    const steps = describePermissionsData(call.chainId, value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  if (fn.name === "setSplitGroupsOf" && inputName === "splitGroups") {
    const steps = describeSplitGroups(call.chainId, value);
    if (steps) return <UrPlanView steps={steps} />;
  }
  return null;
}

function functionOf(call: TransactionReviewCall): AbiFunction | null {
  if (!call.abi || !call.functionName) return null;
  const selector = call.data.slice(0, 10);
  return (
    (call.abi.find(
      (item) =>
        item.type === "function" &&
        item.name === call.functionName &&
        toFunctionSelector(item) === selector,
    ) as AbiFunction | undefined) ?? null
  );
}

function PrettyCall({
  call,
  index,
  total,
}: {
  call: TransactionReviewCall;
  index: number;
  total: number;
}) {
  const fn = functionOf(call);
  const contract = knownContract(call);
  const chain = JB_CHAINS[call.chainId as JBChainId];
  return (
    <ExactCallCard
      eyebrow={`${total > 1 ? `Call ${index + 1} of ${total}` : "Exact call"} | ${chain?.name ?? `Chain ${call.chainId}`} | ${call.chainId}`}
      destination={contract ? `${contract} | ${call.to}` : call.to}
      title={call.label ?? fn?.name ?? `Selector ${call.data.slice(0, 10)}`}
      raw={json({
        chainId: call.chainId,
        from: call.from,
        to: call.to,
        value: call.value ?? 0n,
        functionName: call.functionName,
        args: call.args,
        data: call.data,
      })}
      auditRequest={{ title: call.label ?? fn?.name, calls: [call] }}
    >
      <dl className="mt-2 space-y-1">
        {call.from ? <CallRow label="From">{call.from}</CallRow> : null}
        <CallRow label="Native value">
          {formatEther(call.value ?? 0n)} native | {(call.value ?? 0n).toString()} wei
        </CallRow>
        {call.safeTxGas !== undefined ? (
          <CallRow label="Safe transaction gas">
            {call.safeTxGas.toString()} (signed envelope)
          </CallRow>
        ) : null}
      </dl>
      {fn ? (
        <div className="mt-3 border-t border-melon-200 pt-2">
          <p className="text-zinc-500">Contract function</p>
          <p className="mt-1 break-all font-mono text-sm font-bold text-zinc-900">
            {fn.name}({fn.inputs.map((input) => input.type).join(", ")})
          </p>
          {(() => {
            if (fn.name === "execute") {
              const steps = describeUniversalRouterExecute(call.chainId, call.args);
              if (steps) return <UrPlanView steps={steps} deadline={call.args?.[2]} />;
            }
            return (
              <div className="mt-3 space-y-2">
                {fn.inputs.map((input, argumentIndex) => (
                  <div key={`${input.name}-${argumentIndex}`} className="bg-melon-25 p-3">
                    <p className="font-bold text-melon-800">
                      {input.name || `argument ${argumentIndex + 1}`}{" "}
                      <span className="font-normal">{input.type}</span>
                    </p>
                    {specialArgumentView(call, fn, input.name ?? "", argumentIndex) ?? (
                      <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono">
                        {prettyArgument(call, argumentIndex)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="mt-3 border border-peel-200 bg-peel-25 p-3 text-peel-800">
          ABI unavailable in this flow. Verify selector {call.data.slice(0, 10)} and complete
          calldata in Raw.
        </div>
      )}
    </ExactCallCard>
  );
}

function ReviewModal({
  pending,
  finish,
}: {
  pending: PendingReview;
  finish: (approved: boolean) => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const authorization = pending.request.kind === "authorization";
  // Callers assemble the description from optional fragments, so a blank string
  // means "nothing extra to say" and must fall back to the standing guidance
  // rather than render an empty banner.
  const description =
    pending.request.description?.trim() ||
    (authorization
      ? "This signature authorizes the exact typed data and resulting calls below; it does not itself prove those calls have executed."
      : "These are the exact app-controlled fields your wallet will be asked to send. Wallet-selected nonce and network fees are not shown.");

  // The review is the last thing opened before a wallet prompt. Transaction
  // starters close any summary dialog first, leaving this as the only active
  // confirmation surface.
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 border-melon-700 bg-melon-25 p-0 shadow-2xl max-h-[calc(100vh-1.5rem)] sm:w-[calc(100%-4rem)] sm:max-h-[calc(100vh-4rem)]"
      >
        <header className="flex items-start justify-between border-b border-melon-300 bg-melon-50 p-4 sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase text-amber-700">Transaction safety check</p>
            <DialogTitle className="mt-1 text-xl font-bold">
              {pending.request.title ??
                (authorization ? "Review authorization" : "Review transaction")}
            </DialogTitle>
          </div>
          <button
            type="button"
            className="border border-melon-500 px-3 py-1 text-sm"
            onClick={() => finish(false)}
            aria-label="Close review"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <p className="border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
            {description}
          </p>
          {/* Single-call requests carry the audit prompt and raw data on the
              card itself (the same chrome the pay flow uses); the request-wide
              versions only add value when there is more than one call. */}
          {pending.request.calls.length !== 1 ? (
            <button
              type="button"
              className="mt-4 border border-melon-600 bg-melon-100 px-4 py-2 text-xs font-bold hover:bg-melon-200"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    buildTransactionReviewPrompt(pending.request),
                  );
                  setCopyState("copied");
                } catch {
                  setCopyState("failed");
                }
                window.setTimeout(() => setCopyState("idle"), 2200);
              }}
            >
              {copyState === "copied"
                ? "Prompt copied — paste into your LLM"
                : copyState === "failed"
                  ? "Could not copy prompt"
                  : "[copy tx audit prompt]"}
            </button>
          ) : null}
          <div className="mt-4 space-y-4">
            {pending.request.calls.map((call, index) => (
              <PrettyCall
                key={`${call.chainId}:${call.to}:${index}`}
                call={call}
                index={index}
                total={pending.request.calls.length}
              />
            ))}
          </div>
          {pending.request.calls.length !== 1 ? (
            <details className="mt-4 border border-melon-300 bg-melon-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
                Raw transaction payload
              </summary>
              <pre className="max-h-96 overflow-auto border-t border-melon-300 bg-melon-950 p-4 text-[11px] leading-relaxed text-melon-25">
                {transactionReviewJson(pending.request)}
              </pre>
            </details>
          ) : null}
        </div>
        <footer className="border-t border-melon-300 bg-melon-50 p-4 sm:p-6">
          <label className="flex items-start gap-3 border border-melon-300 bg-melon-25 p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I reviewed the chain, destination, native value, calldata
              {authorization ? ", and exact authorization" : ""}. I agree to this exact payload.
            </span>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="border border-melon-600 px-5 py-2"
              onClick={() => finish(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!agreed}
              className="border border-melon-700 bg-melon-500 px-5 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => finish(true)}
            >
              {pending.request.confirmLabel ??
                (authorization ? "Agree & authorize" : "Agree & continue")}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function TransactionStatusCenter() {
  const activities = useTransactionActivities();
  useEffect(() => {
    activities
      .filter(
        (activity) =>
          activity.kind === "safe" && activity.status === "success" && !!activity.bundleUuid,
      )
      .forEach((activity) => {
        updateTransactionActivity(activity.id, {
          kind: "relayr-bundle",
          status: "pending",
          hash: activity.executionHash,
          safeProposalHash: activity.safeProposalHash ?? activity.hash,
          executionHash: undefined,
          message:
            "Safe executed the Relayr payment onchain. Destination transactions are now pending.",
        });
        void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined);
      });
  }, [activities]);
  if (!activities.length) return null;
  const active = activities.filter(
    (activity) =>
      activity.status === "submitted" ||
      activity.status === "pending" ||
      activity.status === "safe-proposed",
  );
  const terminal = activities.filter((activity) => !active.includes(activity));
  const visible = [...active, ...terminal.slice(0, 4)];
  return (
    <aside className="hidden" aria-label="Transaction status">
      {visible.map((activity) => (
        <div
          key={activity.id}
          className={`border bg-melon-25 p-3 shadow-lg ${activity.status === "failed" ? "border-peel-500" : activity.status === "success" ? "border-melon-500" : "border-melon-700"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-melon-700">
                {activity.status === "safe-proposed" ? "Safe proposal pending" : activity.status}
              </p>
              <p className="mt-1 text-sm font-bold">{activity.title}</p>
            </div>
            {activity.status === "success" || activity.status === "failed" ? (
              <button
                type="button"
                className="text-xs underline"
                onClick={() => dismissTransactionActivity(activity.id)}
              >
                Dismiss
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-melon-800">{activity.message}</p>
          {activity.status === "safe-proposed" &&
          activity.chainId &&
          activity.account &&
          SAFE_PREFIX[activity.chainId] ? (
            <a
              className="mt-2 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`https://app.safe.global/transactions/queue?safe=${SAFE_PREFIX[activity.chainId]}:${activity.account}`}
            >
              Open pending Safe proposal | {activity.safeProposalHash ?? activity.hash}
            </a>
          ) : activity.kind !== "safe" &&
            activity.hash &&
            activity.chainId &&
            explorerBaseUrl(activity.chainId) ? (
            <a
              className="mt-2 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`${explorerBaseUrl(activity.chainId)}/tx/${activity.hash}`}
            >
              View transaction | {activity.hash}
            </a>
          ) : activity.kind !== "safe" && activity.hash ? (
            <p className="mt-2 break-all font-mono text-[10px]">{activity.hash}</p>
          ) : null}
          {activity.executionHash && activity.chainId && explorerBaseUrl(activity.chainId) ? (
            <a
              className="mt-1 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`${explorerBaseUrl(activity.chainId)}/tx/${activity.executionHash}`}
            >
              Safe execution | {activity.executionHash}
            </a>
          ) : null}
          {activity.safeProposalHash &&
          activity.status !== "safe-proposed" &&
          activity.account &&
          activity.chainId &&
          SAFE_PREFIX[activity.chainId] ? (
            <a
              className="mt-1 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`https://app.safe.global/transactions/queue?safe=${SAFE_PREFIX[activity.chainId]}:${activity.account}`}
            >
              Safe proposal | {activity.safeProposalHash}
            </a>
          ) : null}
          {activity.bundleUuid ? (
            <p className="mt-1 break-all font-mono text-[10px]">Bundle {activity.bundleUuid}</p>
          ) : null}
          {activity.chainStates?.length ? (
            <div className="mt-2 space-y-1 border-t border-melon-200 pt-2 text-[10px]">
              {activity.chainStates.map((state, index) => (
                <div
                  key={`${state.chainId}:${index}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {JB_CHAINS[state.chainId as JBChainId]?.name ?? `Chain ${state.chainId}`}:{" "}
                    {state.status}
                  </span>
                  {state.hash && explorerBaseUrl(state.chainId) ? (
                    <a
                      href={`${explorerBaseUrl(state.chainId)}/tx/${state.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono underline"
                    >
                      {state.hash.slice(0, 8)}…{state.hash.slice(-6)}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {canCheckRelayrBundle(activity) ? (
            <button
              type="button"
              className="mt-2 text-xs font-bold underline"
              onClick={() => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined)}
            >
              Check Relayr bundle now
            </button>
          ) : null}
        </div>
      ))}
    </aside>
  );
}

function RelayrPaymentChoice({
  pending,
  finish,
}: {
  pending: PendingReview;
  finish: (approved: boolean) => void;
}) {
  const selection = pending.request.relayrPaymentSelection!;
  const [payment, setPayment] = useState(
    selection.payments.find((option) => option.chain === selection.preferredChainId) ?? null,
  );
  return (
    <Dialog open onOpenChange={(open) => !open && finish(false)}>
      <DialogContent>
        <DialogTitle>Choose where to pay Relayr</DialogTitle>
        <p className="text-sm text-melon-700">
          One payment funds the signed calls on every selected chain. You will review the exact
          payment before your wallet sends it.
        </p>
        <RelayrPaymentSelect
          payments={[...selection.payments]}
          tokenSymbol="ETH"
          selectedPayment={payment}
          onSelectPayment={setPayment}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button
            disabled={!payment}
            onClick={() => {
              if (!payment) return;
              selection.select(payment);
              finish(true);
            }}
          >
            Continue to payment review
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TransactionReviewProvider({ children }: PropsWithChildren) {
  const { address } = useAccount();
  const account = useRef(address);
  account.current = address;
  const activeRef = useRef<PendingReview | null>(null);
  const queued = useRef<PendingReview[]>([]);
  const nextId = useRef(1);
  const [active, setActive] = useState<PendingReview | null>(null);

  const enqueue = useCallback(
    (request: TransactionReviewRequest) =>
      new Promise<boolean>((resolve) => {
        const item: PendingReview = {
          id: nextId.current++,
          request: {
            ...request,
            calls: request.calls.map((call) => ({
              ...call,
              from: call.from ?? account.current,
              args: call.args ? [...call.args] : undefined,
            })),
          },
          resolve,
        };
        if (activeRef.current) queued.current.push(item);
        else {
          activeRef.current = item;
          setActive(item);
        }
      }),
    [],
  );

  useEffect(() => registerTransactionReviewHandler(enqueue), [enqueue]);
  useEffect(() => resumePendingRelayrBundles(), []);
  useEffect(() => resumeSafeProposalTracking(), []);
  useEffect(
    () => () => {
      activeRef.current?.resolve(false);
      queued.current.forEach((item) => item.resolve(false));
    },
    [],
  );

  const finish = useCallback((approved: boolean) => {
    const current = activeRef.current;
    if (!current) return;
    const next = queued.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
    current.resolve(approved);
  }, []);

  return (
    <>
      {children}
      <TransactionStatusCenter />
      {active?.request.relayrPaymentSelection ? (
        <RelayrPaymentChoice key={active.id} pending={active} finish={finish} />
      ) : active ? (
        <ReviewModal key={active.id} pending={active} finish={finish} />
      ) : null}
    </>
  );
}
