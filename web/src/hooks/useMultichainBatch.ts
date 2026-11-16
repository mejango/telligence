"use client";

import { useReviewedAction } from "@/hooks/useReviewedAction";
import {
  forwardedRequestGas,
  hasRelayrRecoveryScopeSession,
  isReleasedUnpaidRelayrBundle,
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import { activityJournal } from "@/lib/activity-journal";
import { mapConcurrentChecks } from "@/lib/concurrent-checks";
import { fence, type TabLocks } from "@/lib/fence";
import {
  batchCallKey,
  batchCallScope,
  createMultichainBatch,
  findPendingBatch,
  hasUntouchedRoutingCalls,
  isBatchCallHandled,
  isReplaceableRoutingDraft,
  isUnconfirmedRoutingBatch,
  readMultichainBatches,
  removeUnsubmittedBatch,
  replaceRoutingDraft,
  resetUnpaidRoutingDraft,
  routingBatchRecoveryReason,
  saveMultichainBatch,
  type FrozenBatchCall,
  type MultichainBatch,
  type MultichainCall,
} from "@/lib/multichain-batch";
import {
  readRouterPendingAdvance,
  verifyActionReceipt,
  verifyCallPreconditions,
} from "@/lib/multichain-guards";
import type { JBChainId } from "@/lib/nana/types";
import {
  describeSavedRoutingCall,
  findPendingRoutingBatch,
  type PendingProject,
} from "@/lib/pending-router-calls";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import { requireDone, reviewedCall, ReviewRefusal } from "@/lib/reviewed-call";
import { loadEngine, reviewedSendDeps, WALLET_CHANGED } from "@/lib/reviewed-send-deps";
import { isSafeConnection } from "@/lib/safe-connector";
import {
  readSafeTransaction,
  SAFE_EXEC_ABI,
  safeExecutionResult,
  safeTransactionMessage,
} from "@/lib/safe-service-config";
import { safeTransactionRunsCalls } from "@/lib/safe-transactions";
import {
  contractTransactionKey,
  refreshTransactionActivities,
  requireTransactionActivityPersistence,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import { chooseRelayrPayment } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { jbContractAddress } from "@bananapus/nana-sdk-core";
import {
  browserLocks,
  discardReviewedSequence,
  findReviewedSequence,
  gasWithHeadroom,
  type ReviewContextRow,
  type ReviewedPlan,
} from "@bananapus/nana-sdk-core/review";
import { relayrDestinationHash } from "@bananapus/nana-sdk-core/review/relayr";
import { useCallback, useState } from "react";
import {
  decodeFunctionData,
  isAddressEqual,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

export type BatchResult = {
  status: "success" | "pending";
  hashes: Array<{ chainId: number; hash: Hash; callIndex: number }>;
  revertedHashes?: Array<{ chainId: number; hash: Hash; callIndex: number }>;
  obsoleteSafeProposals?: Array<{
    chainId: number;
    safe: Address;
    hash: Hash;
    nonce: number;
    callIndex: number;
  }>;
};
export type BatchCallProgress = {
  status: "pending" | "submitted" | "confirmed" | "reverted" | "skipped";
  hash?: Hash;
};

/** A call's gas as Relayr runs it: the call's own bound, or its estimate with headroom. */
async function callGas(
  client: { estimateContractGas: PublicClient["estimateContractGas"] },
  account: Address,
  call: FrozenBatchCall,
): Promise<bigint> {
  return (
    call.gas ??
    gasWithHeadroom(
      await client.estimateContractGas({
        account,
        address: call.address,
        abi: call.abi,
        functionName: call.functionName,
        args: call.args,
        value: call.value,
      }),
    )
  );
}

function callProgress(call: FrozenBatchCall): BatchCallProgress {
  return {
    status:
      call.state === "success"
        ? "confirmed"
        : call.state === "reverted" || call.state === "skipped"
          ? call.state
          : call.hash
            ? "submitted"
            : "pending",
    hash: call.hash,
  };
}

type BatchInput = {
  label: string;
  /** What the batch does, shown first in its review. */
  context?: readonly ReviewContextRow[];
  scope: string;
  calls: MultichainCall[];
  replaceDraftId?: string;
  /** The exact hashless routing selection superseded by the normal fresh review. */
  refreshBatchId?: string;
  expectedBatchId?: string;
  /** Stops preparation; an in-flight wallet submission still requires reconciliation. */
  signal?: AbortSignal;
  onBeforePayment?: () => void;
  onProgress?: (message: string) => void;
  /** Display-only snapshots in the frozen call order; never execution authority. */
  onCallProgress?: (calls: readonly BatchCallProgress[]) => void;
};
const running = new Set<string>();

function canRefreshRoutingBatch(batch: MultichainBatch): boolean {
  if (!isUnconfirmedRoutingBatch(batch)) return false;
  try {
    requireTransactionActivityPersistence();
    const activities = refreshTransactionActivities();
    return batch.calls.every((call, index) => {
      describeSavedRoutingCall(call);
      const key = contractTransactionKey(batch.account, call.chainId, call);
      return (
        !activities.some(
          (activity) =>
            activity.callKey === key &&
            (activity.hash || activity.executionHash || activity.safeProposalHash) &&
            // A verified earlier attempt can legitimately leave the same payment pending.
            !(
              (activity.status === "success" || activity.status === "failed") &&
              activity.manualVerificationRequired === false &&
              activity.updatedAt < batch.createdAt
            ),
        ) && !hasRelayrRecoveryScopeSession(batch.account, batchCallScope(batch, call, index))
      );
    });
  } catch {
    return false;
  }
}

/** The one call a saved batch call proposes to its Safe. */
function savedCall(call: FrozenBatchCall) {
  return { to: call.address, value: call.value ?? 0n, data: call.data };
}

async function verifyDirectResult(
  client: PublicClient,
  batch: MultichainBatch,
  call: FrozenBatchCall,
  /** The batch lock its result's row is written under. */
  locks: TabLocks,
): Promise<
  | { hash: Hash; state: "success" | "reverted" }
  | {
      hash: Hash;
      state: "skipped";
      skipReason: "obsolete-safe";
      safeNonce: number;
    }
> {
  let hash = call.hash!;
  const safe = call.state === "safe";
  if (safe) {
    const activity = refreshTransactionActivities().find(
      (row) =>
        row.safeProposalHash?.toLowerCase() === call.hash?.toLowerCase() &&
        row.chainId === call.chainId,
    );
    if (!activity?.executionHash) {
      if (
        activity &&
        call.expectedRouterPending &&
        (await readRouterPendingAdvance(client, call.expectedRouterPending, call.preconditions)) ===
          "resolved-externally"
      ) {
        // The service's record of the proposal, authenticated against its hash.
        const record = await readSafeTransaction(call.chainId, batch.account, call.hash!);
        const proposal = safeTransactionMessage(record);
        if (
          // The service writes a nonce as a JSON number; any other form is refused.
          typeof record.nonce !== "number" ||
          !safeTransactionRunsCalls(proposal, [savedCall(call)], false)
        )
          throw new Error(
            "The authenticated Safe proposal does not match this exact routing call.",
          );
        if (
          (await readRouterPendingAdvance(
            client,
            call.expectedRouterPending,
            call.preconditions,
          )) !== "resolved-externally"
        )
          throw new Error(
            "The payment is pending again. Keep the original Safe proposal for reconciliation.",
          );
        const safeNonce = Number(proposal.nonce);
        await activityJournal(locks).update(activity.id, {
          status: "failed",
          manualVerificationRequired: false,
          obsoleteSafeNonce: safeNonce,
          message: `Payment resolved elsewhere. Safe proposal ${call.hash} is obsolete, not verified executed. Cancel or replace nonce ${safeNonce} in Safe if it blocks the queue.`,
        });
        return { hash, state: "skipped", skipReason: "obsolete-safe", safeNonce };
      }
      throw new Error(
        "The saved Safe proposal still needs approvals and execution. Resume after it executes; do not propose it again.",
      );
    }
    hash = activity.executionHash;
  }
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    transaction.hash.toLowerCase() !== hash.toLowerCase() ||
    block.hash !== receipt.blockHash ||
    transaction.blockHash !== receipt.blockHash ||
    transaction.blockNumber !== receipt.blockNumber
  )
    throw new Error(
      "The saved transaction has no canonical successful receipt. Keep it for reconciliation; do not replay it.",
    );
  if (safe) {
    const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: transaction.input });
    if (
      !transaction.to ||
      !isAddressEqual(transaction.to, batch.account) ||
      decoded.functionName !== "execTransaction" ||
      !safeTransactionRunsCalls(
        {
          to: decoded.args[0],
          value: decoded.args[1],
          data: decoded.args[2],
          operation: decoded.args[3],
        },
        [savedCall(call)],
        false,
      )
    )
      throw new Error("The Safe execution does not match the saved destination call.");
    // Over WalletConnect, Safe{Wallet} replies with the execution itself when
    // the owner executes at once: the SDK then reads the Safe's one execution
    // event in that receipt, whose execTransaction was checked above.
    if (safeExecutionResult(receipt, batch.account, call.hash!).status !== "success")
      throw new Error("The exact Safe proposal has not executed successfully.");
  } else if (
    !transaction.to ||
    !isAddressEqual(transaction.to, call.address) ||
    !isAddressEqual(transaction.from, batch.account) ||
    transaction.input.toLowerCase() !== call.data.toLowerCase() ||
    transaction.value !== (call.value ?? 0n)
  )
    throw new Error("The saved transaction does not match the exact reviewed call.");
  if (receipt.status !== "success") {
    if (!safe && call.expectedRouterPending && receipt.status === "reverted") {
      await activityJournal(locks).update(`tx:${call.chainId}:${call.hash!.toLowerCase()}`, {
        status: "failed",
        manualVerificationRequired: false,
        message:
          "The exact routing transaction reverted. No routing changes from this attempt took effect. Refresh the payment and prepare a new review to try again.",
      });
      return { hash, state: "reverted" };
    }
    throw new Error(
      "The saved transaction has no canonical successful receipt. Keep it for reconciliation; do not replay it.",
    );
  }
  const routerResult = await verifyActionReceipt(
    client,
    receipt,
    call.address,
    call.expectedDeployment,
    call.rejectEvents,
    call.reservedReceipt,
    call.expectedPayout,
    call.expectedRouterPending,
  );
  await activityJournal(locks).update(`tx:${call.chainId}:${call.hash!.toLowerCase()}`, {
    status: "success",
    manualVerificationRequired: false,
    executionHash: safe ? hash : undefined,
    message:
      routerResult === "pending"
        ? "The routing attempt was verified. The payment remains in gateway custody awaiting another attempt."
        : "The exact transaction and every required recipient result were verified.",
  });
  return { hash, state: "success" };
}

