"use client";

import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import {
  sameSafeRelayrIntents,
  type SafeRelayrPhase,
  type SafeRelayrProgress,
  type SafeRelayrResult,
  type SafeRelayrView,
} from "@bananapus/nana-sdk-core/review/safe-relayr";

import { EthereumAddress } from "@/components/EthereumAddress";
import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import {
  loadEngine,
  reviewClosed,
  reviewedWalletAdapter,
  ReviewRefusal,
  useReviewedAction,
  useSafeTransactionSignature,
  WALLET_CHANGED,
} from "@/hooks/useReviewedAction";
import {
  checkRelayrSession,
  RelayrRecoveryError,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
  watchSafeBundleView,
  type ReviewedRelayrRequest,
} from "@/hooks/useReviewedRelayr";
import { mapConcurrentChecks } from "@/lib/concurrent-checks";
import { readHandleAuthority, unprovenSafeMessage } from "@/lib/handle-authority";
import { recordSubmittedWrite, settleSubmittedWrite } from "@/lib/held-rows";
import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import { PROJECT_HANDLE_CHAIN_ID } from "@/lib/projectHandles";
import { protocolQueueLabel } from "@/lib/protocol-queue-label";
import {
  bindingMatchesProject,
  classifyQueuedProjectHandleTransaction,
  projectSafeQueueTargets,
  verifyQueuedProjectHandleBinding,
  verifyQueuedProjectHandlePostcondition,
  type ProjectSafeQueueTarget,
  type QueuedProjectHandleBinding,
} from "@/lib/queuedProjectHandle";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import { describeQueuedBatch } from "@/lib/safe-batch";
import { useSafeConnection } from "@/lib/safe-connector";
import { queuedSafeReviewCall } from "@/lib/safe-queue-review";
import {
  hasSafeService,
  listPendingSafeTransactions,
  SAFE_EXEC_ABI,
  safeExecutionArgs,
  safeQueueUrl,
  safeTransactionHash,
  safeTransactionHasRefund,
  submitSafeConfirmation,
  usableSafeConfirmations,
  type SafeQueuedTransaction,
} from "@/lib/safe-service-config";
import { queueUnavailableMessage, REFUND_REFUSAL } from "@/lib/safe-transactions";
import { refreshTransactionActivities } from "@/lib/transaction-activity";
import { preselectedRelayrPayment, relayrPaymentOptions } from "@/lib/transaction-review";
import { etherscanLink, formatWalletError } from "@/lib/utils";
import { requireNoViewAs } from "@/lib/view-as";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { safeExecutionIntent, type ReviewedCall } from "@bananapus/nana-sdk-core/review";
import {
  multiSendCallsOf,
  readAuthorityIdentity,
  readBoundedSafeNonce,
  type SafeAuthorityIdentity,
} from "@bananapus/nana-sdk-core/safe";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, isAddressEqual, type Address, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";
import { authorityIdentityQuery } from "./authorityIdentityQuery";
import {
  chainName,
  isLiveRevnetOperator,
  publicClientFor,
  type ChainProjectRow,
} from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import { useLiveRevnetOperators } from "./useLiveRevnetOperators";

type DisplayQueuedTransaction = {
  transaction: SafeQueuedTransaction;
  handleBinding: QueuedProjectHandleBinding | null;
  handleError?: string;
};

type SafePolicy = { owners: Address[]; threshold: number; nonce: number };

type QueueRow = ProjectSafeQueueTarget & {
  policy: SafePolicy;
  transactions: DisplayQueuedTransaction[];
  /** The chain has no Safe transaction service, so the queue was not read. */
  queueUnavailable?: boolean;
  queueError?: string;
};

/** A queue the card names but can't read, with the one line that says why. */
type QueueNotice = ProjectSafeQueueTarget & { notice: string; retryable?: boolean };

/** The operator Safe's creation does not prove it is the same Safe on the handle chain. */
class UnprovenSafeError extends Error {}

type LiveSafePolicy = SafePolicy & { identity: SafeAuthorityIdentity };

/** One chain's next fully signed transaction in an Execute all bundle. */
type BatchRow = { row: QueueRow; tx: SafeQueuedTransaction };

type BatchRun = {
  account: Address;
  preparing: boolean;
  phase?: SafeRelayrPhase;
  hashes: Record<number, Hex>;
  recovery: RelayrRecoveryError | null;
  recoveryChecks?: NonNullable<SafeRelayrResult["recovery"]>["checks"];
  quote: RelayrPostBundleResponse | null;
  paymentChainId: number | null;
  rows: BatchRow[];
  status: Record<number, string>;
  running: boolean;
  done: boolean;
  message: string | null;
  error: string | null;
};

async function prepareBatchRequests(
  rows: BatchRow[],
  address: Address,
  setRowStatus: (chainId: number, status: string) => void,
): Promise<ReviewedRelayrRequest[]> {
  // Check 1 of 2: live operator, policy, nonce and signatures per chain,
  // then the quote pins each Safe's nonce and exact transaction hash and
  // simulates it. Check 2 runs in sendRelayrTx right before paying.
  return mapConcurrentChecks(rows, async ({ row, tx }): Promise<ReviewedRelayrRequest> => {
    setRowStatus(row.chainId, "Checking…");
    try {
      if (safeTransactionHasRefund(tx)) throw new Error(REFUND_REFUSAL);
      await verifyLiveQueuedTransaction(row, tx);
      const policy = await readLiveSafePolicy(row);
      if (policy.nonce !== tx.nonce)
        throw new Error(
          `Safe transaction #${tx.nonce} is no longer next on ${chainName(row.chainId)}.`,
        );
      if (usableSafeConfirmations(tx, policy.owners).length < policy.threshold)
        throw new Error(
          `Safe transaction #${tx.nonce} on ${chainName(row.chainId)} no longer has enough current-owner confirmations.`,
        );
      const args = safeExecutionArgs(tx, policy.owners);
      const data = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args,
      });
      const gas = await publicClientFor(row.chainId).estimateGas({
        account: address,
        to: row.safe,
        data,
      });
      const request: ReviewedRelayrRequest = {
        chainId: row.chainId as JBChainId,
        version: 6,
        relayrMode: "safe-exec",
        expectedSafeExecution: {
          safe: row.safe,
          safeTxHash: safeTransactionHash(row.chainId, row.safe, tx),
          nonce: tx.nonce,
        },
        data: { from: address, to: row.safe, value: 0n, gas, data },
        review: {
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          args,
          label: `Execute Safe transaction #${tx.nonce} on ${chainName(row.chainId)}`,
          contractName: "Safe",
          calls: [queuedSafeReviewCall(row.chainId, tx)],
        },
      };
      setRowStatus(row.chainId, "Ready");
      return request;
    } catch (cause) {
      setRowStatus(row.chainId, "Check failed");
      throw cause;
    }
  });
}

