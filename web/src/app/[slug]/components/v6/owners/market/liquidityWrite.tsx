"use client";

import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { legacyBatchNamespace } from "@/lib/legacy-intents";
import { reviewedCall, type WriteRequest } from "@/lib/reviewed-call";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { approvalIntent, type ReviewedCall } from "@bananapus/nana-sdk-core/review";
import { erc20Abi, parseUnits, type Abi, type Address, type Hex, type PublicClient } from "viem";
import {
  lpDeadline,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  permit2AllowanceCovers,
  permit2ApprovalArgs,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
} from "./lib";

/**
 * A wallet prompt a liquidity write will actually raise. Deciding the sequence
 * while reviewing — not while executing — is what lets the signer see the
 * whole queue before the first prompt, and keeps the list from naming
 * approvals it skips.
 */
export type LiquidityStep = {
  title: string;
  detail: string;
  approval?: { kind: "erc20" | "permit2"; currency: Address; max: bigint };
};

/**
 * The approvals a plan's ERC-20 sides still need: the token's allowance to
 * Permit2, then Permit2's capped, expiring allowance to the position manager.
 * Each is checked live so the list never names a step the wallet already
 * granted.
 */
export async function approvalStepsFor({
  publicClient,
  chainId,
  address,
  erc20Sides,
  symbolOf,
}: {
  publicClient: PublicClient;
  chainId: JBChainId;
  address: Address;
  erc20Sides: ReadonlyArray<{ currency: Address; max: bigint }>;
  symbolOf: (currency: Address) => string;
}): Promise<LiquidityStep[]> {
  const steps: LiquidityStep[] = [];
  for (const side of erc20Sides) {
    const symbol = symbolOf(side.currency);
    const allowance = await publicClient.readContract({
      address: side.currency,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, PERMIT2_ADDRESS],
    });
    if (allowance < side.max) {
      steps.push({
        title: `Approve ${symbol} access`,
        detail: `Permit2 is what moves your ${symbol} into the pool.`,
        approval: { kind: "erc20", currency: side.currency, max: side.max },
      });
    }
    if (!(await permit2AllowanceCovers(chainId, address, side.currency, side.max))) {
      steps.push({
        title: `Authorize the Uniswap position manager for ${symbol}`,
        detail: `A capped, expiring ${symbol} allowance — not an open-ended one.`,
        approval: { kind: "permit2", currency: side.currency, max: side.max },
      });
    }
  }
  return steps;
}

export type LiquidityBatchCall = Omit<WriteRequest, "chainId" | "abi"> & {
  abi: Abi;
  /** Needs an earlier call's effect (an allowance), so it cannot simulate alone. */
  dependsOnPrior?: boolean;
};

/**
 * The reviewed step list as ONE Safe batch: each approval becomes its call,
 * and the position-manager write comes last, marked as depending on them so
 * a standalone simulation never runs it before its allowances exist.
 */
export function liquidityBatchCalls({
  chainId,
  steps,
  unlockData,
  value,
  safe = true,
}: {
  chainId: JBChainId;
  steps: readonly LiquidityStep[];
  unlockData: Hex;
  value: bigint;
  /** A Safe's proposal waits for its signers, so it gets the long deadline. */
  safe?: boolean;
}): LiquidityBatchCall[] {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(chainId)];
  if (!positionManager) throw new Error("LP management is unavailable on this chain.");
  return steps.map((step) =>
    step.approval?.kind === "erc20"
      ? {
          address: step.approval.currency,
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [PERMIT2_ADDRESS, step.approval.max],
        }
      : step.approval
        ? {
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ABI,
            functionName: "approve",
            args: permit2ApprovalArgs(chainId, step.approval.currency, step.approval.max),
          }
        : {
            address: positionManager,
            abi: POSITION_MANAGER_ABI,
            functionName: "modifyLiquidities",
            args: [unlockData, lpDeadline(safe)],
            value,
            dependsOnPrior: true,
          },
  );
}

/**
 * The reviewed step list as one reviewed action of `lpIntent`: each approval held as a step of it
 * (the SDK's approvalIntent; the plan's calculated maxima are not part of it), then the
 * position-manager write. Everything that touches funds is frozen inside unlockData; the deadline
 * is stamped when the review opens. Sent with `batch`, a Safe proposes them as one transaction,
 * held by the first call's intent, so that call carries `lpIntent` (and the batch namespace the
 * build before held every batch by).
 */
export function liquidityReviewedCalls(
  lpIntent: string,
  input: Parameters<typeof liquidityBatchCalls>[0],
): ReviewedCall[] {
  const writes = liquidityBatchCalls(input);
  const batch = input.safe && writes.length > 1;
  return writes.map(({ dependsOnPrior, ...call }, index) =>
    reviewedCall(
      { chainId: input.chainId, ...call },
      batch && index === 0
        ? { intent: lpIntent, legacyIntents: [legacyBatchNamespace(writes)] }
        : {
            dependsOnPrior: index > 0 && !!dependsOnPrior,
            intent:
              call.functionName === "modifyLiquidities"
                ? lpIntent
                : approvalIntent(lpIntent, {
                    step: call.address === PERMIT2_ADDRESS ? "permit2" : "erc20",
                    token: (call.address === PERMIT2_ADDRESS
                      ? call.args![0]
                      : call.address) as Address,
                    spender: call.args![call.address === PERMIT2_ADDRESS ? 1 : 0] as Address,
                  }),
          },
    ),
  );
}

/** The confirm's intro line when the whole step list goes to a Safe at once. */
export function safeBatchIntro(steps: readonly unknown[]): string {
  return `Goes to your Safe as one batch of ${steps.length} calls: approved once, executed together.`;
}

/** A typed amount as raw units; "" is zero, anything unparsable names the side. */
export function parseAmountText(text: string, decimals: number, symbol: string): bigint {
  const trimmed = text.trim();
  if (trimmed === "") return 0n;
  try {
    const amount = parseUnits(trimmed, decimals);
    if (amount < 0n) throw new Error();
    return amount;
  } catch {
    throw new Error(`Enter a valid ${symbol} amount.`);
  }
}
