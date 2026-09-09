"use client";

import { gasWithHeadroom } from "@/lib/gas";
import {
  recordTransactionActivity,
  refreshTransactionActivities,
  transactionActivityForHash,
  transactionActivitySnapshot,
  updateTransactionActivity,
  useTransactionActivities,
} from "@/lib/transaction-activity";
import {
  requireContractTransactionReview,
  requireTransactionReview,
  type ContractTransactionReviewCall,
  type TransactionReviewOptions,
} from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { useQueryClient } from "@tanstack/react-query";
import { sendCalls } from "@wagmi/core";
import { useCallback, useMemo } from "react";
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  useConfig,
  useWaitForTransactionReceipt as useWagmiWaitForTransactionReceipt,
  useWriteContract as useWagmiWriteContract,
} from "wagmi";
import { getAccount, getPublicClient, simulateContract, switchChain } from "wagmi/actions";

const SAFE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};
const SAFE_NONCE_GUIDANCE =
  "On Safe’s confirmation screen, Nonce defaults to the next available value. Open its dropdown to see queued nonces and replace one if desired.";
const safeInflight = new Map<string, Promise<void>>();

async function watchSafeProposal(id: string, hash: Hex, chainId: number): Promise<void> {
  const prefix = SAFE_PREFIX[chainId];
  if (!prefix) return;
  const existing = safeInflight.get(id);
  if (existing) return existing;
  const request = (async () => {
    for (let attempt = 0; attempt < 720; attempt += 1) {
      try {
        const response = await fetch(
          `https://api.safe.global/tx-service/${prefix}/api/v1/multisig-transactions/${hash}/`,
        );
        if (response.ok) {
          const transaction = (await response.json()) as {
            isExecuted?: boolean;
            isSuccessful?: boolean | null;
            transactionHash?: Hex | null;
            confirmations?: unknown[];
            confirmationsRequired?: number;
          };
          if (transaction.isExecuted) {
            if (transaction.isSuccessful == null) {
              updateTransactionActivity(id, {
                status: "safe-proposed",
                executionHash: transaction.transactionHash ?? undefined,
                message:
                  "Safe reports this proposal as executed, but its success result is not available yet. Do not submit it again while confirmation is unresolved.",
              });
              await new Promise((resolve) => window.setTimeout(resolve, 5_000));
              continue;
            }
            const needsReceiptVerification =
              refreshTransactionActivities().find((activity) => activity.id === id)
                ?.manualVerificationRequired === true;
            updateTransactionActivity(id, {
              status: needsReceiptVerification
                ? "pending"
                : transaction.isSuccessful
                  ? "success"
                  : "failed",
              executionHash: transaction.transactionHash ?? undefined,
              message: needsReceiptVerification
                ? "Safe execution was reported. Its exact transaction and recipient results still require verification; resume the saved batch."
                : !transaction.isSuccessful
                  ? "Safe executed this proposal, but the onchain transaction failed."
                  : `Safe approvals completed and the proposal executed onchain${transaction.transactionHash ? ` as ${transaction.transactionHash}` : ""}.`,
            });
            return;
          }
          const approvals = transaction.confirmations?.length ?? 0;
          const required = transaction.confirmationsRequired;
          updateTransactionActivity(id, {
            status: "safe-proposed",
            message: `Safe proposal is not executed${required ? ` | ${approvals}/${required} approvals` : ""}. It remains asynchronous; do not submit it again.`,
          });
        }
      } catch {
        updateTransactionActivity(id, {
          status: "safe-proposed",
          message:
            "Safe proposal submitted, but its service is temporarily unavailable. It is not confirmed executed; check Safe before retrying.",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
    }
  })();
  safeInflight.set(id, request);
  void request.finally(() => safeInflight.delete(id)).catch(() => undefined);
  return request;
}

/**
 * A Safe connection can take a whole flow as ONE proposal: the Safe app folds
 * `wallet_sendCalls` into a MultiSend, so signers approve once and the calls
 * execute together, in order. Reviewed as one request; tracked like any other
 * Safe proposal.
 */
export async function proposeSafeBatch(
  config: ReturnType<typeof useConfig>,
  chainId: number,
  title: string,
  calls: readonly (Omit<ContractTransactionReviewCall, "chainId" | "account" | "safeTxGas"> & {
    /** Needs an earlier call's effect (an allowance), so it cannot simulate alone. */
    dependsOnPrior?: boolean;
  })[],
): Promise<Hex> {
  requireNoViewAs();
  const account = getAccount(config).address;
  if (!account) throw new Error("Connect a wallet first.");
  if (!isSafeConnection(config)) {
    throw new Error("A batch can only be proposed through a Safe connection.");
  }
  const encoded = calls.map((call) => ({
    to: call.address,
    value: call.value,
    data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
  }));
  const callKey = `batch:${account.toLowerCase()}:${chainId}:${keccak256(
    stringToHex(encoded.map((call) => `${call.to}:${call.value ?? 0n}:${call.data}`).join("|")),
  )}`;
  const submit = async () => {
    const duplicate = refreshTransactionActivities().find(
      (activity) =>
        activity.callKey === callKey &&
        (activity.status === "submitted" ||
          activity.status === "pending" ||
          activity.status === "safe-proposed"),
    );
    if (duplicate?.hash) throw new SafeProposalPendingError(duplicate.hash, title);

    // The calls depend on each other (an allowance, then the spend), so the
    // batch simulates as one sequence where the RPC offers eth_simulateV1.
    // Where it does not, each standalone call simulates on its own and the
    // dependent one is left to Safe's batch simulation before signing.
    const publicClient = getPublicClient(config, { chainId });
    if (!publicClient) throw new Error(`No RPC client is configured for chain ${chainId}.`);
    const sequence = await publicClient
      .simulateCalls({ account, calls: encoded })
      .then((simulated) => simulated.results)
      .catch((cause: { code?: number; message?: string }) => {
        if (
          cause.code === -32601 ||
          cause.code === -32004 ||
          /not (?:allowed|supported|found|implemented)/i.test(cause.message ?? "")
        ) {
          return null;
        }
        throw cause;
      });
    for (const [index, call] of calls.entries()) {
      if (sequence) {
        const result = sequence[index];
        if (result?.status === "success") continue;
        throw new Error(
          `${call.functionName} (step ${index + 1}) reverts in simulation${
            result && "error" in result && result.error
              ? `: ${(result.error as Error).message}`
              : "."
          }`,
        );
      }
      if (call.dependsOnPrior) continue;
      try {
        await simulateContract(config, {
          chainId,
          account,
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
          value: call.value,
        } as Parameters<typeof simulateContract>[1]);
      } catch (cause) {
        throw new Error(
          `${call.functionName} (step ${index + 1}) reverts in simulation: ${
            (cause as { shortMessage?: string; message?: string }).shortMessage ??
            (cause as Error).message
          }`,
        );
      }
    }

    await requireTransactionReview({
      calls: encoded.map((call, index) => ({
        chainId,
        from: account,
        safeTxGas: 0n,
        abi: calls[index]!.abi,
        functionName: calls[index]!.functionName,
        args: calls[index]!.args,
        label: calls[index]!.functionName,
        ...call,
      })),
      title,
      confirmLabel: "Agree & propose to Safe",
      description: `These ${calls.length} calls go to Safe as one batch that executes together, in this order, once the Safe's approvals are in.\n\n${SAFE_NONCE_GUIDANCE}`,
    });
    if (getAccount(config).address?.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Connected account changed. Review the transaction again.");
    }
    if (!isSafeConnection(config)) {
      throw new Error("Wallet connection changed. Review the transaction again.");
    }
    if (getAccount(config).chainId !== chainId) {
      await switchChain(config, { chainId } as Parameters<typeof switchChain>[1]);
    }
    const { id } = await sendCalls(config, { chainId, calls: encoded });
    const hash = id as Hex;
    followSubmission(config, hash, chainId, title, account, callKey, true, false);
    return hash;
  };
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks
    ? locks.request(`revnet:transaction:${keccak256(stringToHex(callKey))}`, submit)
    : submit();
}

export function resumeSafeProposalTracking(): void {
  transactionActivitySnapshot()
    .filter((activity) => activity.status === "safe-proposed" && activity.hash && activity.chainId)
    .forEach((activity) => void watchSafeProposal(activity.id, activity.hash!, activity.chainId!));
}

export function isSafeConnector(connector: { id?: string; name?: string } | undefined): boolean {
  return `${connector?.id ?? ""} ${connector?.name ?? ""}`.toLowerCase().includes("safe");
}

export function isSafeConnection(config: ReturnType<typeof useConfig>): boolean {
  return isSafeConnector(getAccount(config).connector);
}

function followSubmission(
  config: ReturnType<typeof useConfig>,
  hash: Hex,
  chainId: number,
  title: string,
  account: Address,
  callKey: string,
  safe: boolean,
  manualReceiptVerification: boolean,
): void {
  const id = `tx:${chainId}:${hash.toLowerCase()}`;
  recordTransactionActivity({
    id,
    kind: safe ? "safe" : "direct",
    title,
    status: safe ? "safe-proposed" : "submitted",
    message: safe
      ? "Submitted to Safe. It is not executed yet; it still needs the Safe's approvals and asynchronous execution."
      : "Wallet submission accepted. Waiting for an onchain receipt.",
    chainId,
    account,
    hash,
    safeProposalHash: safe ? hash : undefined,
    callKey,
    manualVerificationRequired: manualReceiptVerification || undefined,
  });
  if (manualReceiptVerification && !safe) {
    updateTransactionActivity(id, {
      status: "pending",
      message: "Pending action-specific receipt verification.",
    });
    return;
  }
  if (safe) {
    void watchSafeProposal(id, hash, chainId);
    return;
  }
  updateTransactionActivity(id, { status: "pending", message: "Pending onchain confirmation." });
  const publicClient = getPublicClient(config, { chainId });
  if (!publicClient) return;
  void waitForReceiptWithRetry(publicClient, hash)
    .then((receipt) => {
      updateTransactionActivity(id, {
        status: receipt.status === "success" ? "success" : "failed",
        message:
          receipt.status === "success"
            ? "Confirmed onchain."
            : "The transaction was mined but reverted. Its intended state changes did not occur.",
      });
    })
    .catch(() => {
      updateTransactionActivity(id, {
        status: "pending",
        message:
          "Submitted, but this RPC could not confirm the receipt. Check the transaction before retrying.",
      });
    });
}

type ReviewedWriteContractOptions = Parameters<typeof useWagmiWriteContract>[0] & {
  transactionReview?: TransactionReviewOptions;
  /**
   * The exact call is already visible in a parent confirmation dialog. This
   * skips only the duplicate app review; duplicate detection, account checks,
   * revalidation, simulation, wallet confirmation, and receipt tracking stay
   * mandatory.
   */
  reviewedInParent?: boolean;
  /** Persist caller-specific recovery immediately before the wallet broadcast boundary. */
  beforeSubmission?: () => Promise<void>;
  /** A batch verifier reconstructs the exact Safe execution before releasing child activity. */
  allowSafeManualReceiptVerification?: boolean;
  reverify?: (
    variables: Parameters<ReturnType<typeof useWagmiWriteContract>["writeContractAsync"]>[0],
    account: Address,
  ) => Promise<void>;
  /**
   * Optional exact raw preflight for calls where Viem's generic simulation
   * semantics are not equivalent to a real transaction (notably ENS CCIP).
   */
  preflightSimulation?: (
    variables: Parameters<ReturnType<typeof useWagmiWriteContract>["writeContractAsync"]>[0],
    account: Address,
  ) => Promise<{ gas: bigint } | void>;
  /** Keep generic receipt success pending until the caller releases its exact postcondition. */
  manualReceiptVerification?: (
    variables: Parameters<ReturnType<typeof useWagmiWriteContract>["writeContractAsync"]>[0],
  ) => boolean;
};

export function useWriteContract(
  options?: ReviewedWriteContractOptions,
): ReturnType<typeof useWagmiWriteContract> {
  const config = useConfig();
  const queryClient = useQueryClient();
  const {
    transactionReview,
    reviewedInParent,
    beforeSubmission,
    allowSafeManualReceiptVerification,
    reverify,
    preflightSimulation,
    manualReceiptVerification,
    ...wagmiOptions
  } = options ?? {};
  const mutation = useWagmiWriteContract(wagmiOptions);

  const writeContractAsync = useCallback(
    async (variables: Parameters<typeof mutation.writeContractAsync>[0]) => {
      requireNoViewAs();
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");
      const initialAddress = before.address;
      const chainId = Number(variables.chainId ?? before.chainId);
      if (!chainId) throw new Error("Select a network before continuing.");
      const functionName = String(variables.functionName);
      const callKey = `${initialAddress.toLowerCase()}:${chainId}:${variables.address.toLowerCase()}:${variables.value ?? 0n}:${encodeFunctionData(
        {
          abi: variables.abi as Abi,
          functionName,
          args: variables.args,
        },
      )}`;
      const submitReviewedCall = async () => {
        const duplicate = refreshTransactionActivities().find(
          (activity) =>
            activity.callKey === callKey &&
            (activity.manualVerificationRequired === true ||
              activity.status === "submitted" ||
              activity.status === "pending" ||
              activity.status === "safe-proposed"),
        );
        if (duplicate?.hash) {
          if (duplicate.status === "safe-proposed") {
            throw new SafeProposalPendingError(duplicate.hash, functionName);
          }
          throw new Error(
            `An identical ${functionName} transaction is already pending as ${duplicate.hash}. Check it before submitting again.`,
          );
        }

        const safe = isSafeConnection(config);
        const ownsReceiptLifecycle = manualReceiptVerification?.(variables) === true;
        if (safe && ownsReceiptLifecycle && !allowSafeManualReceiptVerification) {
          throw new Error(
            "This execution requires exact onchain result verification and cannot be proposed through a Safe connector. Connect an EOA owner of the executing Safe.",
          );
        }
        if (!reviewedInParent) {
          await requireContractTransactionReview(
            {
              chainId,
              address: variables.address,
              abi: variables.abi as Abi,
              functionName,
              args: variables.args,
              value: variables.value,
              account: initialAddress,
              safeTxGas: safe ? 0n : undefined,
            },
            {
              title: `Review ${functionName}`,
              label: functionName,
              ...transactionReview,
              confirmLabel: safe
                ? "Agree & propose to Safe"
                : (transactionReview?.confirmLabel ?? "Agree & continue"),
              description:
                [transactionReview?.description, safe ? SAFE_NONCE_GUIDANCE : undefined]
                  .filter(Boolean)
                  .join("\n\n") || undefined,
            },
          );
        }

        const reviewedAccount = getAccount(config).address;
        if (!reviewedAccount || reviewedAccount.toLowerCase() !== initialAddress.toLowerCase()) {
          throw new Error("Connected account changed. Review the transaction again.");
        }
        await reverify?.(variables, reviewedAccount);
        const reverifiedAccount = getAccount(config).address;
        if (
          !reverifiedAccount ||
          reverifiedAccount.toLowerCase() !== reviewedAccount.toLowerCase()
        ) {
          throw new Error("Connected account changed. Review the transaction again.");
        }

        const boundedPreflight = preflightSimulation
          ? await preflightSimulation(variables, reviewedAccount)
          : undefined;
        const simulation = preflightSimulation
          ? { request: { ...variables, chainId, account: reviewedAccount } }
          : await simulateContract(config, {
              ...variables,
              chainId,
              account: reviewedAccount,
            } as Parameters<typeof simulateContract>[1]);
        const publicClient = getPublicClient(config, { chainId });
        if (!publicClient) throw new Error(`No RPC client is configured for chain ${chainId}.`);
        const estimateRequest = {
          ...variables,
          gas: undefined,
          account: reviewedAccount,
        };
        const estimate = boundedPreflight?.gas
          ? boundedPreflight.gas
          : await publicClient.estimateContractGas(
              estimateRequest as Parameters<typeof publicClient.estimateContractGas>[0],
            );
        const liveAccount = getAccount(config).address;
        if (!liveAccount || liveAccount.toLowerCase() !== reviewedAccount.toLowerCase()) {
          throw new Error("Connected account changed. Review the transaction again.");
        }
        if (isSafeConnection(config) !== safe) {
          throw new Error("Wallet connection changed. Review the transaction again.");
        }
        // Every call names its own chain, so a wallet parked elsewhere is a
        // switch away rather than an error the caller has to explain.
        if (getAccount(config).chainId !== chainId) {
          try {
            await switchChain(config, { chainId } as Parameters<typeof switchChain>[1]);
          } catch {
            const target = config.chains.find((chain) => chain.id === chainId)?.name;
            throw new Error(`Switch your wallet to ${target ?? `chain ${chainId}`} to continue.`);
          }
        }
        await beforeSubmission?.();
        const hash = await mutation.writeContractAsync({
          ...simulation.request,
          // Safe Apps maps the Ethereum gas field directly to Safe's signed
          // safeTxGas. Keep its canonical envelope at zero and let Safe estimate
          // execution gas; the bounded preflight above remains mandatory.
          gas: safe ? 0n : (boundedPreflight?.gas ?? gasWithHeadroom(estimate)),
        } as Parameters<typeof mutation.writeContractAsync>[0]);
        followSubmission(
          config,
          hash,
          chainId,
          functionName,
          reviewedAccount,
          callKey,
          safe,
          ownsReceiptLifecycle,
        );
        return hash;
      };

      // Serialize identical submissions across same-origin tabs. The duplicate
      // check runs after the lock is acquired and refreshes persisted activity,
      // so a second tab cannot open another wallet prompt while the first is in
      // review or waiting for its Safe proposal hash.
      const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
      return locks
        ? locks.request(`revnet:transaction:${keccak256(stringToHex(callKey))}`, submitReviewedCall)
        : submitReviewedCall();
    },
    [
      config,
      manualReceiptVerification,
      mutation,
      preflightSimulation,
      reviewedInParent,
      reverify,
      beforeSubmission,
      allowSafeManualReceiptVerification,
      transactionReview,
    ],
  );

  const writeContract = useCallback(
    (
      variables: Parameters<typeof mutation.writeContract>[0],
      callbacks?: Parameters<typeof mutation.writeContract>[1],
    ) => {
      const context = {
        client: queryClient,
        meta: wagmiOptions.mutation?.meta,
        mutationKey: ["writeContract"] as const,
      };
      void writeContractAsync(variables as Parameters<typeof mutation.writeContractAsync>[0]).then(
        (hash) => {
          callbacks?.onSuccess?.(hash, variables, undefined, context);
          callbacks?.onSettled?.(hash, null, variables, undefined, context);
        },
        (error) => {
          callbacks?.onError?.(error, variables, undefined, context);
          callbacks?.onSettled?.(undefined, error, variables, undefined, context);
        },
      );
    },
    [mutation, queryClient, wagmiOptions.mutation?.meta, writeContractAsync],
  );

  return { ...mutation, writeContractAsync, writeContract } as ReturnType<
    typeof useWagmiWriteContract
  >;
}

export function useWaitForTransactionReceipt(
  parameters: Parameters<typeof useWagmiWaitForTransactionReceipt>[0] = {},
) {
  const activities = useTransactionActivities();
  const hash = parameters.hash as Hex | undefined;
  const tracked = useMemo(
    () => activities.find((row) => row.hash?.toLowerCase() === hash?.toLowerCase()),
    [activities, hash],
  );
  const isSafeSubmission = tracked?.kind === "safe";
  const isSafeProposal = tracked?.status === "safe-proposed";
  const trackedDirectSuccess = tracked?.kind === "direct" && tracked.status === "success";
  const trackedDirectFailure = tracked?.kind === "direct" && tracked.status === "failed";
  const query = useWagmiWaitForTransactionReceipt({
    ...parameters,
    query: {
      ...parameters.query,
      enabled: (parameters.query?.enabled ?? true) && !!hash && !isSafeSubmission,
    },
  });
  const receipt = query.data as TransactionReceipt | undefined;
  const reverted = receipt?.status === "reverted";
  return {
    ...query,
    isLoading: isSafeSubmission ? isSafeProposal : query.isLoading,
    isSuccess: isSafeSubmission
      ? tracked?.status === "success"
      : trackedDirectSuccess || (query.isSuccess && receipt?.status === "success"),
    isError: isSafeSubmission
      ? tracked?.status === "failed"
      : trackedDirectFailure || reverted || (!tracked && query.isError),
    error:
      isSafeSubmission && tracked?.status === "failed"
        ? new Error(tracked.message)
        : trackedDirectFailure
          ? new Error(tracked.message)
          : reverted
            ? new Error(`Transaction ${hash} reverted onchain.`)
            : !tracked
              ? query.error
              : undefined,
    isSafeProposal,
    statusMessage: tracked?.message,
  };
}

export function submittedViaSafe(hash?: Hex): boolean {
  return transactionActivityForHash(hash)?.status === "safe-proposed";
}

export class SafeProposalPendingError extends Error {
  readonly name = "SafeProposalPendingError";

  constructor(
    readonly hash: Hex,
    action: string,
  ) {
    super(
      `${action} was proposed to Safe as ${hash}, but it has not executed. Complete its approvals and execution in Safe, then resume; do not submit it again.`,
    );
  }
}

export function isSafeProposalPendingError(error: unknown): error is SafeProposalPendingError {
  return error instanceof SafeProposalPendingError;
}

/** Stop dependent steps after a Safe connector returns an asynchronous proposal hash. */
export function requireOnchainExecution(hash: Hex, action: string): void {
  if (!submittedViaSafe(hash)) return;
  throw new SafeProposalPendingError(hash, action);
}
