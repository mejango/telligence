"use client";

import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useReviewedSafeSignature } from "@/hooks/useReviewedSafeSignature";
import { requireOnchainExecution, useWriteContract } from "@/hooks/useReviewedWriteContract";
import {
  readAuthorityIdentity,
  readBoundedSafeNonce,
  readCrossChainHandleAuthority,
  type SafeAuthorityIdentity,
} from "@/lib/cross-chain-authority";
import { PROJECT_HANDLE_CHAIN_ID } from "@/lib/projectHandles";
import {
  bindingMatchesProject,
  classifyQueuedProjectHandleTransaction,
  projectSafeQueueTargets,
  verifyQueuedProjectHandleBinding,
  verifyQueuedProjectHandlePostcondition,
  type ProjectSafeQueueTarget,
  type QueuedProjectHandleBinding,
} from "@/lib/queuedProjectHandle";
import {
  SAFE_EXEC_ABI,
  listPendingSafeTransactions,
  requireSafeExecutionSuccess,
  safeExecutionArgs,
  safeQueueLink,
  safeTransactionHash,
  submitSafeConfirmation,
  usableSafeConfirmations,
  type SafePolicy,
  type SafeQueuedTransaction,
} from "@/lib/safe-queue";
import {
  failTransactionActivityVerification,
  holdTransactionActivityForVerification,
  releaseTransactionActivityVerification,
} from "@/lib/transaction-activity";
import { requireTransactionReview } from "@/lib/transaction-review";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { encodeFunctionData, isAddressEqual, type Hex } from "viem";
import { useAccount } from "wagmi";
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

type QueueRow = ProjectSafeQueueTarget & {
  policy: SafePolicy;
  transactions: DisplayQueuedTransaction[];
  queueError?: string;
};

type LiveSafePolicy = SafePolicy & { identity: SafeAuthorityIdentity };

type ReviewedExecution = {
  policy: LiveSafePolicy;
  target: ProjectSafeQueueTarget;
  transaction: SafeQueuedTransaction;
  handleBinding: QueuedProjectHandleBinding | null;
};

async function readLiveSafePolicy(
  row: Pick<QueueRow, "chainId" | "safe" | "authorityRows" | "handleOnly">,
): Promise<LiveSafePolicy> {
  const mainnetClient = publicClientFor(PROJECT_HANDLE_CHAIN_ID);
  let hasLiveAuthority = false;
  for (const authorityRow of row.authorityRows) {
    const sourceClient = publicClientFor(authorityRow.chainId);
    if (!(await isLiveRevnetOperator(sourceClient, authorityRow, row.safe))) continue;
    if (!row.handleOnly) {
      hasLiveAuthority = true;
      break;
    }
    const authority = await readCrossChainHandleAuthority({
      sourceChainId: authorityRow.chainId,
      sourceClient,
      mainnetClient,
      authority: row.safe,
    });
    if (authority.status === "valid-safe") {
      hasLiveAuthority = true;
      break;
    }
  }
  if (!hasLiveAuthority) {
    throw new Error("This Safe is no longer the live revnet operator.");
  }
  const client = publicClientFor(row.chainId);
  const identity = await readAuthorityIdentity(client, row.safe);
  if (identity?.kind !== "safe") {
    throw new Error("The operator no longer has a supported canonical Safe identity.");
  }
  const nonce = await readBoundedSafeNonce(client, row.safe);
  if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The Safe nonce could not be verified.");
  }
  return {
    identity,
    owners: identity.owners,
    threshold: identity.threshold,
    nonce: Number(nonce),
  };
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