function queueLabel(chainId: number, tx: SafeQueuedTransaction): string {
  return (
    describeQueuedBatch(tx) ?? protocolQueueLabel(chainId, tx) ?? tx.data?.slice(0, 10) ?? "0x"
  );
}

function QueuedCallSummary({ chainId, tx }: { chainId: number; tx: SafeQueuedTransaction }) {
  const calls = multiSendCallsOf(tx);
  if (!calls?.length) return null;
  return (
    <ol className="mt-1 list-decimal pl-5 text-xs font-normal text-zinc-700">
      {calls.map((call, index) => (
        <li key={index}>
          {protocolQueueLabel(chainId, { ...call, operation: 0 }) ??
            `${call.data.slice(0, 10)} → ${call.to}`}
        </li>
      ))}
    </ol>
  );
}

async function requireLiveSafeAuthority(
  row: Pick<QueueRow, "chainId" | "safe" | "authorityRows" | "handleOnly">,
): Promise<void> {
  const mainnetClient = publicClientFor(PROJECT_HANDLE_CHAIN_ID);
  let hasLiveAuthority = false;
  let unprovenCreation = false;
  for (const authorityRow of row.authorityRows) {
    const sourceClient = publicClientFor(authorityRow.chainId);
    if (!(await isLiveRevnetOperator(sourceClient, authorityRow, row.safe))) continue;
    if (!row.handleOnly) {
      hasLiveAuthority = true;
      break;
    }
    const authority = await readHandleAuthority({
      sourceChainId: authorityRow.chainId,
      sourceClient,
      mainnetClient,
      authority: row.safe,
    });
    if (authority.status === "valid-safe") {
      hasLiveAuthority = true;
      break;
    }
    unprovenCreation ||= authority.status === "unproven-creation";
  }
  if (!hasLiveAuthority) {
    throw unprovenCreation
      ? new UnprovenSafeError(unprovenSafeMessage(PROJECT_HANDLE_CHAIN_ID))
      : new Error("This Safe is no longer the live revnet operator.");
  }
}

async function readLiveSafePolicy(
  row: Pick<QueueRow, "chainId" | "safe" | "authorityRows" | "handleOnly">,
): Promise<LiveSafePolicy> {
  await requireLiveSafeAuthority(row);
  const client = publicClientFor(row.chainId);
  const identity = await readAuthorityIdentity(client, row.safe);
  if (identity?.kind !== "safe") {
    throw new Error("The operator no longer has a supported canonical Safe identity.");
  }
  const nonce = await readVerifiedSafeNonce(row);
  return {
    identity,
    owners: identity.owners,
    threshold: identity.threshold,
    nonce,
  };
}

async function readVerifiedSafeNonce(row: Pick<QueueRow, "chainId" | "safe">): Promise<number> {
  // An RPC failure reads as an unverified nonce, never as a raw node error.
  const nonce = await readBoundedSafeNonce(publicClientFor(row.chainId), row.safe).catch(
    () => null,
  );
  if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The Safe nonce could not be verified.");
  }
  return Number(nonce);
}

function sameSafePolicy(left: LiveSafePolicy, right: LiveSafePolicy): boolean {
  const leftOwners = left.identity.owners.map((owner) => owner.toLowerCase()).sort();
  const rightOwners = right.identity.owners.map((owner) => owner.toLowerCase()).sort();
  return (
    left.nonce === right.nonce &&
    left.identity.proxyCodeHash.toLowerCase() === right.identity.proxyCodeHash.toLowerCase() &&
    isAddressEqual(left.identity.singleton, right.identity.singleton) &&
    left.identity.singletonCodeHash.toLowerCase() ===
      right.identity.singletonCodeHash.toLowerCase() &&
    left.identity.version === right.identity.version &&
    left.identity.threshold === right.identity.threshold &&
    isAddressEqual(left.identity.fallbackHandler, right.identity.fallbackHandler) &&
    left.identity.fallbackHandlerCodeHash?.toLowerCase() ===
      right.identity.fallbackHandlerCodeHash?.toLowerCase() &&
    isAddressEqual(left.identity.guard, right.identity.guard) &&
    left.identity.hasModules === right.identity.hasModules &&
    left.identity.ownersAreEoas === right.identity.ownersAreEoas &&
    leftOwners.length === rightOwners.length &&
    leftOwners.every((owner, index) => owner === rightOwners[index])
  );
}

async function verifyLiveQueuedTransaction(
  target: ProjectSafeQueueTarget,
  transaction: SafeQueuedTransaction,
): Promise<QueuedProjectHandleBinding | null> {
  const binding = classifyQueuedProjectHandleTransaction(target.chainId, transaction);
  if (target.handleOnly) {
    if (!binding || !target.handleSource || !bindingMatchesProject(binding, target.handleSource)) {
      throw new Error("This Ethereum queue only accepts handle writes for the viewed revnet.");
    }
  }
  if (!binding) return null;
  await verifyQueuedProjectHandleBinding({
    binding,
    safe: target.safe,
    transaction,
    clientFor: publicClientFor,
  });
  return binding;
}

/** Signers by ENS name when they have one, with the connected wallet marked. */
function SignerList({ owners, you }: { owners: readonly Address[]; you?: string }) {
  return (
    <>
      {owners.map((owner, index) => (
        <span key={owner}>
          {index ? ", " : null}
          <EthereumAddress address={owner} short withEnsName />
          {you && owner.toLowerCase() === you.toLowerCase() ? " (you)" : null}
        </span>
      ))}
    </>
  );
}

