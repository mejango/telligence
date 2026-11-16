"use client";

import {
  announcingSign,
  loadEngine,
  requireDone,
  requireProposedOrDone,
  reviewedCall,
  reviewedWalletAdapter,
  ReviewRefusal,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import { recordSafeProposal } from "@/lib/held-rows";
import { legacyBatchNamespace } from "@/lib/legacy-intents";
import { composeBatch, type BatchCall, type BatchStep } from "@/lib/safe-batch";
import { isSafeConnection } from "@/lib/safe-connector";
import {
  hasSafeService,
  listPendingSafeTransactions,
  onchainApprovalStep,
  proposalNonceChoices,
  SAFE_EXEC_ABI,
  safeBatchProposalFor,
  safeExecutionArgs,
  safeProposalFor,
  safeTransactionHash,
  safeTransactionMatchesCall,
  safeTransactionMessage,
} from "@/lib/safe-service-config";
import { SAFE_PROPOSAL_ORIGIN } from "@/lib/safe-transactions";
import { requireNoViewAs } from "@/lib/view-as";
import { safeExecutionIntent } from "@/lib/write-hold";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  intent,
  safeBatchIntent,
  simulateCallSequence,
  writeIntentKey,
  type ReviewContextRow,
} from "@bananapus/nana-sdk-core/review";
import {
  MULTI_SEND_CALL_ONLY,
  readAuthorityIdentity,
  readBoundedSafeApprovedHash,
  readBoundedSafeNonce,
} from "@bananapus/nana-sdk-core/safe";
import { useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, keccak256, stringToHex, type Address, type Hex } from "viem";
import { useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";
import { chainName, operatorWriteRoute, publicClientFor } from "./operatorLib";

/** How a chain's batch leaves the app, decided from (authority identity, connection). */
export type SafeBatchRoute =
  /** Connected through the Safe app as the authority itself: one MultiSend via wallet_sendCalls. */
  | { kind: "safe-app"; authority: Address }
  /** The authority is a Safe the connected wallet co-signs: one operation-1 SafeTx proposal. */
  | { kind: "safe-signer"; safe: Address; owners: Address[]; threshold: number }
  /** The connected wallet is the authority: sequential direct writes. */
  | { kind: "eoa"; authority: Address }
  | { kind: "refused"; message: string; authority?: Address };

export function routeSafeBatch({
  account,
  authority,
  identity,
  safeConnection,
  chainId,
  connectedChainId,
}: {
  account: Address | undefined;
  authority: Address | undefined;
  identity: Parameters<typeof operatorWriteRoute>[0]["identity"];
  safeConnection: boolean;
  /** The batch's chain and the wallet's; a Safe app cannot switch, so they must agree. */
  chainId?: number;
  connectedChainId?: number;
}): SafeBatchRoute {
  if (!account) return { kind: "refused", message: "Connect a wallet first.", authority };
  let route: ReturnType<typeof operatorWriteRoute>;
  try {
    route = operatorWriteRoute({ account, authority, identity });
  } catch (cause) {
    return { kind: "refused", message: (cause as Error).message, authority };
  }
  if (route.kind === "safe-signer") return route;
  const acting = authority ?? account;
  if (
    safeConnection &&
    chainId !== undefined &&
    connectedChainId !== undefined &&
    chainId !== connectedChainId
  ) {
    return {
      kind: "refused",
      message: `Open this Safe on ${chainName(chainId)} in Safe to propose this batch.`,
      authority: acting,
    };
  }
  return safeConnection
    ? { kind: "safe-app", authority: acting }
    : { kind: "eoa", authority: acting };
}

export type SafeBatchOutcome =
  | { kind: "proposed"; hash: Hex; calls: number }
  | { kind: "confirmed"; hash: Hex; calls: number }
  /** No Safe service: this owner's approval is onchain; the batch executes at the threshold. */
  | { kind: "approved"; hash: Hex; calls: number; approvals: number; threshold: number }
  | { kind: "executed"; hash: Hex; calls: number }
  | { kind: "sent"; transactions: number };

/**
 * The whole sequence simulated from the Safe by the SDK: as one sequence where
 * the RPC offers eth_simulateV1, otherwise each standalone call on its own,
 * leaving a call that depends on an earlier one to Safe's own batch simulation
 * before signing. Only a node that lacks the method takes the fallback; a
 * revert or a lagging node stops the batch.
 */
async function simulateFromSafe(
  chainId: number,
  safe: Address,
  steps: readonly BatchStep[],
  calls: readonly BatchCall[],
): Promise<void> {
  await simulateCallSequence(publicClientFor(chainId as JBChainId), {
    from: safe,
    chainName: chainName(chainId),
    calls: calls.map((call, index) => ({
      to: call.to,
      data: call.data,
      value: call.value,
      label: `${steps[index]!.label} (step ${index + 1})`,
      dependsOnPrior: call.dependsOnPrior,
    })),
  });
}

/** A step as the build before SDK 4 named its batch (legacy-intents.ts). */
function batchWrite(step: BatchStep) {
  return { address: step.to, abi: step.abi, functionName: step.functionName, args: step.args };
}

export function useSafeBatchSubmit() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { run, deps } = useReviewedAction();

  const routeFor = async ({
    chainId,
    authority,
  }: {
    chainId: number;
    authority: Address | undefined;
  }): Promise<SafeBatchRoute> => {
    const account = getAccount(config).address;
    const identity =
      account && authority && !isAddressEqual(account, authority)
        ? await readAuthorityIdentity(publicClientFor(chainId as JBChainId), authority)
        : null;
    return routeSafeBatch({
      account,
      authority,
      identity,
      safeConnection: isSafeConnection(config),
      chainId,
      connectedChainId: getAccount(config).chainId,
    });
  };

  /**
   * The Safe nonces a new proposal may take, ascending, the last being the next free one. A
   * queued nonce offers the batch as a replacement of what is queued there.
   */
  const noncesFor = async ({
    chainId,
    safe,
  }: {
    chainId: number;
    safe: Address;
  }): Promise<{ choices: number[]; next: number }> => {
    const nonce = await readBoundedSafeNonce(publicClientFor(chainId as JBChainId), safe);
    if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`The operator Safe's nonce on ${chainName(chainId)} could not be read.`);
    }
    const pending = await listPendingSafeTransactions(chainId, safe, Number(nonce));
    const choices = proposalNonceChoices(Number(nonce), pending);
    return { choices, next: choices[choices.length - 1]! };
  };

  const submit = async ({
    chainId,
    steps,
    route,
    proposalNonce,
    onProgress,
    onStep,
  }: {
    chainId: number;
    steps: readonly BatchStep[];
    route: SafeBatchRoute;
    /** The Safe nonce to propose at (Safe service route). Default: the next free one. */
    proposalNonce?: number;
    onProgress: (message: string) => void;
    /** The index of the step the wallet is on (direct writes only). */
    onStep: (index: number) => void;
  }): Promise<SafeBatchOutcome> => {
    const { address: account, connector } = getAccount(config);
    if (!account) throw new Error("Connect a wallet first.");
    if (!steps.length) throw new Error("The batch is empty.");
    const { calls, problems } = composeBatch(steps);
    if (problems.length) throw new Error(problems[0]!.message);
    const name = chainName(chainId);
    const title = `Batch on ${name} (${steps.length} call${steps.length === 1 ? "" : "s"})`;

    if (route.kind === "refused") throw new Error(route.message);

    if (route.kind === "safe-app" || route.kind === "eoa") {
      if (route.kind === "safe-app")
        onProgress(`Proposing the batch through the Safe app on ${name}…`);
      // The whole batch is reviewed once and sent in order, resumable as one action; a Safe app
      // proposes it as one transaction.
      const result = requireProposedOrDone(
        await run({
          account,
          title,
          batch: true,
          scope: writeIntentKey("operator-batch", {
            account: intent.address(account),
            chainId,
            calls: calls.map((call) => [intent.address(call.to), call.data]),
          }),
          beforeWallet: (_call, step) => onStep(step),
          calls: steps.map((step, index) =>
            reviewedCall(
              {
                chainId,
                address: step.to,
                abi: step.abi,
                functionName: step.functionName,
                args: step.args,
              },
              {
                label: step.label,
                contractName: step.contractName,
                dependsOnPrior: calls[index]!.dependsOnPrior,
                // A Safe app's batch is held as one proposal of exactly these calls, as before.
                ...(route.kind === "safe-app" && index === 0
                  ? {
                      intent: safeBatchIntent({ chainId, safe: account, calls }),
                      legacyIntents: [legacyBatchNamespace(steps.map(batchWrite))],
                    }
                  : {}),
              },
            ),
          ),
        }),
      );
      if (result.status === "proposed")
        return { kind: "proposed", hash: result.safeTxHash, calls: steps.length };
      onStep(steps.length);
      return { kind: "sent", transactions: result.hashes.length };
    }

    const { safe } = route;
    const client = publicClientFor(chainId as JBChainId);
    onProgress(`Checking MultiSend on ${name}…`);
    const code = await client.getCode({ address: MULTI_SEND_CALL_ONLY });
    if (!code || code === "0x") {
      throw new Error(
        `Safe's MultiSendCallOnly is not deployed on ${name}, so a batch cannot be proposed there.`,
      );
    }
    // A proposal the Safe would revert on only wastes every signer's time.
    onProgress(`Simulating the batch on ${name} as the operator Safe…`);
    await simulateFromSafe(chainId, safe, steps, calls);

    onProgress(`Reading the Safe queue on ${name}…`);
    const nonce = await readBoundedSafeNonce(client, safe).catch(() => null);
    if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`The operator Safe's nonce on ${name} could not be read.`);
    }
    const reverify = async (signer: Address) => {
      const live = await readAuthorityIdentity(client, safe);
      if (live?.kind !== "safe") {
        throw new ReviewRefusal(`The operator on ${name} is no longer a supported Safe.`);
      }
      if (!live.owners.some((owner) => isAddressEqual(owner, signer))) {
        throw new ReviewRefusal(
          `The connected wallet is no longer a signer of the operator Safe on ${name}.`,
        );
      }
    };

    const reviewedSteps = steps.map((step, index) =>
      reviewedCall(
        {
          chainId,
          address: step.to,
          abi: step.abi,
          functionName: step.functionName,
          args: step.args,
        },
        {
          label: step.label,
          contractName: step.contractName,
          dependsOnPrior: calls[index]!.dependsOnPrior,
        },
      ),
    );
    const context: ReviewContextRow[] = [
      {
        label: "Batch",
        value: `${steps.length} call${steps.length === 1 ? "" : "s"} from the operator Safe`,
        lines: steps.map((step, index) => `${index + 1}. ${step.label}`),
      },
    ];

    if (!hasSafeService(chainId)) {
      // No Safe service holds signatures here, so each owner approves the
      // exact SafeTx hash onchain. Co-signers build the same batch; the hash
      // matches only for the same steps, order, values and Safe nonce.
      // ponytail: approves at the Safe's current nonce; any other Safe tx executing first voids it.
      const tx = safeBatchProposalFor(calls, Number(nonce));
      const safeTxHash = safeTransactionHash(chainId, safe, tx);
      const live = await readAuthorityIdentity(client, safe);
      if (live?.kind !== "safe") {
        throw new Error(`The operator on ${name} is no longer a supported Safe.`);
      }
      const approvedFlags = await Promise.all(
        live.owners.map((owner) => readBoundedSafeApprovedHash(client, safe, owner, safeTxHash)),
      );
      if (approvedFlags.some((flag) => flag === null)) {
        throw new Error(`The operator Safe's approvals on ${name} could not be read.`);
      }
      const approved = live.owners.filter((_, index) => approvedFlags[index] !== 0n);
      const next = onchainApprovalStep({ account, approved, threshold: live.threshold });
      if (next.kind === "waiting") {
        return {
          kind: "approved",
          hash: safeTxHash,
          calls: steps.length,
          approvals: approved.length,
          threshold: live.threshold,
        };
      }
      const write =
        next.kind === "approve"
          ? {
              functionName: "approveHash" as const,
              args: [safeTxHash] as const,
              label: `Approve batch on ${name}`,
              description: `${name} has no Safe transaction service, so this approval is recorded onchain. The batch executes once ${live.threshold} owners have approved the same batch.`,
              confirmLabel: "Agree & approve onchain",
            }
          : {
              functionName: "execTransaction" as const,
              args: safeExecutionArgs(
                { ...tx, confirmations: next.signers.map((owner) => ({ owner })) },
                live.owners,
              ),
              label: `Execute batch on ${name}`,
              description: `${next.signers.length} of ${live.threshold} owners have approved this batch, counting you. Executing runs every step in order.`,
              confirmLabel: "Agree & execute",
            };
      onProgress(`Confirm the ${write.functionName} transaction on ${name} in your wallet…`);
      // Held by the Safe transaction it approves or runs, not by the signatures collected so far.
      // An execution is done only once the Safe's own success for its hash is read.
      const result = requireDone(
        await run({
          account,
          title: write.label,
          description: write.description,
          confirmLabel: write.confirmLabel,
          context,
          reverify: () => reverify(account),
          calls: [
            reviewedCall(
              {
                chainId,
                address: safe,
                abi: SAFE_EXEC_ABI,
                functionName: write.functionName,
                args: write.args,
              },
              {
                label: write.label,
                contractName: "Safe",
                intent: safeExecutionIntent(chainId, safe, safeTxHash),
              },
            ),
          ],
        }),
      );
      const hash = result.hashes.at(-1)!;
      if (next.kind === "execute") return { kind: "executed", hash, calls: steps.length };
      return {
        kind: "approved",
        hash: safeTxHash,
        calls: steps.length,
        approvals: approved.length + 1,
        threshold: live.threshold,
      };
    }

    // Core proposes the batch after one review (one call as itself, several as a MultiSend), or
    // confirms the queued proposal of exactly these calls.
    const shape = safeTransactionMessage(
      calls.length === 1
        ? safeProposalFor(calls[0]!, Number(nonce))
        : safeBatchProposalFor(calls, Number(nonce)),
    );
    const pending = await listPendingSafeTransactions(chainId, safe, Number(nonce));
    const queued = pending.some(
      (tx) =>
        safeTransactionMatchesCall(tx, shape) &&
        (proposalNonce === undefined || Number(tx.nonce) === proposalNonce),
    );
    requireNoViewAs();
    const what = queued ? `already-queued batch on ${name}` : `batch proposal for ${name}`;
    onProgress(`Review the ${what}…`);
    const { proposeReviewedSafeTransaction } = await loadEngine();
    const adapter = reviewedWalletAdapter(config, account, connector);
    // The proposal signs after its review, so View-as and the reviewed wallet are checked there.
    const { safeTxHash: hash } = await proposeReviewedSafeTransaction(
      {
        chainId,
        safe,
        calls: reviewedSteps,
        context,
        title,
        origin: SAFE_PROPOSAL_ORIGIN,
        ...(proposalNonce === undefined ? {} : { nonce: proposalNonce }),
      },
      {
        ...deps,
        // The wallet opens only once the review is agreed to.
        adapter: announcingSign(adapter, () => onProgress(`Sign the ${what} in your wallet…`)),
      },
    );
    void queryClient.invalidateQueries({ queryKey: ["revnet-safe-queues"] });
    if (queued) return { kind: "confirmed", hash, calls: steps.length };
    const callKey = `batch:${account.toLowerCase()}:${chainId}:${keccak256(
      stringToHex(calls.map((call) => `${call.to}:${call.value}:${call.data}`).join("|")),
    )}`;
    recordSafeProposal(hash, chainId, title, account, callKey, {
      safe,
      calls: calls.map((call) => ({ to: call.to, value: String(call.value), data: call.data })),
      batch: calls.length > 1,
    });
    return { kind: "proposed", hash, calls: steps.length };
  };

  return { routeFor, noncesFor, submit };
}