export function SafeQueueCard({
  rows,
  fallbackOperator,
  fallbackProject,
}: {
  rows: ChainProjectRow[];
  fallbackOperator?: string;
  fallbackProject: ChainProjectRow;
}) {
  const { address } = useAccount();
  const { signSafeTransactionAsync } = useReviewedSafeSignature();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    kind: "sign" | "execute";
    row: QueueRow;
    tx: SafeQueuedTransaction;
    handleBinding: QueuedProjectHandleBinding | null;
  } | null>(null);
  const reviewedExecution = useRef<ReviewedExecution | null>(null);
  const operators = useLiveRevnetOperators(rows, {
    ...fallbackProject,
    address: fallbackOperator,
  });
  const { operatorByChain } = operators;
  const operatorKey = `${rows
    .map((row) => `${row.chainId}:${row.projectId}:${operatorByChain.get(row.chainId) ?? ""}`)
    .join(",")}|handle:${fallbackProject.chainId}:${fallbackProject.projectId}`;
  const queueTargets = projectSafeQueueTargets(
    rows.flatMap((row) => {
      const safe = operatorByChain.get(row.chainId);
      return safe ? [{ ...row, safe }] : [];
    }),
    fallbackProject,
  );
  const { writeContractAsync } = useWriteContract({
    reviewedInParent: true,
    manualReceiptVerification: () => Boolean(reviewedExecution.current?.handleBinding),
    reverify: async (variables) => {
      const reviewed = reviewedExecution.current;
      if (!reviewed) {
        throw new Error("The reviewed Safe execution is no longer available.");
      }
      if (
        Number(variables.chainId) !== reviewed.target.chainId ||
        !isAddressEqual(reviewed.target.safe, variables.address)
      ) {
        throw new Error("The reviewed Safe execution target changed before submission.");
      }
      if (
        variables.functionName !== "execTransaction" ||
        !variables.args ||
        (variables.value !== undefined && BigInt(variables.value) !== 0n)
      ) {
        throw new Error("The reviewed Safe execution call changed before submission.");
      }
      const submittedData = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args: variables.args as ReturnType<typeof safeExecutionArgs>,
      });
      const expectedData = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args: safeExecutionArgs(reviewed.transaction, reviewed.policy.owners),
      });
      if (submittedData.toLowerCase() !== expectedData.toLowerCase()) {
        throw new Error("The reviewed queued transaction changed before submission.");
      }
      const confirmed = await readLiveSafePolicy(reviewed.target);
      if (!sameSafePolicy(reviewed.policy, confirmed)) {
        throw new Error("The Safe policy changed during review. Inspect the transaction again.");
      }
      await verifyLiveQueuedTransaction(reviewed.target, reviewed.transaction);
    },
  });

  const queue = useQuery({
    queryKey: ["revnet-safe-queues", operatorKey],
    enabled: !operators.isLoading && queueTargets.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<QueueRow[]> => {
      const results = await Promise.all(
        queueTargets.map(async (target): Promise<QueueRow | null> => {
          try {
            const livePolicy = await readLiveSafePolicy(target);
            const policy = {
              owners: livePolicy.owners,
              threshold: livePolicy.threshold,
              nonce: livePolicy.nonce,
            };
            let transactions: DisplayQueuedTransaction[] = [];
            let queueError: string | undefined;
            try {
              const pending = await listPendingSafeTransactions(
                target.chainId,
                target.safe,
                policy.nonce,
              );
              const inspected = await Promise.all(
                pending.map(async (transaction): Promise<DisplayQueuedTransaction | null> => {
                  let handleBinding: QueuedProjectHandleBinding | null = null;
                  try {
                    handleBinding = classifyQueuedProjectHandleTransaction(
                      target.chainId,
                      transaction,
                    );
                  } catch (cause) {
                    if (target.handleOnly) return null;
                    return {
                      transaction,
                      handleBinding: null,
                      handleError:
                        cause instanceof Error
                          ? cause.message
                          : "This queued handle transaction could not be decoded safely.",
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
                      handleError:
                        cause instanceof Error
                          ? cause.message
                          : "This queued handle transaction is no longer authorized.",
                    };
                  }
                }),
              );
              transactions = inspected.filter(
                (transaction): transaction is DisplayQueuedTransaction => transaction !== null,
              );
            } catch (cause) {
              queueError =
                cause instanceof Error ? cause.message : "Safe queue service is unavailable.";
            }
            return {
              ...target,
              policy,
              transactions,
              queueError,
            };
          } catch {
            return null;
          }
        }),
      );
      return results.filter((row): row is QueueRow => row !== null);
    },
  });

  if (queue.isLoading || !queue.data?.length) return null;

  const sign = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    if (!address) return;
    const key = `sign:${row.chainId}:${tx.nonce}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
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
      await submitSafeConfirmation(row.chainId, tx, signature);
      setNotice(`Signed Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`);
      setReview(null);
      await queue.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign the Safe transaction.");
    } finally {
      setBusy(null);
    }
  };

  const execute = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    const key = `execute:${row.chainId}:${tx.nonce}`;
    let handleExecutionHash: Hex | undefined;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const handleBinding = await verifyLiveQueuedTransaction(row, tx);
      const policy = await readLiveSafePolicy(row);
      if (policy.nonce !== Number(tx.nonce)) {
        throw new Error(`Safe nonce ${policy.nonce} must execute first.`);
      }
      if (usableSafeConfirmations(tx, policy.owners).length < policy.threshold) {
        throw new Error("The transaction no longer has enough current-owner confirmations.");
      }
      const expectedSafeTxHash = safeTransactionHash(row.chainId, row.safe, tx);
      const args = safeExecutionArgs(tx, policy.owners);
      const data = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args,
      });
      await requireTransactionReview({
        title: "Review Safe execution",
        description:
          "The outer call executes the exact queued destination shown below. Same-nonce alternatives remain unexecuted.",
        confirmLabel: "Agree & execute Safe transaction",
        authorization: {
          safe: row.safe,
          nonce: tx.nonce,
          safeTxHash: expectedSafeTxHash,
          destinationCall: {
            to: tx.to,
            value: tx.value,
            data: tx.data ?? "0x",
            operation: tx.operation,
          },
        },
        calls: [
          {
            chainId: row.chainId,
            to: row.safe,
            value: 0n,
            data,
            abi: SAFE_EXEC_ABI,
            functionName: "execTransaction",
            args,
            label: `Execute Safe transaction #${tx.nonce}`,
            contractName: "Safe",
          },
        ],
      });
      await verifyLiveQueuedTransaction(row, tx);
      const confirmedPolicy = await readLiveSafePolicy(row);
      if (!sameSafePolicy(policy, confirmedPolicy)) {
        throw new Error("The Safe policy changed during review. Inspect the transaction again.");
      }
      reviewedExecution.current = {
        policy: confirmedPolicy,
        target: row,
        transaction: tx,
        handleBinding,
      };
      try {
        const hash = await writeContractAsync({
          chainId: row.chainId,
          address: row.safe,
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          args,
        });
        if (handleBinding) {
          requireOnchainExecution(hash, "Execute queued project-handle transaction");
          handleExecutionHash = hash;
          holdTransactionActivityForVerification(
            hash,
            "Confirming the exact Safe event and project-handle result.",
          );
          const receipt = await waitForReceiptWithRetry(publicClientFor(row.chainId), hash);
          requireSafeExecutionSuccess(receipt, row.safe, expectedSafeTxHash);
          await verifyQueuedProjectHandlePostcondition({
            binding: handleBinding,
            safe: row.safe,
            transaction: tx,
            clientFor: publicClientFor,
            executionBlockNumber: receipt.blockNumber,
          });
          releaseTransactionActivityVerification(
            hash,
            "Safe execution and the exact project-handle result were confirmed onchain.",
          );
          handleExecutionHash = undefined;
        }
      } finally {
        reviewedExecution.current = null;
      }
      setNotice(
        `${handleBinding ? "Executed" : "Submitted"} Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`,
      );
      setReview(null);
      await queue.refetch();
    } catch (cause) {
      if (handleExecutionHash) {
        failTransactionActivityVerification(
          handleExecutionHash,
          "The Safe transaction was submitted, but its exact event or handle result failed verification. Inspect it and do not submit it again yet.",
        );
      }
      setError(cause instanceof Error ? cause.message : "Could not execute the Safe transaction.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <OperatorSection title="Pending multisig transactions">
      <p className="mt-1 text-sm text-melon-800">
        Safe signers can inspect, co-sign, and execute operator proposals without leaving Revnet.
      </p>
      <div className="mt-4 space-y-4">
        {queue.data.map((row) => (
          <div key={`${row.chainId}:${row.safe}`} className="border border-melon-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">
                {row.handleOnly ? "Ethereum handles" : chainName(row.chainId)} | nonce{" "}
                {row.policy.nonce}
              </span>
              {safeQueueLink(row.chainId, row.safe) ? (
                <a
                  className="text-xs underline"
                  target="_blank"
                  rel="noreferrer"
                  href={safeQueueLink(row.chainId, row.safe)!}
                >
                  Safe fallback ↗
                </a>
              ) : null}
            </div>
            {row.queueError ? (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {row.queueError}
                {safeQueueLink(row.chainId, row.safe)
                  ? " Use the Safe fallback above to inspect the queue."
                  : " Inspect this Safe in a client that supports this chain."}
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
                  const current = Number(tx.nonce) === row.policy.nonce;
                  return (
                    <li key={`${tx.nonce}:${tx.safeTxHash ?? tx.data}`} className="py-3 text-xs">
                      <details>
                        <summary className="cursor-pointer font-bold">
                          #{tx.nonce} | {tx.data?.slice(0, 10) ?? "0x"} | {confirmations.length}/
                          {row.policy.threshold} signatures
                        </summary>
                        {handleBinding ? (
                          <p className="mt-2 font-medium text-melon-800">
                            {handleBinding.kind === "ens-text"
                              ? `ENS juicebox record → ${handleBinding.value}`
                              : `Publish @${handleBinding.handle.handle} → ${handleBinding.source.chainId}:${handleBinding.source.projectId}`}
                          </p>
                        ) : null}
                        <div className="mt-2 break-all bg-melon-50 p-2 font-mono">
                          <p>To: {tx.to}</p>
                          <p>Value: {String(tx.value ?? 0)} wei</p>
                          <p>Data: {tx.data ?? "0x"}</p>
                        </div>
                      </details>
                      {handleError ? (
                        <p className="mt-2 text-red-700" role="alert">
                          Handle transaction blocked: {handleError}
                        </p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        {!handleError && !signed && !ready ? (
                          <button
                            type="button"
                            className="border border-melon-500 px-3 py-1 disabled:opacity-50"
                            disabled={busy !== null || !address}
                            onClick={() => {
                              setError(null);
                              setReview({ kind: "sign", row, tx, handleBinding });
                            }}
                          >
                            {busy === `sign:${row.chainId}:${tx.nonce}` ? "Signing…" : "Sign"}
                          </button>
                        ) : null}
                        {!handleError && ready ? (
                          <button
                            type="button"
                            className="bg-melon-700 px-3 py-1 text-white disabled:opacity-50"
                            disabled={busy !== null || !current}
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
        <TxConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setReview(null);
          }}
          title={review.kind === "sign" ? "Confirm signature" : "Confirm execution"}
          chainId={review.row.chainId as JBChainId}
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
          action={review.kind === "sign" ? "Sign" : "Execute"}
          onConfirm={() =>
            void (review.kind === "sign"
              ? sign(review.row, review.tx)
              : execute(review.row, review.tx))
          }
          busy={busy !== null}
          error={error}
        >
          <SummaryRow label="Safe transaction">
            #{review.tx.nonce} on {chainName(review.row.chainId)}
          </SummaryRow>
          {review.handleBinding ? (
            <SummaryRow label="Handle">
              {review.handleBinding.kind === "ens-text"
                ? `ENS juicebox record → ${review.handleBinding.value}`
                : `Publish @${review.handleBinding.handle.handle} → ${review.handleBinding.source.chainId}:${review.handleBinding.source.projectId}`}
            </SummaryRow>
          ) : null}
          <SummaryRow label="To">
            <span className="break-all font-mono text-xs">{review.tx.to}</span>
          </SummaryRow>
          <SummaryRow label="Value">{String(review.tx.value ?? 0)} wei</SummaryRow>
          <SummaryRow label="Signatures">
            {usableSafeConfirmations(review.tx, review.row.policy.owners).length}/
            {review.row.policy.threshold}
          </SummaryRow>
        </TxConfirmDialog>
      ) : null}
    </OperatorSection>
  );
}