/** One frozen job, explicit rounds, one payment per independent multichain round. */
/** The plan's key for one Relayr round of a batch. */
const roundKey = (roundIndex: number) => `round:${roundIndex}`;

export function useMultichainBatch() {
  const config = useConfig();
  const [isPending, setIsPending] = useState(false);
  const { getRelayrTxQuote } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const { run } = useReviewedAction();
  const getPendingBatch = useCallback(
    (scope: string, routingDestinations?: readonly PendingProject[]) => {
      const account = getAccount(config).address;
      if (!account) return undefined;
      const batch = routingDestinations
        ? findPendingRoutingBatch(account, routingDestinations)
        : findPendingBatch(account, scope);
      return batch
        ? {
            id: batch.id,
            calls: batch.calls,
            recoveryReason: routingBatchRecoveryReason(batch),
            refreshable: canRefreshRoutingBatch(batch),
            replaceableDraft:
              isReplaceableRoutingDraft(batch) &&
              batch.calls.every(
                (call, index) =>
                  !hasRelayrRecoveryScopeSession(account, batchCallScope(batch, call, index)),
              ),
            scope: batch.scope,
            label: batch.label,
            total: batch.calls.length,
            completed: batch.calls.filter((call) => isBatchCallHandled(call)).length,
          }
        : undefined;
    },
    [config],
  );

  const recheckPendingRoutingBatch = useCallback(
    async (scope: string, destinations?: readonly PendingProject[]) => {
      const account = getAccount(config).address;
      if (!account) throw new Error("Connect a wallet first.");
      const lock = `revnet:multichain:${account.toLowerCase()}`;
      if (running.has(lock))
        throw new Error("Another multichain batch is already being processed.");
      const check = async (locks: TabLocks) => {
        setIsPending(true);
        let issue: string | undefined;
        try {
          const batch = destinations
            ? findPendingRoutingBatch(account, destinations)
            : findPendingBatch(account, scope);
          if (batch) {
            for (const [index, call] of batch.calls.entries())
              await requireRelayrRecoveryScopeAvailable(
                account,
                batchCallScope(batch, call, index),
              );
            if (getAccount(config).address?.toLowerCase() !== account.toLowerCase())
              throw new Error("The connected account changed. Re-check with the original account.");
            if (hasUntouchedRoutingCalls(batch)) {
              const released = batch.rounds.flatMap((round) =>
                round.bundleUuid && isReleasedUnpaidRelayrBundle(account, round.bundleUuid)
                  ? [round.bundleUuid]
                  : [],
              );
              await fence(locks, resetUnpaidRoutingDraft)(batch, released);
            }
          }
        } catch (cause) {
          issue = cause instanceof Error ? cause.message : "The saved batch could not be checked.";
        } finally {
          setIsPending(false);
        }
        const latest = getPendingBatch(scope, destinations);
        return latest && { ...latest, recoveryReason: issue ?? latest.recoveryReason };
      };
      running.add(lock);
      try {
        return (await browserLocks().request(lock, { ifAvailable: true }, (acquired) => {
          if (!acquired)
            throw new Error("Another browser tab is already processing a multichain batch.");
          return check([acquired]);
        })) as Awaited<ReturnType<typeof check>>;
      } finally {
        running.delete(lock);
      }
    },
    [config, getPendingBatch],
  );

  /**
   * Send a direct batch's `indices` as one reviewed action, held as the batch, each step's result
   * saved to the batch journal as it goes. The journal decides what a resume sends, so a run that
   * did not finish drops its own saved sequence once its steps' holds allow.
   */
  const sendDirectCalls = useCallback(
    async (
      batch: MultichainBatch,
      indices: readonly number[],
      {
        title,
        context,
        progress,
        beforeFirstSend,
        onCall,
        locks,
      }: {
        /** The batch lock: each journal write, and the wallet, check it first. */
        locks: TabLocks;
        title: string;
        context?: readonly ReviewContextRow[];
        progress: (message: string) => void;
        beforeFirstSend?: () => Promise<void>;
        onCall: (index: number) => void;
      },
    ): Promise<"done" | "proposed"> => {
      if (!indices.length) {
        await beforeFirstSend?.();
        return "done";
      }
      const saveBatch = fence(locks, saveMultichainBatch);
      const save = async (index: number, patch: Partial<FrozenBatchCall>) => {
        Object.assign(batch.calls[index], patch);
        await saveBatch(batch);
        onCall(index);
      };
      /**
       * What the wallet answered for a call, merged into the saved batch while it still holds that
       * call being submitted unsent. Refused for a lapsed lock, core saves it once the lock is
       * taken back.
       */
      const answered = async (index: number, patch: Partial<FrozenBatchCall>) => {
        Object.assign(batch.calls[index], patch);
        await fence(locks, () => {
          const saved = readMultichainBatches().find((item) => item.id === batch.id);
          const call = saved?.calls[index];
          if (call?.state !== "submitting" || call.hash) return;
          Object.assign(call, patch);
          saveMultichainBatch(saved!);
        })();
        onCall(index);
      };
      const result = await run({
        account: batch.account,
        title,
        context,
        description:
          "Calls are submitted in order on their selected chains. A Safe proposal must execute before the next call. Confirmed calls are skipped when resuming.",
        confirmLabel: "Agree & send",
        scope: batch.id,
        locks,
        calls: indices.map((index) => {
          const call = batch.calls[index]!;
          return reviewedCall(
            {
              chainId: call.chainId,
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args,
              value: call.value,
            },
            { contractName: call.contractName, label: batch.label, gas: call.gas },
          );
        }),
        reverify: async (_call, step) => {
          const call = batch.calls[indices[step]!]!;
          const client = getPublicClient(config, { chainId: call.chainId });
          if (!client) throw new ReviewRefusal("Destination RPC unavailable.");
          await verifyCallPreconditions(client, call.preconditions);
        },
        beforeWallet: async (_call, step) => {
          if (step === 0) await beforeFirstSend?.();
          // The call before this one is verified, from its receipt, before this one is sent.
          const previous = step > 0 ? indices[step - 1]! : undefined;
          if (previous !== undefined && batch.calls[previous]!.state === "submitted") {
            const sent = batch.calls[previous]!;
            const client = getPublicClient(config, { chainId: sent.chainId }) as PublicClient;
            try {
              await save(previous, await verifyDirectResult(client, batch, sent, locks));
            } catch (cause) {
              throw new ReviewRefusal(
                cause instanceof Error ? cause.message : "The previous call could not be verified.",
              );
            }
          }
          const index = indices[step]!;
          const call = batch.calls[index]!;
          const client = getPublicClient(config, { chainId: call.chainId });
          if (!client) throw new ReviewRefusal("Destination RPC unavailable.");
          // The last read before the wallet: the call's sources still hold what it was built on.
          await verifyCallPreconditions(client, call.preconditions);
          progress(
            `Call ${index + 1} of ${batch.calls.length} on chain ${batch.calls[index]!.chainId}.`,
          );
          await save(index, { state: "submitting" });
        },
        onUnsent: (_call, step) => answered(indices[step]!, { state: "ready" }),
        onSubmitted: (_call, step, hash, sent) =>
          answered(indices[step]!, { hash, state: sent.safe ? "safe" : "submitted" }),
      });
      if (result?.status === "proposed") return "proposed";
      if (result?.status === "done") return "done";
      const record = findReviewedSequence(batch.id, batch.account);
      if (record) await discardReviewedSequence(record).catch(() => undefined);
      requireDone(result);
      return "done";
    },
    [config, run],
  );

  const runBatch = useCallback(
    async (input: BatchInput): Promise<BatchResult> => {
      input.signal?.throwIfAborted();
      requireNoViewAs();
      if (
        [input.expectedBatchId, input.replaceDraftId, input.refreshBatchId].filter(Boolean).length >
        1
      )
        throw new Error("Choose either recovery or a fresh routing review.");
      const replacementId = input.refreshBatchId ?? input.replaceDraftId;
      const { address: account, chainId: startChainId } = getAccount(config);
      if (!account) throw new Error("Connect a wallet first.");
      const lock = `revnet:multichain:${account.toLowerCase()}`;
      if (running.has(lock))
        throw new Error("Another multichain batch is already being processed.");
      const execute = async (locks: TabLocks): Promise<BatchResult> => {
        // Every batch and activity write under the batch lock checks this tab still holds it.
        const activity = activityJournal(locks);
        const saveBatch = fence(locks, saveMultichainBatch);
        setIsPending(true);
        let batch: MultichainBatch | undefined;
        let replacingDraft: MultichainBatch | undefined;
        let replacementCommitted = false;
        // This run's one review of every exact call, which each round's signatures spend.
        let plan: ReviewedPlan | undefined;
        /** The gas the plan bound for each forward request, by call index. */
        const plannedGas = new Map<number, bigint>();
        // A fresh direct batch's save, run once its review is confirmed.
        let commitFresh: (() => Promise<void>) | undefined;
        const progress = (message: string) => {
          input.onProgress?.(message);
          // A line only: written while the lock reads as held, never awaited.
          if (batch && !locks.some((held) => held.signal.aborted))
            updateTransactionActivity(batch.id, { message });
        };
        // Bind the execution route; the adapter resolves the current wallet at invocation.
        const safe = isSafeConnection(config);
        const requireAccount = () => {
          input.signal?.throwIfAborted();
          requireNoViewAs();
          if (getAccount(config).address?.toLowerCase() !== account.toLowerCase())
            throw new Error("The connected account changed. Resume with the original account.");
          if (isSafeConnection(config) !== safe) throw new ReviewRefusal(WALLET_CHANGED);
        };
        const result = (status: BatchResult["status"]): BatchResult => ({
          status,
          hashes: batch!.calls.flatMap((call, callIndex) =>
            call.state === "success" && call.hash
              ? [{ chainId: call.chainId, hash: call.hash, callIndex }]
              : [],
          ),
          ...(batch!.calls.some((call) => call.state === "reverted")
            ? {
                revertedHashes: batch!.calls.flatMap((call, callIndex) =>
                  call.state === "reverted" && call.hash
                    ? [{ chainId: call.chainId, hash: call.hash, callIndex }]
                    : [],
                ),
              }
            : {}),
          ...(batch!.calls.some((call) => call.skipReason === "obsolete-safe")
            ? {
                obsoleteSafeProposals: batch!.calls.flatMap((call, callIndex) =>
                  call.skipReason === "obsolete-safe" && call.hash && call.safeNonce !== undefined
                    ? [
                        {
                          chainId: call.chainId,
                          safe: batch!.account,
                          hash: call.hash,
                          nonce: call.safeNonce,
                          callIndex,
                        },
                      ]
                    : [],
                ),
              }
            : {}),
        });
        const reconcileReadyCall = async (call: FrozenBatchCall, index: number) => {
          if (call.state !== "ready" || call.hash || !call.expectedRouterPending) return false;
          // Lost publication responses also reserve this scope. Never skip a
          // signed/published call just because its journal still says ready.
          await requireRelayrRecoveryScopeAvailable(account, batchCallScope(batch!, call, index));
          const client = getPublicClient(config, { chainId: call.chainId });
          if (!client) throw new Error("Destination RPC unavailable.");
          const advance = await readRouterPendingAdvance(
            client,
            call.expectedRouterPending,
            call.preconditions,
          );
          if (advance) {
            call.state = "skipped";
            call.skipReason = advance;
            await saveBatch(batch!);
            return true;
          }
          return false;
        };
        try {
          const pending = findPendingBatch(account, input.scope);
          if (input.expectedBatchId && pending?.id !== input.expectedBatchId)
            throw new Error(
              "The reviewed saved batch changed. Review its latest selection before resuming.",
            );
          batch = pending;
          if (replacementId) {
            const candidate = readMultichainBatches().find((item) => item.id === replacementId);
            if (candidate) {
              if (
                candidate.account.toLowerCase() !== account.toLowerCase() ||
                !(input.refreshBatchId
                  ? canRefreshRoutingBatch(candidate)
                  : isReplaceableRoutingDraft(candidate)) ||
                !input.calls.length ||
                !input.calls.every((call) => call.expectedRouterPending)
              )
                throw new Error("This saved batch must be resumed before changing the selection.");
              for (const [index, call] of candidate.calls.entries()) {
                const scope = batchCallScope(candidate, call, index);
                if (hasRelayrRecoveryScopeSession(account, scope))
                  throw new Error(
                    "A saved session must be reconciled before replacing this batch.",
                  );
                await requireRelayrRecoveryScopeAvailable(account, scope);
              }
              requireAccount();
              replacingDraft = candidate;
              if (batch?.id === candidate.id) batch = undefined;
            } else if (input.refreshBatchId || !batch || batch.key !== batchCallKey(input.calls)) {
              throw new Error("The saved batch changed. Refresh before starting another batch.");
            }
          }
          if (batch && input.calls.length && batch.key !== batchCallKey(input.calls))
            throw new Error(
              "A different saved batch is unresolved. Resume its original calls before changing the selection or amounts.",
            );
          if (!batch) {
            if (!input.calls.length) throw new Error("There is no saved batch to resume.");
            const multichainEoa =
              (input.calls.length > 1 ||
                input.calls.every(
                  (call) => call.relayrMode === "raw" && call.expectedRouterPending,
                )) &&
              !isSafeConnection(config);
            const chainIds = input.calls.map((call) => call.chainId);
            const compatible = areRelayrChainsCompatible(chainIds);
            if (multichainEoa && chainIds.every(isRelayrSupportedChain) && !compatible)
              throw new Error(
                "Choose destinations from one network family. Mainnet and testnet transactions cannot share a batch.",
              );
            // Routing is decided only for a new journal. An older direct testnet
            // job must resume its original transport and skip confirmed calls.
            // A keeper can resolve these calls at any time. Direct transactions
            // have a final receipt; a reverted forwarder signature remains live.
            const relayr =
              multichainEoa &&
              compatible &&
              (!input.calls.some((call) => call.expectedRouterPending) ||
                input.calls.every(
                  (call) => call.expectedRouterPending && call.relayrMode === "raw",
                ));
            batch = createMultichainBatch(
              account,
              input.scope,
              input.label,
              input.calls,
              relayr ? "relayr" : "direct",
              replacingDraft?.id,
            );
            for (const call of input.calls) await call.validate?.();
            requireAccount();
            const fresh = batch;
            // After the review: the exact calls are checked, then saved (replacing the draft
            // they supersede) before anything is sent.
            const commit = async () => {
              requireAccount();
              progress("Checking the selected transactions…");
              await mapConcurrentChecks(fresh.calls, async (call) => {
                if (input.refreshBatchId) describeSavedRoutingCall(call);
                const client = getPublicClient(config, { chainId: call.chainId });
                if (!client) throw new Error("Destination RPC unavailable.");
                await verifyCallPreconditions(client, call.preconditions);
              });
              requireAccount();
              if (replacingDraft) {
                for (const [index, call] of replacingDraft.calls.entries()) {
                  const scope = batchCallScope(replacingDraft, call, index);
                  if (hasRelayrRecoveryScopeSession(account, scope))
                    throw new Error(
                      "A saved session must be reconciled before replacing this batch.",
                    );
                  await requireRelayrRecoveryScopeAvailable(account, scope);
                }
                requireAccount();
                if (input.refreshBatchId && !canRefreshRoutingBatch(replacingDraft))
                  throw new Error("Saved submission or recovery evidence must be resumed.");
                await fence(locks, replaceRoutingDraft)(
                  replacingDraft,
                  fresh,
                  Boolean(input.refreshBatchId),
                );
                replacementCommitted = true;
                await activity.update(replacingDraft.id, {
                  status: input.refreshBatchId ? "pending" : "failed",
                  manualVerificationRequired: Boolean(input.refreshBatchId),
                  message: input.refreshBatchId
                    ? "A fresh routing review superseded this selection. The previous wallet result remains unknown."
                    : "The unsubmitted selection was replaced after a fresh review.",
                });
              } else await saveBatch(fresh);
              await activity.record({
                id: fresh.id,
                kind: "direct",
                title: input.label,
                status: "pending",
                manualVerificationRequired: true,
                account,
                message:
                  "The exact selected calls are saved. Resume this batch to continue safely.",
              });
            };
            if (relayr) {
              progress("Checking the selected transactions…");
              // Each forward request's signed gas, fixed now so the review binds it.
              for (const [index, call] of batch.calls.entries()) {
                if (call.relayrMode === "raw") continue;
                const client = getPublicClient(config, { chainId: call.chainId });
                const forwarder = jbContractAddress[6].ERC2771Forwarder[call.chainId as JBChainId];
                if (!client || !forwarder) throw new Error("Destination RPC unavailable.");
                plannedGas.set(
                  index,
                  await forwardedRequestGas(client, forwarder, account, {
                    data: {
                      from: account,
                      to: call.address,
                      value: call.value ?? 0n,
                      gas: await callGas(client, account, call),
                      data: call.data,
                    },
                  }),
                );
              }
              progress("Review the selected transactions.");
              plan = await (
                await loadEngine()
              ).reviewPlan(
                {
                  account,
                  title: input.calls.every((call) => call.expectedRouterPending)
                    ? "Retry payments"
                    : `Review ${input.label}`,
                  description: `Pay network fees ${batch.rounds.length === 1 ? "once for this batch" : `in ${batch.rounds.length} separate payments`}. Each ${input.calls.every((call) => call.expectedRouterPending) ? "payment" : "transaction"} has its own result.`,
                  confirmLabel: "Agree & prepare batch",
                  calls: batch.calls.map((call, index) => ({
                    chainId: call.chainId,
                    // A raw call runs from Relayr's own account.
                    from: call.relayrMode === "raw" ? ("relayr" as const) : account,
                    to: call.address,
                    value: call.value ?? 0n,
                    data: call.data,
                    ...(plannedGas.has(index) ? { gas: plannedGas.get(index) } : {}),
                    // Each round pays one Relayr fee: the review shows its bound once.
                    relayrRound: roundKey(
                      batch!.rounds.findIndex((round) => round.indices.includes(index)),
                    ),
                    abi: call.abi,
                    functionName: call.functionName,
                    args: call.args,
                    contractName: call.contractName,
                  })),
                  // Each round's fee is paid on the start chain, so its bound is quoted there.
                  // A start chain outside the destinations' family leaves the payer's choice open.
                  ...(startChainId &&
                  areRelayrChainsCompatible([
                    startChainId,
                    ...batch.calls.map((call) => call.chainId),
                  ])
                    ? {
                        relayrRounds: Object.fromEntries(
                          batch.rounds.map((_, roundIndex) => [
                            roundKey(roundIndex),
                            { paymentChainId: startChainId },
                          ]),
                        ),
                      }
                    : {}),
                  signal: input.signal,
                },
                reviewedSendDeps(config),
              );
              await commit();
              // A direct batch is reviewed once by the reviewed send that sends it.
            } else commitFresh = commit;
          }
          const displayedCalls = batch.calls.map(callProgress);
          const reportCalls = () => {
            try {
              input.onCallProgress?.(structuredClone(displayedCalls));
            } catch {
              // A display observer cannot interrupt execution or change the saved batch.
            }
          };
          if (batch.route === "relayr") {
            if (batch.calls.some((call) => call.expectedRouterPending && call.relayrMode !== "raw"))
              throw new Error(
                "The saved routing batch contains an authorization. Reconcile that original authorization before starting a direct retry.",
              );
            if (isSafeConnection(config))
              throw new Error("Resume this batch using its original EOA account connection.");
            for (const [roundIndex, round] of batch.rounds.entries()) {
              if (round.state === "success") continue;
              requireAccount();
              if (round.state === "funding" || round.state === "pending") input.onBeforePayment?.();
              if (round.state === "funding" && round.bundleUuid) {
                const activity = refreshTransactionActivities().find(
                  (item) => item.bundleUuid === round.bundleUuid,
                );
                if (
                  activity?.relayrPaymentStatus === "unfunded" ||
                  activity?.relayrPaymentStatus === "reverted" ||
                  activity?.relayrPaymentStatus === "expired"
                ) {
                  round.state = "quoted";
                  await saveBatch(batch);
                }
              }
              requireAccount();
              if (round.state === "ready" || round.state === "quoted") {
                progress(`Checking ${round.indices.length} transactions for the fee quote…`);
                const requests = await mapConcurrentChecks(round.indices, async (index) => {
                  const call = batch!.calls[index];
                  const client = getPublicClient(config, { chainId: call.chainId });
                  if (!client) throw new Error("Destination RPC unavailable.");
                  await verifyCallPreconditions(client, call.preconditions);
                  // A forward request signs the gas its plan reviewed.
                  const gas = plannedGas.get(index) ?? (await callGas(client, account, call));
                  return {
                    chainId: call.chainId as JBChainId,
                    version: 6 as const,
                    relayrMode: call.relayrMode,
                    recoveryScope: batchCallScope(batch!, call, index),
                    preconditions: call.preconditions,
                    expectedDeployment: call.expectedDeployment,
                    rejectEvents: call.rejectEvents,
                    reservedReceipt: call.reservedReceipt,
                    expectedPayout: call.expectedPayout,
                    expectedRouterPending: call.expectedRouterPending,
                    data: {
                      from: account,
                      to: call.address,
                      value: call.value ?? 0n,
                      gas,
                      data: call.data,
                    },
                    review: {
                      abi: call.abi,
                      functionName: call.functionName,
                      args: call.args,
                      contractName: call.contractName,
                      label: batch!.label,
                    },
                  };
                });
                requireAccount();
                const quote = await getRelayrTxQuote(requests, {
                  signal: input.signal,
                  onMessage: progress,
                  ...(plan ? { planned: { plan, relayrRound: roundKey(roundIndex) } } : {}),
                });
                requireAccount();
                if (!quote) throw new Error("No payable quote is available.");
                const quotedCalls = refreshTransactionActivities().find(
                  (row) => row.bundleUuid === quote.bundle_uuid,
                )?.relayrExpectedTransactions;
                if (
                  (!quotedCalls || quotedCalls.length !== round.indices.length) &&
                  new Set(round.indices.map((index) => batch!.calls[index].chainId)).size !==
                    round.indices.length
                )
                  throw new Error("The quote has no complete destination identity binding.");
                round.transactionUuids = quotedCalls?.map((call) => call.transactionUuid);
                round.bundleUuid = quote.bundle_uuid;
                round.state = "quoted";
                await saveBatch(batch);
                input.onBeforePayment?.();
                progress("Choose a network for the fee payment.");
                const payment = await chooseRelayrPayment(quote.payment_info, startChainId);
                requireAccount();
                round.state = "funding";
                await saveBatch(batch);
                try {
                  progress("Review the network-fee payment.");
                  await sendRelayrTx(payment, { onMessage: progress });
                } catch (cause) {
                  const activity = refreshTransactionActivities().find(
                    (row) => row.bundleUuid === round.bundleUuid,
                  );
                  if (
                    activity?.relayrPaymentStatus === "unfunded" ||
                    activity?.relayrPaymentStatus === "reverted" ||
                    activity?.relayrPaymentStatus === "expired"
                  ) {
                    round.state = "quoted";
                    await saveBatch(batch);
                  }
                  throw cause;
                }
                round.state = "pending";
                await saveBatch(batch);
              }
              if (!round.bundleUuid)
                throw new Error(
                  "The saved publication response is unresolved. Reconcile the original intent before continuing.",
                );
              if (
                !round.transactionUuids &&
                new Set(round.indices.map((index) => batch!.calls[index].chainId)).size !==
                  round.indices.length
              )
                throw new Error(
                  "The saved bundle has no unique transaction identity for every routing attempt. Reconcile the original bundle before continuing.",
                );
              progress(
                `Checking payment and ${round.indices.length} transaction results${batch.rounds.length > 1 ? ` (round ${roundIndex + 1} of ${batch.rounds.length})` : ""}…`,
              );
              reportCalls();
              const bundle = input.onCallProgress
                ? await waitForRelayrBundle(round.bundleUuid, undefined, (results) => {
                    for (const [position, index] of round.indices.entries()) {
                      const id = round.transactionUuids?.[position];
                      // Legacy bundles without exact UUID bindings keep their existing recovery.
                      const update = id && results.find((item) => item.transactionUuid === id);
                      if (update)
                        displayedCalls[index] = { status: update.status, hash: update.hash };
                    }
                    reportCalls();
                    const checked = displayedCalls.filter((call) =>
                      ["confirmed", "reverted", "skipped"].includes(call.status),
                    ).length;
                    const submitted = displayedCalls.filter((call) => call.hash).length;
                    const reverted = displayedCalls.filter(
                      (call) => call.status === "reverted",
                    ).length;
                    const count = displayedCalls.length;
                    progress(
                      checked
                        ? `${checked} of ${count} attempts checked. ${count - checked} remaining.${reverted ? ` ${reverted} reverted.` : ""}`
                        : `${submitted} of ${count} attempts submitted. Checking results…`,
                    );
                  })
                : await waitForRelayrBundle(round.bundleUuid);
              for (const [position, index] of round.indices.entries()) {
                const call = batch.calls[index];
                const transaction = bundle.transactions.find((item) =>
                  round.transactionUuids
                    ? item.tx_uuid === round.transactionUuids[position]
                    : item.request.chain === call.chainId,
                );
                const hash = transaction && relayrDestinationHash(transaction);
                if (!hash) throw new Error("The destination result has no verified hash.");
                call.hash = hash;
                const identity = refreshTransactionActivities()
                  .find((row) => row.bundleUuid === round.bundleUuid)
                  ?.relayrExpectedTransactions?.find(
                    (item) => item.transactionUuid === transaction.tx_uuid,
                  );
                call.state = identity?.receiptStatus === "reverted" ? "reverted" : "success";
                displayedCalls[index] = callProgress(call);
              }
              round.state = "success";
              await saveBatch(batch);
              reportCalls();
            }
          } else {
            requireAccount();
            input.onBeforePayment?.();
            const sending: number[] = [];
            for (const [index, call] of batch.calls.entries()) {
              if (isBatchCallHandled(call)) continue;
              requireAccount();
              const client = getPublicClient(config, { chainId: call.chainId }) as
                PublicClient | undefined;
              if (!client) throw new Error("Destination RPC unavailable.");
              if (call.hash) {
                Object.assign(call, await verifyDirectResult(client, batch, call, locks));
                await saveBatch(batch);
                displayedCalls[index] = callProgress(call);
                reportCalls();
                continue;
              }
              if (call.state === "submitting")
                throw new Error(
                  "The previous wallet submission has an unknown result. Reconcile it before resubmitting this batch.",
                );
              await requireRelayrRecoveryScopeAvailable(
                account,
                batchCallScope(batch, call, index),
              );
              if (await reconcileReadyCall(call, index)) {
                displayedCalls[index] = callProgress(call);
                reportCalls();
                continue;
              }
              sending.push(index);
            }
            const sent = await sendDirectCalls(batch, sending, {
              locks,
              title: input.calls.every((call) => call.expectedRouterPending)
                ? "Retry payments"
                : `Review ${input.label}`,
              context: input.context,
              progress,
              beforeFirstSend: commitFresh,
              onCall: (index) => {
                displayedCalls[index] = callProgress(batch!.calls[index]);
                reportCalls();
              },
            });
            if (sent === "proposed") {
              progress(
                "Safe proposal saved. Execute it, then resume this batch; no other call will be proposed yet.",
              );
              return result("pending");
            }
            for (const index of sending) {
              const call = batch.calls[index];
              if (call.state !== "submitted") continue;
              const client = getPublicClient(config, { chainId: call.chainId }) as PublicClient;
              Object.assign(call, await verifyDirectResult(client, batch, call, locks));
              await saveBatch(batch);
              displayedCalls[index] = callProgress(call);
              reportCalls();
            }
          }
          batch.status = "success";
          await saveBatch(batch);
          reportCalls();
          await activity.update(batch.id, {
            status: batch.calls.some((call) => call.state === "reverted") ? "failed" : "success",
            manualVerificationRequired: false,
            message: batch.calls.some((call) => call.state === "reverted")
              ? "Batch review complete. Some routing transactions reverted. Refresh pending payments and prepare a new review for any remaining attempts."
              : batch.calls.some((call) => call.expectedRouterPending)
                ? "Selected routing attempts were verified or had already advanced onchain. Refresh pending payments to see which remain in gateway custody."
                : "Every selected call has a verified successful destination result.",
          });
          return result("success");
        } catch (cause) {
          if (batch && (!replacementId || replacementCommitted)) {
            let discarded = false;
            if (
              !replacementId &&
              batch.calls.every((call) => call.state === "ready") &&
              batch.rounds.every((round) => round.state === "ready")
            ) {
              try {
                for (const [index, call] of batch.calls.entries())
                  await requireRelayrRecoveryScopeAvailable(
                    account,
                    batchCallScope(batch, call, index),
                  );
                await fence(locks, removeUnsubmittedBatch)(batch.id);
                discarded = true;
              } catch {
                /* A published authorization or inaccessible journal must remain locked. */
              }
            }
            await activity.update(batch.id, {
              status: discarded ? "failed" : "pending",
              manualVerificationRequired: !discarded,
              message:
                cause instanceof Error ? cause.message : "The saved batch needs reconciliation.",
            });
          }
          throw cause;
        } finally {
          setIsPending(false);
        }
      };
      running.add(lock);
      try {
        return (await browserLocks().request(lock, { ifAvailable: true }, (acquired) => {
          if (!acquired)
            throw new Error("Another browser tab is already processing a multichain batch.");
          return execute([acquired]);
        })) as Awaited<ReturnType<typeof execute>>;
      } finally {
        running.delete(lock);
      }
    },
    [config, getRelayrTxQuote, sendRelayrTx, sendDirectCalls],
  );
  return { runBatch, getPendingBatch, recheckPendingRoutingBatch, isPending };
}