export function SafeQueueCard({
  rows,
  fallbackOperator,
  fallbackProject,
}: {
  rows: ChainProjectRow[];
  fallbackOperator?: string;
  fallbackProject: ChainProjectRow;
}) {
  const config = useConfig();
  const { address, chainId: connectedChainId } = useAccount();
  // Connected as a Safe (the Safe app, or Safe{Wallet} over WalletConnect), the
  // account is a Safe, not an owner: it cannot sign for itself, and executing
  // or paying Relayr from it would take the very nonce the queued transaction
  // needs. Safe{Wallet}'s own queue is where its owners sign and execute.
  const viaSafeApp = useSafeConnection(config);
  const { signSafeTransactionAsync } = useSafeTransactionSignature();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    kind: "sign" | "execute";
    row: QueueRow;
    tx: SafeQueuedTransaction;
    handleBinding: QueuedProjectHandleBinding | null;
  } | null>(null);
  const operators = useLiveRevnetOperators(rows, {
    ...fallbackProject,
    address: fallbackOperator,
  });
  const operatorByChain = operators.discoveredOperatorByChain ?? operators.operatorByChain;
  const queryClient = useQueryClient();
  const queueTargets = projectSafeQueueTargets(
    rows.flatMap((row) => {
      const safe = operatorByChain.get(row.chainId);
      return safe ? [{ ...row, safe }] : [];
    }),
    fallbackProject,
  );
  const { deps } = useReviewedAction();

  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const [batch, setBatch] = useState<BatchRun | null>(null);
  const batchGeneration = useRef(0);
  const batchAbort = useRef<AbortController | null>(null);
  const payingBatch = useRef(false);
  const connectedAccount = useRef(address);
  connectedAccount.current = address;
  useEffect(
    () => () => {
      batchGeneration.current += 1;
      batchAbort.current?.abort();
    },
    [],
  );
  const batchAccount = batch?.account;
  const batchRunning = batch?.running;
  useEffect(() => {
    if (!batchAccount || batchRunning || batchAccount.toLowerCase() === address?.toLowerCase())
      return;
    batchGeneration.current += 1;
    batchAbort.current?.abort();
    setBatch((current) =>
      current
        ? {
            ...current,
            preparing: false,
            quote: null,
            paymentChainId: null,
            error:
              "The connected account changed. Close this review and check the transactions again.",
          }
        : current,
    );
  }, [address, batchAccount, batchRunning]);
  const queueQueries = useQueries({
    queries: queueTargets.map((target) => ({
      queryKey: ["revnet-safe-queues", target],
      staleTime: 15_000,
      retry: false,
      queryFn: async (): Promise<(QueueRow | QueueNotice)[]> => {
        try {
          // Display discovery shares the Account proof. Action paths below still
          // call readLiveSafePolicy directly, without this cache.
          const identityRead = queryClient.fetchQuery(
            authorityIdentityQuery(target.chainId, target.safe),
          );
          const nonceRead = readVerifiedSafeNonce(target);
          const authorityRead = requireLiveSafeAuthority(target);
          const serviceRead = nonceRead
            .then(async (nonce) => {
              if (!hasSafeService(target.chainId)) return { pending: [] };
              // A synthetic Ethereum queue is only relevant after its cross-chain
              // Safe relationship is proven. Ordinary chain queues can load now.
              if (target.handleOnly) await authorityRead;
              return {
                pending: await listPendingSafeTransactions(target.chainId, target.safe, nonce),
              };
            })
            .catch((cause: unknown) => ({
              pending: [] as SafeQueuedTransaction[],
              queueError: formatWalletError(cause, "Safe queue service is unavailable."),
            }));
          const proofs = Promise.all([nonceRead, authorityRead]).then(
            ([nonce]) => ({ nonce }),
            (error: unknown) => ({ error }),
          );
          const identity = await identityRead;
          if (identity.kind !== "safe") return [];
          const proof = await proofs;
          if ("error" in proof) throw proof.error;
          const { nonce } = proof;
          const policy = { owners: identity.owners, threshold: identity.threshold, nonce };
          if (!hasSafeService(target.chainId)) {
            return [{ ...target, policy, transactions: [], queueUnavailable: true }];
          }
          const result = await serviceRead;
          const pending = result.pending;
          const queueError = "queueError" in result ? result.queueError : undefined;
          let transactions: DisplayQueuedTransaction[] = [];
          const inspected = await Promise.all(
            pending.map(async (transaction): Promise<DisplayQueuedTransaction | null> => {
              let handleBinding: QueuedProjectHandleBinding | null = null;
              try {
                handleBinding = classifyQueuedProjectHandleTransaction(target.chainId, transaction);
              } catch (cause) {
                if (target.handleOnly) return null;
                return {
                  transaction,
                  handleBinding: null,
                  handleError: formatWalletError(
                    cause,
                    "This queued handle transaction could not be decoded safely.",
                  ),
                };
              }
              if (
                target.handleOnly &&
                (!handleBinding ||
                  !target.handleSource ||
                  !bindingMatchesProject(handleBinding, target.handleSource))
              ) {
                return null;
              }
              if (!handleBinding) return { transaction, handleBinding };
              try {
                await verifyQueuedProjectHandleBinding({
                  binding: handleBinding,
                  safe: target.safe,
                  transaction,
                  clientFor: publicClientFor,
                });
                return { transaction, handleBinding };
              } catch (cause) {
                return {
                  transaction,
                  handleBinding,
                  handleError: formatWalletError(
                    cause,
                    "This queued handle transaction is no longer authorized.",
                  ),
                };
              }
            }),
          );
          transactions = inspected.filter(
            (transaction): transaction is DisplayQueuedTransaction => transaction !== null,
          );
          return [{ ...target, policy, transactions, queueError }];
        } catch (cause) {
          return [
            {
              ...target,
              notice: formatWalletError(cause, "The Safe queue could not be verified."),
              retryable: true,
            },
          ];
        }
      },
    })),
  });
  const queue = {
    data: queueQueries.flatMap((query) => query.data ?? []),
    refetch: () => Promise.all(queueQueries.map((query) => query.refetch())),
  };
  const retryQueue = async (target: ProjectSafeQueueTarget) => {
    await queryClient.invalidateQueries({
      queryKey: authorityIdentityQuery(target.chainId, target.safe).queryKey,
      refetchType: "none",
    });
    const index = queueTargets.findIndex(
      (row) =>
        row.chainId === target.chainId &&
        row.safe === target.safe &&
        row.handleOnly === target.handleOnly,
    );
    if (index >= 0) await queueQueries[index].refetch();
  };

  // Relayr can run each chain's next fully signed transaction from one
  // payment. Handle writes and same-nonce alternatives execute on their own.
  const batchRows: BatchRow[] = (queue.data ?? []).flatMap((row) => {
    if (row.handleOnly || "notice" in row) return [];
    const atNonce = row.transactions.filter(
      ({ transaction }) => transaction.nonce === row.policy.nonce,
    );
    if (atNonce.length !== 1) return [];
    const [{ transaction: tx, handleBinding, handleError }] = atNonce;
    if (handleBinding || handleError || safeTransactionHasRefund(tx)) return [];
    if (usableSafeConfirmations(tx, row.policy.owners).length < row.policy.threshold) return [];
    return [{ row, tx }];
  });
  const batchChains = batchRows.map(({ row }) => row.chainId);
  // Each queue's authority rows come from the server sucker-group list: a queue
  // is signed or executed only once its own rows are chain-verified.
  const gate = useGroupWriteGate(
    (queue.data ?? []).flatMap((row) =>
      "transactions" in row && row.transactions.length ? row.authorityRows : [],
    ),
  );
  const rowBlocked = (row: QueueRow) => gate.unverifiedOf(row.authorityRows).length > 0;
  const canBatch =
    batchRows.length >= 2 &&
    new Set(batchChains).size === batchChains.length &&
    batchChains.every(isRelayrSupportedChain) &&
    areRelayrChainsCompatible(batchChains);

  const closeBatch = () => {
    if (payingBatch.current) return;
    batchGeneration.current += 1;
    batchAbort.current?.abort();
    resetRelayr();
    setBatch(null);
  };
  const refreshObsoleteBatch = async () => {
    closeBatch();
    setNotice(
      "The saved Safe transactions are no longer pending. The Safe queue has been refreshed.",
    );
    await queue.refetch();
  };

  const updateBatchProgress = (progress: SafeRelayrProgress, generation: number) => {
    if (generation !== batchGeneration.current) return;
    setBatch((current) => {
      if (!current) return current;
      if (progress.type === "execution") {
        const chainId = progress.execution.entry.chain;
        const status =
          progress.status === "executed"
            ? "Executed"
            : progress.status === "failed"
              ? "Execution failed"
              : progress.status === "confirming"
                ? "Confirming"
                : progress.hash
                  ? "Submitted"
                  : !progress.session.fundingObserved &&
                      (progress.session.paymentStatus === "sending" ||
                        progress.session.paymentStatus === "submitted")
                    ? "Checking payment status…"
                    : "Waiting for execution";
        return {
          ...current,
          status: { ...current.status, [chainId]: status },
          hashes: progress.hash ? { ...current.hashes, [chainId]: progress.hash } : current.hashes,
        };
      }
      const messages: Record<SafeRelayrPhase, string> = {
        reviewing: "Review the executions to get payment options…",
        quoting: "Getting payment options…",
        "payment-review": "Preparing payment…",
        "payment-checking": "Checking before payment…",
        "payment-submitting": "Confirm the payment in your wallet…",
        "payment-confirming": "Waiting for the payment to confirm…",
        executing: "Executing the Safe transactions…",
        complete: `Executed ${current.rows.length} Safe transactions.`,
      };
      const rowStatus =
        progress.phase === "payment-checking"
          ? "Checking…"
          : progress.phase === "payment-confirming"
            ? "Checking payment status…"
            : progress.phase === "payment-review" || progress.phase === "payment-submitting"
              ? "Waiting for payment"
              : undefined;
      return {
        ...current,
        phase: progress.phase,
        message: messages[progress.phase],
        status: rowStatus
          ? Object.fromEntries(current.rows.map(({ row }) => [row.chainId, rowStatus]))
          : current.status,
      };
    });
  };

  /** Shows a saved bundle's phase and each changed row from its controller view, until stopped. */
  const showBundle = (activityId: string, generation: number) => {
    let shown: SafeRelayrView | null = null;
    return watchSafeBundleView(config, activityId, (view) => {
      const last = shown;
      shown = view;
      if (view.phase && view.phase !== last?.phase)
        updateBatchProgress({ type: "phase", phase: view.phase }, generation);
      const session = view.session;
      if (!session) return;
      for (const [index, row] of Object.entries(view.executions)) {
        const execution = session.executions[Number(index)];
        if (execution && row !== last?.executions[Number(index)])
          updateBatchProgress(
            { type: "execution", session, index: Number(index), execution, ...row },
            generation,
          );
      }
    });
  };

  const prepareAll = async (rows: BatchRow[]) => {
    if (!address || payingBatch.current || rows.some(({ row }) => rowBlocked(row))) return;
    const account = address;
    const generation = ++batchGeneration.current;
    batchAbort.current?.abort();
    const abort = new AbortController();
    batchAbort.current = abort;
    const current = () =>
      generation === batchGeneration.current &&
      connectedAccount.current?.toLowerCase() === account.toLowerCase();
    const update = (patch: Partial<BatchRun>) => {
      if (current()) setBatch((batch) => (batch ? { ...batch, ...patch } : batch));
    };
    resetRelayr();
    setBatch({
      rows,
      account,
      preparing: true,
      hashes: {},
      recovery: null,
      quote: null,
      paymentChainId: null,
      status: {},
      running: false,
      done: false,
      message: "Checking the Safe transactions…",
      error: null,
    });
    try {
      const requests = await prepareBatchRequests(rows, account, (chainId, status) => {
        if (!current()) throw new Error("This review was closed or the connected account changed.");
        setBatch((batch) =>
          batch ? { ...batch, status: { ...batch.status, [chainId]: status } } : batch,
        );
      });
      if (!current()) return;
      update({ message: "Review the executions to get payment options…" });
      const quote = await getRelayrTxQuote(requests, {
        signal: abort.signal,
        onProgress: (progress) => updateBatchProgress(progress, generation),
        onStatus: (_index, state, execution) => {
          if (!current()) return;
          const chainId = execution.entry.chain;
          setBatch((batch) =>
            batch
              ? {
                  ...batch,
                  status: {
                    ...batch.status,
                    [chainId]:
                      state === "ready"
                        ? "Ready"
                        : state === "failed"
                          ? "Check failed"
                          : "Checking…",
                  },
                }
              : batch,
          );
        },
      });
      if (!current()) return;
      if (!quote?.payment_info.length) throw new Error("No payment option is available.");
      update({
        quote,
        paymentChainId:
          preselectedRelayrPayment(quote.payment_info, connectedChainId)?.chain ?? null,
        message: "Choose where to pay the quoted network fee, then confirm execution.",
      });
    } catch (cause) {
      if (
        current() &&
        cause instanceof RelayrRecoveryError &&
        cause.safeReleaseReason === "safe-nonces-consumed"
      ) {
        await refreshObsoleteBatch();
        return;
      }
      update({
        message: null,
        error: formatWalletError(cause, "Could not check the Safe transactions."),
        recovery: cause instanceof RelayrRecoveryError ? cause : null,
        recoveryChecks: cause instanceof RelayrRecoveryError ? cause.recovery?.checks : undefined,
      });
    } finally {
      update({ preparing: false });
    }
  };

  const checkExistingBundle = async () => {
    if (!batch?.recovery || batch.preparing || batch.running) return;
    const { recovery, rows, account } = batch;
    const generation = batchGeneration.current;
    const current = () =>
      generation === batchGeneration.current &&
      account.toLowerCase() === connectedAccount.current?.toLowerCase();
    setBatch((current) =>
      current ? { ...current, preparing: true, phase: undefined, error: null } : current,
    );
    const stopShowing = showBundle(recovery.activityId, generation);
    try {
      const checked = await checkRelayrSession(recovery.activityId, batchAbort.current?.signal);
      if (!current()) return;
      if (
        checked?.state === "released" &&
        checked.session.releaseReason === "safe-nonces-consumed"
      ) {
        await refreshObsoleteBatch();
        return;
      }
      const activity = refreshTransactionActivities().find((row) => row.id === recovery.activityId);
      if (
        (checked?.state === "ready" &&
          sameSafeRelayrIntents(
            checked.session.executions,
            rows.map(({ row, tx }) => ({
              entry: { chain: row.chainId, target: row.safe, data: "0x", value: "0" },
              safe: row.safe,
              safeTxHash: safeTransactionHash(row.chainId, row.safe, tx),
              nonce: tx.nonce,
            })),
          )) ||
        activity?.relayrPaymentStatus === "expired" ||
        activity?.relayrDiscardable === "expired" ||
        activity?.relayrDiscardable === "changed"
      ) {
        await prepareAll(rows);
        return;
      }
      setBatch((current) =>
        current
          ? {
              ...current,
              recoveryChecks: checked?.recovery?.checks,
              message:
                checked?.recovery?.message ??
                activity?.message ??
                "The existing bundle could not be located. Its recovery record is still required.",
            }
          : current,
      );
      if (activity?.status === "success" && !activity.manualVerificationRequired) {
        closeBatch();
        setNotice("The existing bundle is confirmed. The Safe queue has been refreshed.");
        await queue.refetch();
      }
    } catch (cause) {
      if (current())
        setBatch((batch) =>
          batch
            ? {
                ...batch,
                error: formatWalletError(cause, "Could not check the existing bundle."),
              }
            : batch,
        );
    } finally {
      stopShowing();
      if (current()) setBatch((batch) => (batch ? { ...batch, preparing: false } : batch));
    }
  };

  const executeAll = async () => {
    if (!batch?.quote || batch.preparing || payingBatch.current || !address) return;
    if (batch.account.toLowerCase() !== address.toLowerCase()) return;
    const { rows, quote } = batch;
    if (rows.some(({ row }) => rowBlocked(row))) return;
    const payment = quote.payment_info.find((option) => option.chain === batch.paymentChainId);
    if (!payment) return;
    const generation = batchGeneration.current;
    const update = (patch: Partial<BatchRun>) => {
      if (generation === batchGeneration.current)
        setBatch((batch) => (batch ? { ...batch, ...patch } : batch));
    };
    const setRowStatus = (chainId: number, status: string) => {
      if (generation === batchGeneration.current)
        setBatch((batch) =>
          batch ? { ...batch, status: { ...batch.status, [chainId]: status } } : batch,
        );
    };
    payingBatch.current = true;
    setBusy("execute-all");
    update({
      running: true,
      phase: undefined,
      error: null,
      message: "Re-checking the Safe transactions…",
    });
    const stopShowing = showBundle(`relayr:${quote.bundle_uuid}`, generation);
    try {
      // sendRelayrTx checks the live account, quote, and Safe execution again before payment.
      await sendRelayrTx(payment, {
        onStatus: (_index, state, execution) =>
          setRowStatus(
            execution.entry.chain,
            state === "ready" ? "Ready" : state === "failed" ? "Check failed" : "Re-checking…",
          ),
      });
      await waitForRelayrBundle(quote.bundle_uuid);
      rows.forEach(({ row }) => setRowStatus(row.chainId, "Executed"));
      resetRelayr();
      update({ done: true, message: `Executed ${rows.length} Safe transactions.` });
      await queue.refetch();
    } catch (cause) {
      update({
        error: formatWalletError(cause, "Could not execute the Safe transactions."),
        message: null,
        recovery: cause instanceof RelayrRecoveryError ? cause : null,
        ...(cause instanceof RelayrRecoveryError ? { quote: null, paymentChainId: null } : {}),
      });
    } finally {
      stopShowing();
      payingBatch.current = false;
      setBusy(null);
      update({ running: false });
    }
  };

  if (!queueTargets.length || (!queue.data.length && queueQueries.every((query) => query.data)))
    return null;

  /** The queued transaction's chain, handle, destination, value and signatures, as its review shows them. */
  const queuedContext = (
    row: QueueRow,
    tx: SafeQueuedTransaction,
    handleBinding = review?.handleBinding,
  ) => [
    { label: "Safe transaction", value: `#${tx.nonce} on ${chainName(row.chainId)}`, strong: true },
    ...(handleBinding
      ? [
          {
            label: "Handle",
            value:
              handleBinding.kind === "ens-text"
                ? `ENS juicebox record → ${handleBinding.value}`
                : `Publish @${handleBinding.handle.handle} → ${handleBinding.source.chainId}:${handleBinding.source.projectId}`,
          },
        ]
      : []),
    { label: "To", value: tx.to, mono: true },
    { label: "Value", value: `${String(tx.value ?? 0)} wei` },
    {
      label: "Signatures",
      value: `${usableSafeConfirmations(tx, row.policy.owners).length}/${row.policy.threshold}`,
    },
  ];

  const sign = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    if (!address || rowBlocked(row)) return;
    const key = `sign:${row.chainId}:${tx.nonce}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      if (safeTransactionHasRefund(tx)) throw new Error(REFUND_REFUSAL);
      await verifyLiveQueuedTransaction(row, tx);
      const policy = await readLiveSafePolicy(row);
      if (!policy.owners.some((owner) => owner.toLowerCase() === address.toLowerCase())) {
        throw new Error("The connected account is not an owner of this Safe.");
      }
      const signature = await signSafeTransactionAsync({
        chainId: row.chainId,
        safe: row.safe,
        tx,
        reverify: async (liveAccount) => {
          await verifyLiveQueuedTransaction(row, tx);
          const confirmed = await readLiveSafePolicy(row);
          if (!sameSafePolicy(policy, confirmed)) {
            throw new Error(
              "The Safe policy changed during review. Inspect the transaction again.",
            );
          }
          if (
            !confirmed.owners.some((owner) => owner.toLowerCase() === liveAccount.toLowerCase())
          ) {
            throw new Error("The connected account is no longer an owner of this Safe.");
          }
        },
      });
      await verifyLiveQueuedTransaction(row, tx);
      await submitSafeConfirmation(row.chainId, row.safe, tx, signature);
      setNotice(`Signed Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`);
      setReview(null);
      await queue.refetch();
    } catch (cause) {
      if (reviewClosed(cause)) setReview(null);
      else setError(formatWalletError(cause, "Could not sign the Safe transaction."));
    } finally {
      setBusy(null);
    }
  };

  const execute = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    if (rowBlocked(row)) return;
    const key = `execute:${row.chainId}:${tx.nonce}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      if (safeTransactionHasRefund(tx)) throw new Error(REFUND_REFUSAL);
      const handleBinding = await verifyLiveQueuedTransaction(row, tx);
      const policy = await readLiveSafePolicy(row);
      if (policy.nonce !== tx.nonce) {
        throw new Error(`Safe nonce ${policy.nonce} must execute first.`);
      }
      if (usableSafeConfirmations(tx, policy.owners).length < policy.threshold) {
        throw new Error("The transaction no longer has enough current-owner confirmations.");
      }
      requireNoViewAs();
      // Core reviews the exact execution, holds it by its Safe transaction, rechecks the Safe's
      // policy and nonce and simulates it before the wallet opens, and counts it done only on the
      // Safe's own success event for this hash.
      const { executeReviewedSafeTransaction } = await loadEngine();
      const { connector, address: sender } = getAccount(config);
      // Without an account, the check at the wallet below refuses the send.
      const wallet = sender ? reviewedWalletAdapter(config, sender, connector) : deps.adapter;
      let journaled: string | undefined;
      const result = await executeReviewedSafeTransaction(
        { chainId: row.chainId, safe: row.safe, tx, context: queuedContext(row, tx) },
        {
          ...deps,
          adapter: {
            ...wallet,
            // This queue's own checks run again at the wallet, after the review.
            sendTransaction: async (sent) => {
              await verifyLiveQueuedTransaction(row, tx);
              requireNoViewAs();
              const live = getAccount(config);
              if (!sender || live.address?.toLowerCase() !== sender.toLowerCase())
                throw new ReviewRefusal(WALLET_CHANGED);
              const hash = await wallet.sendTransaction(sent);
              journaled = recordSubmittedWrite(
                {
                  chainId: sent.chainId,
                  to: sent.to,
                  data: sent.data,
                  value: sent.value,
                  intent: safeExecutionIntent({
                    chainId: row.chainId,
                    safe: row.safe,
                    safeTxHash: safeTransactionHash(row.chainId, row.safe, tx),
                  }),
                } as ReviewedCall,
                hash,
                sender,
                `Execute Safe transaction #${tx.nonce}`,
                false,
              );
              return hash;
            },
          },
        },
      );
      if (journaled && result.status === "done") settleSubmittedWrite(journaled, "success");
      if (result.status === "proposed") {
        setNotice(`Proposed the execution of Safe transaction #${tx.nonce} to your Safe.`);
        setReview(null);
        return;
      }
      const receipt = result.receipts.at(-1);
      if (handleBinding && receipt)
        await verifyQueuedProjectHandlePostcondition({
          binding: handleBinding,
          safe: row.safe,
          transaction: tx,
          clientFor: publicClientFor,
          executionBlockNumber: receipt.blockNumber,
        });
      setNotice(`Executed Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`);
      setReview(null);
      await queue.refetch();
    } catch (cause) {
      if (reviewClosed(cause)) setReview(null);
      else setError(formatWalletError(cause, "Could not execute the Safe transaction."));
    } finally {
      setBusy(null);
    }
  };

  const batchAction = batch
    ? batch.running
      ? batch.phase === "payment-review"
        ? "Preparing payment…"
        : batch.phase === "payment-submitting"
          ? "Confirm payment…"
          : batch.phase === "payment-confirming"
            ? "Confirming payment…"
            : batch.phase === "executing" || batch.phase === "complete"
              ? "Executing…"
              : "Checking…"
      : batch.preparing
        ? null
        : batch.recovery
          ? batch.recovery.bundleUuid
            ? "Check status"
            : "Check Safe nonces"
          : batch.quote
            ? "Pay"
            : "Retry checks"
    : null;

  return (
    <OperatorSection title="Pending multisig transactions">
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-melon-800">
          Safe signers can inspect, co-sign, and execute operator proposals without leaving Revnet.
        </p>
        {viaSafeApp ? (
          <p className="w-full text-sm text-melon-800">
            You are connected as a Safe. Its owners sign and execute these in
            Safe&#123;Wallet&#125;: use Open in Safe on each chain.
          </p>
        ) : null}
        {gate.pending ? (
          <p className="w-full text-sm text-zinc-600" role="status">
            Confirming this project&apos;s chains onchain…
          </p>
        ) : gate.line ? (
          <p className="w-full text-sm text-zinc-600">{gate.line}</p>
        ) : null}
        {canBatch && !viaSafeApp ? (
          <button
            type="button"
            className="bg-melon-700 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={busy !== null || !address || batchRows.some(({ row }) => rowBlocked(row))}
            onClick={() => void prepareAll(structuredClone(batchRows))}
          >
            Execute {batchRows.length} ready
          </button>
        ) : null}
      </div>
      <div className="mt-4 divide-y divide-melon-200">
        {queueQueries.map((query, index) =>
          !query.data ? (
            <div
              key={`loading:${queueTargets[index].chainId}:${queueTargets[index].safe}`}
              className="py-3 text-sm first:pt-0 last:pb-0"
            >
              <span className="font-bold">
                {queueTargets[index].handleOnly
                  ? "Ethereum handles"
                  : chainName(queueTargets[index].chainId)}
              </span>
              <p className="mt-2 text-zinc-500">Checking Safe queue…</p>
            </div>
          ) : null,
        )}
        {queue.data.map((row) => (
          <div key={`${row.chainId}:${row.safe}`} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">
                {row.handleOnly ? "Ethereum handles" : chainName(row.chainId)}
                {"notice" in row ? null : ` | nonce ${row.policy.nonce}`}
              </span>
              {!("notice" in row) && safeQueueUrl(row.chainId, row.safe) ? (
                <a
                  className="text-xs underline"
                  target="_blank"
                  rel="noreferrer"
                  href={safeQueueUrl(row.chainId, row.safe)!}
                >
                  Open in Safe ↗
                </a>
              ) : null}
            </div>
            {"notice" in row ? (
              <div className="mt-2 text-sm text-zinc-500">
                <p>{row.notice}</p>
                {row.retryable ? (
                  <button
                    type="button"
                    className="mt-2 underline"
                    aria-label={`Retry ${chainName(row.chainId)} queue`}
                    onClick={() => void retryQueue(row)}
                  >
                    Retry queue checks
                  </button>
                ) : null}
              </div>
            ) : row.queueUnavailable ? (
              <p className="mt-2 text-sm text-zinc-500">{queueUnavailableMessage(row.chainId)}</p>
            ) : row.queueError ? (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {row.queueError}
                {safeQueueUrl(row.chainId, row.safe)
                  ? " Use Open in Safe above to inspect the queue."
                  : " Inspect this Safe in a client that supports this chain."}
                <button
                  type="button"
                  className="mt-2 block underline"
                  aria-label={`Retry ${chainName(row.chainId)} queue`}
                  onClick={() => void retryQueue(row)}
                >
                  Retry queue checks
                </button>
              </p>
            ) : row.transactions.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                {row.handleOnly ? "No pending handle transactions." : "No pending transactions."}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-melon-100">
                {row.transactions.map(({ transaction: tx, handleBinding, handleError }) => {
                  const confirmations = usableSafeConfirmations(tx, row.policy.owners);
                  const signed = confirmations.some(
                    (confirmation) =>
                      address && confirmation.owner.toLowerCase() === address.toLowerCase(),
                  );
                  const ready = confirmations.length >= row.policy.threshold;
                  const current = tx.nonce === row.policy.nonce;
                  const refund = safeTransactionHasRefund(tx);
                  return (
                    <li key={`${tx.nonce}:${tx.safeTxHash ?? tx.data}`} className="py-3 text-xs">
                      <details>
                        <summary className="cursor-pointer font-bold">
                          #{tx.nonce} | {queueLabel(row.chainId, tx)} | {confirmations.length}/
                          {row.policy.threshold} signatures
                          <QueuedCallSummary chainId={row.chainId} tx={tx} />
                        </summary>
                        {handleBinding ? (
                          <p className="mt-2 font-medium text-melon-800">
                            {handleBinding.kind === "ens-text"
                              ? `ENS juicebox record → ${handleBinding.value}`
                              : `Publish @${handleBinding.handle.handle} → ${handleBinding.source.chainId}:${handleBinding.source.projectId}`}
                          </p>
                        ) : null}
                        <div className="mt-2 break-all border border-melon-200 p-2 font-mono">
                          <p>To: {tx.to}</p>
                          <p>Value: {String(tx.value ?? 0)} wei</p>
                          <p>Data: {tx.data ?? "0x"}</p>
                        </div>
                      </details>
                      <p className="mt-1 text-zinc-600">
                        Signed:{" "}
                        {confirmations.length ? (
                          <SignerList
                            owners={confirmations.map((confirmation) => confirmation.owner)}
                            you={address}
                          />
                        ) : (
                          "none"
                        )}
                        {!ready ? (
                          <>
                            {" | "}needs {row.policy.threshold - confirmations.length} of:{" "}
                            <SignerList
                              owners={row.policy.owners.filter(
                                (owner) =>
                                  !confirmations.some((confirmation) =>
                                    isAddressEqual(confirmation.owner, owner),
                                  ),
                              )}
                              you={address}
                            />
                          </>
                        ) : null}
                      </p>
                      {handleError ? (
                        <p className="mt-2 text-red-700" role="alert">
                          Handle transaction blocked: {handleError}
                        </p>
                      ) : refund ? (
                        <p className="mt-2 text-red-700" role="alert">
                          {REFUND_REFUSAL}
                        </p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        {!viaSafeApp && !handleError && !refund && !signed && !ready ? (
                          <button
                            type="button"
                            className="border border-melon-500 px-3 py-1 disabled:opacity-50"
                            disabled={busy !== null || !address || rowBlocked(row)}
                            onClick={() => {
                              setError(null);
                              setReview({ kind: "sign", row, tx, handleBinding });
                            }}
                          >
                            {busy === `sign:${row.chainId}:${tx.nonce}` ? "Signing…" : "Sign"}
                          </button>
                        ) : null}
                        {signed && !ready ? (
                          <span className="py-1 text-zinc-600">You signed</span>
                        ) : null}
                        {!viaSafeApp && !handleError && !refund && ready ? (
                          <button
                            type="button"
                            className="bg-melon-700 px-3 py-1 text-white disabled:opacity-50"
                            disabled={busy !== null || !current || !address || rowBlocked(row)}
                            title={
                              current ? undefined : `Nonce ${row.policy.nonce} must execute first.`
                            }
                            onClick={() => {
                              setError(null);
                              setReview({ kind: "execute", row, tx, handleBinding });
                            }}
                          >
                            {busy === `execute:${row.chainId}:${tx.nonce}`
                              ? "Executing…"
                              : "Execute"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
      {notice ? <p className="mt-3 text-sm text-melon-800">{notice}</p> : null}
      {error && !review ? (
        <p className="mt-3 text-sm text-peel-700" role="alert">
          {error}
        </p>
      ) : null}
      {review ? (
        <TxProgress
          open
          onClose={() => setReview(null)}
          title={review.kind === "sign" ? "Confirm signature" : "Confirm execution"}
          steps={[
            review.kind === "sign"
              ? {
                  title: `Sign Safe transaction #${review.tx.nonce}`,
                  detail: "Adds your confirmation to the Safe queue.",
                }
              : {
                  title: `Execute Safe transaction #${review.tx.nonce}`,
                  detail: "Runs the queued call from the Safe.",
                },
          ]}
          activeIndex={busy ? 0 : -1}
          start={() =>
            void (review.kind === "sign"
              ? sign(review.row, review.tx)
              : execute(review.row, review.tx))
          }
          busy={busy !== null}
          error={error}
          rows={queuedContext(review.row, review.tx)}
        />
      ) : null}
      {batch ? (
        <TxProgress
          open
          onClose={closeBatch}
          title={`Execute ${batch.rows.length} Safe transactions`}
          stepsIntro="One payment runs each chain's next fully signed transaction. Later nonces need a new review after these land."
          steps={batch.rows.map(({ row, tx }) => ({
            key: String(row.chainId),
            title: `${chainName(row.chainId)} #${tx.nonce}`,
            status: (
              <span role="status" aria-atomic="true">
                <span className="sr-only">{chainName(row.chainId)}: </span>
                {batch.status[row.chainId] ?? "Waiting"}
              </span>
            ),
            detail: (
              <>
                <span className="block text-sm text-zinc-600">{queueLabel(row.chainId, tx)}</span>
                <QueuedCallSummary chainId={row.chainId} tx={tx} />
                {batch.hashes[row.chainId] ? (
                  <a
                    className="mt-2 inline-block underline"
                    href={etherscanLink(batch.hashes[row.chainId], {
                      type: "tx",
                      chainId: row.chainId,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View transaction ↗
                  </a>
                ) : null}
              </>
            ),
          }))}
          activeIndex={-1}
          busy={batch.running}
          complete={batch.done}
          status={batch.message}
          error={batch.error}
          footerContent={
            // The Relayr bundle's fee chain and its step; R5 moves both into core's review.
            batch.done ? null : (
              <div className="space-y-3">
                {batch.quote && !batch.done ? (
                  <label className="block text-sm">
                    Pay network fee on
                    <select
                      className="mt-2 block w-fit max-w-full border border-melon-300 bg-white p-2"
                      value={batch.paymentChainId ?? ""}
                      disabled={batch.running}
                      onChange={(event) =>
                        setBatch((current) =>
                          current
                            ? {
                                ...current,
                                paymentChainId: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="" disabled>
                        Select a payment chain
                      </option>
                      {relayrPaymentOptions(batch.quote.payment_info).map((option) => (
                        <option key={option.chainId} value={option.chainId}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {batchAction ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={
                        batch.running ||
                        batch.preparing ||
                        batch.account.toLowerCase() !== address?.toLowerCase() ||
                        Boolean(batch.quote && batch.paymentChainId === null)
                      }
                      onClick={() =>
                        void (batch.recovery
                          ? checkExistingBundle()
                          : batch.quote
                            ? executeAll()
                            : prepareAll(batch.rows))
                      }
                    >
                      {batchAction}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          }
        >
          {batch.recovery ? (
            <div className="space-y-2 border border-melon-300 p-3 text-sm">
              {batch.recovery.bundleUuid ? (
                <>
                  <p>
                    A previous bundle contains one or more of these executions. Check that bundle
                    before preparing another payment.
                  </p>
                  <SummaryRow label="Existing bundle">
                    <span className="break-all">{batch.recovery.bundleUuid}</span>
                  </SummaryRow>
                </>
              ) : (
                <p>
                  The earlier quote response was not saved, so its bundle cannot be located. Check
                  whether these saved Safe transactions are still pending before preparing another
                  payment.
                </p>
              )}
              {batch.recovery.safeExecutions.map(({ chainId, safe, nonce }) => {
                const url = safeQueueUrl(chainId, safe);
                const check = batch.recoveryChecks?.find(
                  (check) =>
                    check.chainId === chainId &&
                    check.safe.toLowerCase() === safe.toLowerCase() &&
                    check.nonce === nonce,
                );
                return (
                  <SummaryRow
                    key={`${chainId}:${safe}:${nonce}`}
                    label={`${chainName(chainId)} #${nonce}`}
                  >
                    {check ? (
                      <span>
                        {check.state === "consumed"
                          ? "No longer pending"
                          : check.state === "live"
                            ? "Still pending"
                            : "Check unavailable"}
                        .{" "}
                      </span>
                    ) : null}
                    {url ? (
                      <a className="underline" href={url} target="_blank" rel="noopener noreferrer">
                        Open in Safe ↗
                      </a>
                    ) : (
                      <span>Safe queue unavailable</span>
                    )}
                  </SummaryRow>
                );
              })}
            </div>
          ) : null}
        </TxProgress>
      ) : null}
    </OperatorSection>
  );
}
