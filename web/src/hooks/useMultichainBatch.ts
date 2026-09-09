"use client";

import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import {
  isSafeConnection,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { gasWithHeadroom } from "@/lib/gas";
import {
  batchCallKey,
  createMultichainBatch,
  findPendingBatch,
  removeUnsubmittedBatch,
  saveMultichainBatch,
  type FrozenBatchCall,
  type MultichainBatch,
  type MultichainCall,
} from "@/lib/multichain-batch";
import { verifyActionReceipt, verifyCallPreconditions } from "@/lib/multichain-guards";
import type { JBChainId } from "@/lib/nana/types";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import {
  recordTransactionActivity,
  refreshTransactionActivities,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import { chooseRelayrPayment, requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { useCallback, useRef, useState } from "react";
import {
  decodeEventLog,
  decodeFunctionData,
  isAddressEqual,
  parseAbi,
  type Hash,
  type PublicClient,
} from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

export type BatchResult = {
  status: "success" | "pending";
  hashes: Array<{ chainId: number; hash: Hash; callIndex: number }>;
};
type BatchInput = {
  label: string;
  scope: string;
  calls: MultichainCall[];
  onProgress?: (message: string) => void;
};
const running = new Set<string>();
const SAFE_ABI = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool)",
  "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
]);

function explicitRejection(cause: unknown): boolean {
  const seen = new Set<unknown>();
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    const error = cause as { code?: number; cause?: unknown };
    if (error.code === 4001) return true;
    cause = error.cause;
  }
  return false;
}

async function verifyDirectResult(
  client: PublicClient,
  batch: MultichainBatch,
  call: FrozenBatchCall,
): Promise<Hash> {
  let hash = call.hash!;
  const safe = call.state === "safe";
  if (safe) {
    const activity = refreshTransactionActivities().find(
      (row) =>
        row.safeProposalHash?.toLowerCase() === call.hash?.toLowerCase() &&
        row.chainId === call.chainId,
    );
    if (!activity?.executionHash)
      throw new Error(
        "The saved Safe proposal still needs approvals and execution. Resume after it executes; do not propose it again.",
      );
    hash = activity.executionHash;
  }
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    receipt.status !== "success" ||
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
    const decoded = decodeFunctionData({ abi: SAFE_ABI, data: transaction.input });
    if (
      !transaction.to ||
      !isAddressEqual(transaction.to, batch.account) ||
      decoded.functionName !== "execTransaction" ||
      !isAddressEqual(decoded.args[0], call.address) ||
      decoded.args[1] !== (call.value ?? 0n) ||
      decoded.args[2].toLowerCase() !== call.data.toLowerCase() ||
      decoded.args[3] !== 0
    )
      throw new Error("The Safe execution does not match the saved destination call.");
    const success = receipt.logs.some((log) => {
      if (!isAddressEqual(log.address, batch.account)) return false;
      try {
        return (
          decodeEventLog({
            abi: SAFE_ABI,
            eventName: "ExecutionSuccess",
            topics: log.topics,
            data: log.data,
          }).args.txHash.toLowerCase() === call.hash?.toLowerCase()
        );
      } catch {
        return false;
      }
    });
    if (!success) throw new Error("The exact Safe proposal has not executed successfully.");
  } else if (
    !transaction.to ||
    !isAddressEqual(transaction.to, call.address) ||
    !isAddressEqual(transaction.from, batch.account) ||
    transaction.input.toLowerCase() !== call.data.toLowerCase() ||
    transaction.value !== (call.value ?? 0n)
  )
    throw new Error("The saved transaction does not match the exact reviewed call.");
  await verifyActionReceipt(
    client,
    receipt,
    call.address,
    call.expectedDeployment,
    call.rejectEvents,
    call.reservedReceipt,
    call.expectedPayout,
  );
  updateTransactionActivity(`tx:${call.chainId}:${call.hash!.toLowerCase()}`, {
    status: "success",
    manualVerificationRequired: false,
    executionHash: safe ? hash : undefined,
    message: "The exact transaction and every required recipient result were verified.",
  });
  return hash;
}

