"use client";

import { submittedViaSafe } from "@/hooks/useReviewedWriteContract";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { erc20Abi, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { PERMIT2_ADDRESS, permit2AllowanceCovers, permit2ApprovalArgs } from "./lib";

export { SummaryRow } from "@/components/ui/TxConfirmDialog";

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

export type ApprovalContext = {
  chainId: JBChainId;
  address: Address;
  publicClient: PublicClient;
  ensureAllowance: (token: Address, spender: Address, amount: bigint) => Promise<unknown>;
  /** Send `Permit2.approve(args)` through the caller's reviewed write and return its hash. */
  approvePermit2: (args: ReturnType<typeof permit2ApprovalArgs>) => Promise<Hex>;
};

/**
 * Run one approval step. Permit2 allowances are re-checked rather than
 * trusted, since the review's reading can age out. A Safe connection turns
 * the Permit2 approval into a proposal that must execute before the flow can
 * continue, so that outcome is reported instead of waited on.
 */
export async function runApprovalStep(
  step: LiquidityStep,
  context: ApprovalContext,
): Promise<"done" | "safe-proposed"> {
  if (!step.approval) return "done";
  if (step.approval.kind === "erc20") {
    await context.ensureAllowance(step.approval.currency, PERMIT2_ADDRESS, step.approval.max);
    return "done";
  }
  const covered = await permit2AllowanceCovers(
    context.chainId,
    context.address,
    step.approval.currency,
    step.approval.max,
  );
  if (covered) return "done";
  const approvalHash = await context.approvePermit2(
    permit2ApprovalArgs(context.chainId, step.approval.currency, step.approval.max),
  );
  if (submittedViaSafe(approvalHash)) return "safe-proposed";
  const receipt = await waitForReceiptWithRetry(context.publicClient, approvalHash);
  if (receipt.status !== "success") {
    throw new Error(`Permit2 authorization ${approvalHash} reverted.`);
  }
  return "done";
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
