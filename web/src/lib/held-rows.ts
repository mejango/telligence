"use client";

import {
  hasSafeService,
  readSafeTransaction,
  SAFE_PROPOSAL_AWAITING,
  safeExecutionResult,
  usableSafeConfirmations,
  waitForSafeExecutionHash,
} from "@/lib/safe-service-config";
import type { ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  contractTransactionKey,
  recordTransactionActivity,
  refreshTransactionActivities,
  transactionActivityForHash,
  transactionActivitySnapshot,
  updateTransactionActivity,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { heldLineOf, holdInputOf, holdOf, storedHoldOf, type HoldInput } from "@/lib/write-hold";
import {
  HELD_RELEASED_LINE,
  SAFE_PROPOSAL_EXECUTED_LINE,
  SAFE_PROPOSAL_REPLACED_LINE,
  settledLine,
  WRITE_HOLD_REVERTED_LINE,
  WRITE_HOLD_SAFE_UNPROVEN_LINE,
  type HeldWriteView,
  type ReviewedCall,
} from "@bananapus/nana-sdk-core/review";
import { readAuthorityIdentity } from "@bananapus/nana-sdk-core/safe";
import type { Address, Hex, PublicClient } from "viem";
import type { Config } from "wagmi";
import { getPublicClient } from "wagmi/actions";

/**
 * What a Safe proposal's row shows of its SDK view: the view's own line in every phase. A
 * success the hold settled names the execution; one whose caller verifies its exact result waits
 * for that caller.
 */
export function showSafeView(id: string, view: HeldWriteView, client?: PublicClient): void {
  const row = refreshTransactionActivities().find((activity) => activity.id === id);
  if (!row) return;
  shownPhase.set(id, view.phase);
  if (view.phase === "awaiting" || view.phase === "confirming" || view.phase === "held") {
    updateTransactionActivity(id, {
      status: "safe-proposed",
      sdkHeld: true,
      message: (view.phase === "awaiting" && approvalLines.get(id)) || heldLineOf(view),
      safeResultUnconfirmed: view.exit || undefined,
    });
    if (view.phase === "awaiting" && client) void showApprovals(row, client);
    return;
  }
  if (view.phase === "settled" && view.settled) {
    const executionHash = "hash" in view.settled ? view.settled.hash : undefined;
    const verify = view.settled.result === "success" && row.manualVerificationRequired;
    updateTransactionActivity(id, {
      status: verify ? "pending" : view.settled.result === "success" ? "success" : "failed",
      executionHash,
      safeResultUnconfirmed: undefined,
      message: verify
        ? "Your Safe ran this. Resume the saved batch to finish checking it."
        : settledLine(view.settled),
    });
    return;
  }
  if (view.phase === "released")
    updateTransactionActivity(id, {
      status: "failed",
      safeResultUnconfirmed: undefined,
      message: view.line ?? undefined,
    });
}

/** The phase each Safe row last showed, and its approvals line while it awaits its signers. */
const shownPhase = new Map<string, HeldWriteView["phase"]>();
const approvalLines = new Map<string, string>();
const approvalsReadAt = new Map<string, number>();
/** A row's approvals are read from Safe's service at most this often. */
const APPROVALS_REREAD_MS = 60_000;

/**
 * While a proposal awaits its signers, how many of the Safe's current owners approved it, from
 * Safe's service: domain information the hold's own line doesn't carry. Only well-formed
 * confirmations of current owners count.
 */
async function showApprovals(row: TransactionActivity, client: PublicClient): Promise<void> {
  const { id, hash, chainId } = row;
  const safe = row.safeProposal?.safe ?? row.account;
  if (!hash || !chainId || !safe || !hasSafeService(chainId)) return;
  if (Date.now() - (approvalsReadAt.get(id) ?? 0) < APPROVALS_REREAD_MS) return;
  approvalsReadAt.set(id, Date.now());
  try {
    const [proposal, identity] = await Promise.all([
      readSafeTransaction(chainId, safe, hash),
      readAuthorityIdentity(client, safe).catch(() => null),
    ]);
    if (proposal.isExecuted) return;
    const approvals =
      identity?.kind === "safe"
        ? `: ${usableSafeConfirmations(proposal, identity.owners).length} of ${identity.threshold}`
        : "";
    const line = `Waiting for your Safe's approvals${approvals}.`;
    approvalLines.set(id, line);
    if (shownPhase.get(id) === "awaiting") updateTransactionActivity(id, { message: line });
  } catch {
    // Safe's service can't say: the hold's own line stays.
  }
}

/**
 * A proposal journaled without its reviewed calls, which no hold can hold, settles from the chain
 * as on main: its execution (Safe's reply when it executed at once, or Safe's service's record),
 * then the Safe's own execution event in that receipt. Anything it can't prove leaves it
 * unconfirmed, for its account to dismiss.
 */
async function settleUnheldProposal(row: TransactionActivity, client: PublicClient) {
  const { id, hash, chainId } = row;
  const safe = row.account;
  if (!hash || !chainId || !safe) return;
  try {
    const executionHash = await waitForSafeExecutionHash(chainId, hash, { client });
    const receipt = await waitForReceiptWithRetry(client, executionHash);
    if (receipt.transactionHash?.toLowerCase() !== executionHash.toLowerCase()) return;
    const result = safeExecutionResult(receipt, safe, hash);
    if (result.status === "unproven") return;
    updateTransactionActivity(id, {
      status: result.status === "success" ? "success" : "failed",
      executionHash,
      safeResultUnconfirmed: undefined,
      message: result.status === "success" ? SAFE_PROPOSAL_EXECUTED_LINE : WRITE_HOLD_REVERTED_LINE,
    });
  } catch {
    // Not proven: it stays unconfirmed.
  }
}

/**
 * Whether the hold follows `row` (HeldRowFollowers): a Safe proposal with its reviewed calls that
 * may still run, and an earlier build's proposal another transaction replaced, which may have run.
 */
export function followedRow(row: TransactionActivity): boolean {
  return followedSafeRow(row) || followedDirectRow(row);
}

/**
 * A direct write sent under the hold, followed until its held write told its result (so the next
 * send of the same action goes straight on), whatever screen sent it.
 */
function followedDirectRow(row: TransactionActivity): boolean {
  if (row.kind !== "direct" || !row.directHold || !row.hash) return false;
  if (row.status === "submitted" || row.status === "pending") return true;
  const input = holdInputOf(row);
  if (!input) return false;
  const now = holdOf(input).peek();
  return (
    now.status !== "clear" ||
    (!!now.settled &&
      "hash" in now.settled &&
      !now.settled.acknowledged &&
      now.settled.hash.toLowerCase() === row.hash.toLowerCase())
  );
}

function followedSafeRow(row: TransactionActivity): boolean {
  if (row.kind !== "safe" || !row.hash || !row.chainId || !row.safeProposal) return false;
  const replaced =
    !row.sdkHeld && row.status === "failed" && row.message === SAFE_PROPOSAL_REPLACED_LINE;
  return row.status === "safe-proposed" || replaced;
}

/**
 * On load, a proposal journaled without its reviewed calls, which no hold can hold, shows it can't
 * be confirmed here and settles from the chain as on main. Every other proposal is the hold's
 * (HeldRowFollowers).
 */
export function resumeSafeProposalTracking(config: Config): void {
  for (const row of transactionActivitySnapshot()) {
    if (row.kind !== "safe" || row.status !== "safe-proposed" || !row.hash || !row.chainId)
      continue;
    if (row.safeProposal) continue;
    updateTransactionActivity(row.id, {
      message: WRITE_HOLD_SAFE_UNPROVEN_LINE,
      safeResultUnconfirmed: true,
    });
    const client = getPublicClient(config, { chainId: row.chainId }) as PublicClient | undefined;
    if (client) void settleUnheldProposal(row, client);
  }
}

/** The namespaces an earlier build held a reviewed call by, as its hold names them. */
function legacyNamespacesOf(call: ReviewedCall): string[] {
  return (call.legacy ?? []).filter((key): key is string => typeof key === "string");
}

/** The hold core keeps a reviewed call under, as a row keeps it. */
function holdInputFor(call: ReviewedCall, account: Address, safe: boolean): HoldInput {
  return {
    chainId: call.chainId,
    account,
    safe,
    call: { to: call.to, data: call.data, value: call.value ?? 0n },
    ...(call.intent ? { namespace: call.intent, legacy: [...(call.legacy ?? [])] } : {}),
  };
}

/** A reviewed call's key in the journal: its account, chain and exact call. */
export function reviewedCallKey(account: Address, call: ReviewedCall): string {
  return contractTransactionKey(account, call.chainId, {
    address: call.to,
    value: call.value,
    data: call.data,
  });
}

/**
 * Journal a reviewed call core sent, so the account page shows it and HeldRowFollowers follows it
 * through reloads: a direct write as pending until its run (or its hold) tells its result, a Safe
 * proposal as the hold's from its send. A new proposal retires the rows of the call's earlier ones.
 */
export function recordSubmittedWrite(
  call: ReviewedCall,
  hash: Hex,
  account: Address,
  title: string,
  safe: boolean,
  /** Every call of a Safe batch `call` heads, proposed as one transaction. */
  batch?: readonly ReviewedCall[],
): string {
  const id = `tx:${call.chainId}:${hash.toLowerCase()}`;
  const callKey = reviewedCallKey(account, call);
  if (safe)
    for (const row of refreshTransactionActivities())
      if (row.callKey === callKey && row.status === "safe-proposed")
        updateTransactionActivity(row.id, {
          status: "failed",
          safeResultUnconfirmed: undefined,
          message: HELD_RELEASED_LINE,
        });
  const legacyNamespaces = legacyNamespacesOf(call);
  const proposal: ReviewedSafeProposal | undefined = safe
    ? {
        safe: account,
        calls: (batch ?? [call]).map((sent) => ({
          to: sent.to,
          value: String(sent.value ?? 0n),
          data: sent.data,
        })),
        batch: !!batch,
        ...(call.intent ? { holdNamespace: call.intent } : {}),
        ...(legacyNamespaces.length ? { legacyNamespaces } : {}),
      }
    : undefined;
  recordTransactionActivity({
    id,
    kind: safe ? "safe" : "direct",
    title,
    status: safe ? "safe-proposed" : "pending",
    message: safe ? SAFE_PROPOSAL_AWAITING : "Pending onchain confirmation.",
    chainId: call.chainId,
    account,
    hash,
    safeProposalHash: safe ? hash : undefined,
    safeProposal: proposal,
    sdkHeld: safe || undefined,
    ...(safe ? {} : { directHold: storedHoldOf(holdInputFor(call, account, false)) }),
    callKey,
  });
  return id;
}

/** A recorded direct write's end, as its run saw it. */
export function settleSubmittedWrite(id: string, result: "success" | "failed"): void {
  updateTransactionActivity(id, {
    status: result,
    message:
      result === "success"
        ? "Confirmed onchain."
        : "The transaction was mined but reverted. Its intended state changes did not occur.",
  });
}

/** Whether `hash` is a Safe proposal the journal still shows awaiting its Safe. */
export function submittedViaSafe(hash?: Hex): boolean {
  return transactionActivityForHash(hash)?.status === "safe-proposed";
}

/**
 * Journal a Safe proposal the connected wallet signed for a Safe it co-signs. Not sent under the
 * hold, so the row's follower adopts it into the hold and follows it to its result.
 */
export function recordSafeProposal(
  hash: Hex,
  chainId: number,
  title: string,
  account: Address,
  callKey: string,
  proposal: ReviewedSafeProposal,
): void {
  recordTransactionActivity({
    id: `tx:${chainId}:${hash.toLowerCase()}`,
    kind: "safe",
    title,
    status: "safe-proposed",
    message: SAFE_PROPOSAL_AWAITING,
    chainId,
    account,
    hash,
    safeProposalHash: hash,
    safeProposal: proposal,
    callKey,
  });
}