/** One frozen job, explicit rounds, one payment per independent multichain round. */
export function useMultichainBatch() {
  const config = useConfig();
  const [isPending, setIsPending] = useState(false);
  const direct = useRef<{ batch: MultichainBatch; index: number } | null>(null);
  const { getRelayrTxQuote } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const { writeContractAsync } = useWriteContract({
    manualReceiptVerification: () => true,
    allowSafeManualReceiptVerification: true,
    reverify: async () => {
      const active = direct.current;
      if (!active) throw new Error("The saved batch call is unavailable.");
      const call = active.batch.calls[active.index];
      const client = getPublicClient(config, { chainId: call.chainId });
      if (!client) throw new Error("Destination RPC unavailable.");
      await verifyCallPreconditions(client, call.preconditions);
    },
    beforeSubmission: async () => {
      const active = direct.current;
      if (!active) throw new Error("The saved batch call is unavailable.");
      const call = active.batch.calls[active.index];
      const client = getPublicClient(config, { chainId: call.chainId });
      if (!client) throw new Error("Destination RPC unavailable.");
      await verifyCallPreconditions(client, call.preconditions);
      const live = getAccount(config);
      if (
        live.address?.toLowerCase() !== active.batch.account.toLowerCase() ||
        live.chainId !== active.batch.calls[active.index].chainId
      )
        throw new Error(
          "The account or chain changed before submission. Resume with the reviewed account.",
        );
      active.batch.calls[active.index].state = "submitting";
      saveMultichainBatch(active.batch);
    },
  });
  const getPendingBatch = useCallback(
    (scope: string) => {
      const account = getAccount(config).address;
      if (!account) return undefined;
      const batch = findPendingBatch(account, scope);
      return batch
        ? {
            label: batch.label,
            total: batch.calls.length,
            completed: batch.calls.filter((call) => call.state === "success").length,
          }
        : undefined;
    },
    [config],
  );

  const runBatch = useCallback(
    async (input: BatchInput): Promise<BatchResult> => {
      requireNoViewAs();
      const account = getAccount(config).address;
      if (!account) throw new Error("Connect a wallet first.");
      const lock = `revnet:multichain:${account.toLowerCase()}`;
      if (running.has(lock))
        throw new Error("Another multichain batch is already being processed.");
      const execute = async (): Promise<BatchResult> => {
        setIsPending(true);
        let batch: MultichainBatch | undefined;
        const progress = (message: string) => {
          input.onProgress?.(message);
          if (batch) updateTransactionActivity(batch.id, { message });
        };
        const requireAccount = () => {
          requireNoViewAs();
          if (getAccount(config).address?.toLowerCase() !== account.toLowerCase())
            throw new Error("The connected account changed. Resume with the original account.");
        };
        const result = (status: BatchResult["status"]): BatchResult => ({
          status,
          hashes: batch!.calls.flatMap((call, callIndex) =>
            call.state === "success" && call.hash
              ? [{ chainId: call.chainId, hash: call.hash, callIndex }]
              : [],
          ),
        });
        try {
          batch = findPendingBatch(account, input.scope);
          if (batch && input.calls.length && batch.key !== batchCallKey(input.calls))
            throw new Error(
              "A different saved batch is unresolved. Resume its original calls before changing the selection or amounts.",
            );
          if (!batch) {
            if (!input.calls.length) throw new Error("There is no saved batch to resume.");
            const multichainEoa = input.calls.length > 1 && !isSafeConnection(config);
            const chainIds = input.calls.map((call) => call.chainId);
            const compatible = areRelayrChainsCompatible(chainIds);
            if (multichainEoa && chainIds.every(isRelayrSupportedChain) && !compatible)
              throw new Error(
                "Choose destinations from one network family. Mainnet and testnet transactions cannot share a Relayr batch.",
              );
            // Routing is decided only for a new journal. An older direct testnet
            // job must resume its original transport and skip confirmed calls.
            const relayr = multichainEoa && compatible;
            batch = createMultichainBatch(
              account,
              input.scope,
              input.label,
              input.calls,
              relayr ? "relayr" : "direct",
            );
            for (const call of input.calls) await call.validate?.();
            await requireTransactionReview({
              title: `Review ${input.label}`,
              description: relayr
                ? `All ${batch.calls.length} selected calls are retained in ${batch.rounds.length} round(s). Each round uses one funding payment for its independent destinations. Confirmed rounds are skipped when resuming.`
                : "Calls are submitted in order on their selected chains. A Safe proposal must execute before the next call. Confirmed calls are skipped when resuming.",
              confirmLabel: "Agree & prepare batch",
              calls: batch.calls.map((call) => ({
                chainId: call.chainId,
                from: account,
                to: call.address,
                value: call.value,
                data: call.data,
                abi: call.abi,
                functionName: call.functionName,
                args: call.args,
                contractName: call.contractName,
              })),
            });
            requireAccount();
            for (const call of batch.calls) {
              const client = getPublicClient(config, { chainId: call.chainId });
              if (!client) throw new Error("Destination RPC unavailable.");
              await verifyCallPreconditions(client, call.preconditions);
            }
            saveMultichainBatch(batch);
            recordTransactionActivity({
              id: batch.id,
              kind: "direct",
              title: input.label,
              status: "pending",
              manualVerificationRequired: true,
              account,
              message: "The exact selected calls are saved. Resume this batch to continue safely.",
            });
          }
          if (batch.route === "relayr") {
            if (isSafeConnection(config))
              throw new Error(
                "Resume this Relayr batch using its original EOA account connection.",
              );
            for (const [roundIndex, round] of batch.rounds.entries()) {
              if (round.state === "success") continue;
              if (round.state === "funding" && round.bundleUuid) {
                const activity = refreshTransactionActivities().find(
                  (item) => item.bundleUuid === round.bundleUuid,
                );
                if (
                  activity?.relayrPaymentStatus === "unfunded" ||
                  activity?.relayrPaymentStatus === "reverted"
                ) {
                  round.state = "quoted";
                  saveMultichainBatch(batch);
                }
              }
              requireAccount();
              progress(
                `Round ${roundIndex + 1} of ${batch.rounds.length}: ${round.indices.length} destination(s).`,
              );
              if (round.state === "ready" || round.state === "quoted") {
                const requests = [];
                for (const index of round.indices) {
                  const call = batch.calls[index];
                  const client = getPublicClient(config, { chainId: call.chainId });
                  if (!client) throw new Error("Destination RPC unavailable.");
                  await verifyCallPreconditions(client, call.preconditions);
                  const gas = await client.estimateContractGas({
                    account,
                    address: call.address,
                    abi: call.abi,
                    functionName: call.functionName,
                    args: call.args,
                    value: call.value,
                  });
                  requests.push({
                    chainId: call.chainId as JBChainId,
                    version: 6 as const,
                    relayrMode: call.relayrMode,
                    recoveryScope: call.recoveryScope ?? `${batch.scope}:${call.chainId}:${index}`,
                    preconditions: call.preconditions,
                    expectedDeployment: call.expectedDeployment,
                    rejectEvents: call.rejectEvents,
                    reservedReceipt: call.reservedReceipt,
                    expectedPayout: call.expectedPayout,
                    data: {
                      from: account,
                      to: call.address,
                      value: call.value ?? 0n,
                      gas: gasWithHeadroom(gas),
                      data: call.data,
                    },
                    review: {
                      abi: call.abi,
                      functionName: call.functionName,
                      args: call.args,
                      contractName: call.contractName,
                      label: batch.label,
                    },
                  });
                }
                const quote = await getRelayrTxQuote(requests);
                if (!quote) throw new Error("Relayr did not return a payable quote.");
                round.bundleUuid = quote.bundle_uuid;
                round.state = "quoted";
                saveMultichainBatch(batch);
                const payment = await chooseRelayrPayment(
                  quote.payment_info,
                  getAccount(config).chainId,
                );
                requireAccount();
                round.state = "funding";
                saveMultichainBatch(batch);
                try {
                  await sendRelayrTx(payment);
                } catch (cause) {
                  const activity = refreshTransactionActivities().find(
                    (row) => row.bundleUuid === round.bundleUuid,
                  );
                  if (
                    activity?.relayrPaymentStatus === "unfunded" ||
                    activity?.relayrPaymentStatus === "reverted"
                  ) {
                    round.state = "quoted";
                    saveMultichainBatch(batch);
                  }
                  throw cause;
                }
                round.state = "pending";
                saveMultichainBatch(batch);
              }
              if (!round.bundleUuid)
                throw new Error(
                  "The saved publication response is unresolved. Reconcile the original intent before continuing.",
                );
              const bundle = await waitForRelayrBundle(round.bundleUuid);
              for (const index of round.indices) {
                const call = batch.calls[index];
                const transaction = bundle.transactions.find(
                  (item) => item.request.chain === call.chainId,
                );
                const data = transaction?.status.data as
                  { hash?: Hash; transaction?: { hash?: Hash } } | undefined;
                const hash = data?.hash ?? data?.transaction?.hash;
                if (!hash) throw new Error("The destination result has no verified hash.");
                call.hash = hash;
                call.state = "success";
              }
              round.state = "success";
              saveMultichainBatch(batch);
            }
          } else {
            for (const [index, call] of batch.calls.entries()) {
              if (call.state === "success") continue;
              requireAccount();
              progress(`Call ${index + 1} of ${batch.calls.length} on chain ${call.chainId}.`);
              const client = getPublicClient(config, { chainId: call.chainId }) as
                PublicClient | undefined;
              if (!client) throw new Error("Destination RPC unavailable.");
              if (call.hash) {
                call.hash = await verifyDirectResult(client, batch, call);
                call.state = "success";
                saveMultichainBatch(batch);
                continue;
              }
              if (call.state === "submitting")
                throw new Error(
                  "The previous wallet submission has an unknown result. Reconcile it before resubmitting this batch.",
                );
              requireRelayrRecoveryScopeAvailable(
                account,
                call.recoveryScope ?? `${batch.scope}:${call.chainId}:${index}`,
              );
              await verifyCallPreconditions(client, call.preconditions);
              direct.current = { batch, index };
              try {
                call.hash = await writeContractAsync({
                  chainId: call.chainId,
                  address: call.address,
                  abi: call.abi,
                  functionName: call.functionName,
                  args: call.args,
                  value: call.value,
                });
              } catch (cause) {
                if (explicitRejection(cause)) {
                  call.state = "ready";
                  saveMultichainBatch(batch);
                }
                throw cause;
              }
              call.state = submittedViaSafe(call.hash) ? "safe" : "submitted";
              saveMultichainBatch(batch);
              if (call.state === "safe") {
                progress(
                  "Safe proposal saved. Execute it, then resume this batch; no other call will be proposed yet.",
                );
                return result("pending");
              }
              await client.waitForTransactionReceipt({ hash: call.hash });
              call.hash = await verifyDirectResult(client, batch, call);
              call.state = "success";
              saveMultichainBatch(batch);
            }
          }
          batch.status = "success";
          saveMultichainBatch(batch);
          updateTransactionActivity(batch.id, {
            status: "success",
            manualVerificationRequired: false,
            message: "Every selected call has a verified successful destination result.",
          });
          return result("success");
        } catch (cause) {
          if (batch) {
            let discarded = false;
            if (
              batch.calls.every((call) => call.state === "ready") &&
              batch.rounds.every((round) => round.state === "ready")
            ) {
              try {
                batch.calls.forEach((call, index) =>
                  requireRelayrRecoveryScopeAvailable(
                    account,
                    call.recoveryScope ?? `${batch!.scope}:${call.chainId}:${index}`,
                  ),
                );
                removeUnsubmittedBatch(batch.id);
                discarded = true;
              } catch {
                /* A published authorization or inaccessible journal must remain locked. */
              }
            }
            updateTransactionActivity(batch.id, {
              status: discarded ? "failed" : "pending",
              manualVerificationRequired: !discarded,
              message:
                cause instanceof Error ? cause.message : "The saved batch needs reconciliation.",
            });
          }
          throw cause;
        } finally {
          direct.current = null;
          setIsPending(false);
        }
      };
      running.add(lock);
      try {
        return await (typeof navigator !== "undefined" && navigator.locks
          ? navigator.locks.request(lock, { ifAvailable: true }, (acquired) => {
              if (!acquired)
                throw new Error("Another browser tab is already processing a multichain batch.");
              return execute();
            })
          : execute());
      } finally {
        running.delete(lock);
      }
    },
    [config, getRelayrTxQuote, sendRelayrTx, writeContractAsync],
  );
  return { runBatch, getPendingBatch, isPending };
}
