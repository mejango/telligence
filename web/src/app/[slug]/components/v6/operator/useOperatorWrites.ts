"use client";

import {
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import { useReviewedSafeSignature } from "@/hooks/useReviewedSafeSignature";
import {
  isSafeConnection,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { readAuthorityIdentity, readBoundedSafeNonce } from "@/lib/cross-chain-authority";
import { gasWithHeadroom } from "@/lib/gas";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import {
  listPendingSafeTransactions,
  nextProposalNonce,
  proposeSafeTransaction,
  queuedTransactionMatchesCall,
  safeProposalFor,
  submitSafeConfirmation,
} from "@/lib/safe-queue";
import { chooseRelayrPayment } from "@/lib/transaction-review";
import { useQueryClient } from "@tanstack/react-query";
import { Address, encodeFunctionData, isAddressEqual } from "viem";
import { useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";
import {
  ChainWrite,
  chainName,
  operatorWriteRoute,
  publicClientFor,
  runSequentialWrites,
  type OperatorWriteRoute,
} from "./operatorLib";

export type OperatorWritesResult = {
  /** Chains where the call executed onchain. */
  chains: number;
  viaRelayr: boolean;
  /** The Relayr payment was proposed to a Safe — the bundle has not executed yet. */
  safeProposal: boolean;
  /** Chains where the call was queued in the operator Safe for its signers. */
  safeQueued: number;
  /** Chains where this signer only added a confirmation to an identical proposal already queued. */
  safeConfirmed: number;
};

type RoutedWrite = { write: ChainWrite; route: OperatorWriteRoute };

// Repeating these setters preserves their result and the caller's authority.
// Deployment, pool initialization, and operator transfer need per-chain progress
// tracking before a partially completed sequence can be retried safely.
const REPEATABLE_OPERATOR_WRITES = new Set(["setHookFor", "setTerminalFor", "setTwapWindowOf"]);

/**
 * Runs one operator action across the selected chains, from whichever account
 * can authorize it:
 *
 * - The operator itself (an EOA, or the Safe through its own app): a single
 *   chain keeps the simulate-first wallet write; two or more supported mainnets or testnets
 *   are bundled into ONE Relayr payment, after an exact authorization signature on each chain.
 *   Gas is estimated against each chain's live state first, so
 *   a call that would revert never reaches the bundle. A Safe-app connection
 *   cannot sign Relayr's forward requests, so it runs the chains one by one.
 * - A signer of an operator Safe: the exact call is simulated FROM the Safe,
 *   then proposed to that chain's Safe Transaction Service with this signer's
 *   confirmation — one proposal per chain, since each Safe queue is its own.
 *   An identical proposal already queued is confirmed rather than duplicated.
 *   The remaining signers confirm and execute from the Safe queue card here or
 *   in the Safe app.
 */
export function useOperatorWrites() {
  const { writeContractAsync } = useWriteContract();
  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const { signSafeTransactionAsync } = useReviewedSafeSignature();
  const config = useConfig();
  const queryClient = useQueryClient();

  const runWrites = async ({
    writes,
    account,
    label,
    onProgress,
  }: {
    writes: ChainWrite[];
    account: Address;
    label: string;
    onProgress: (message: string) => void;
  }): Promise<OperatorWritesResult> => {
    if (!writes.length) throw new Error("Choose at least one chain.");
    const preferredPaymentChainId = getAccount(config).chainId;

    // Decide per chain who can sign before touching any wallet, so a mixed or
    // impossible selection fails whole instead of halfway through.
    const routed: RoutedWrite[] = await Promise.all(
      writes.map(async (write) => {
        if (!write.authority || isAddressEqual(write.authority, account)) {
          return { write, route: { kind: "direct" } as const };
        }
        onProgress(`Checking who operates on ${chainName(write.chainId)}…`);
        const identity = await readAuthorityIdentity(
          publicClientFor(write.chainId),
          write.authority,
        );
        return {
          write,
          route: operatorWriteRoute({ account, authority: write.authority, identity }),
        };
      }),
    );
    if (
      writes.length > 1 &&
      writes.some((write) => !REPEATABLE_OPERATOR_WRITES.has(write.functionName)) &&
      (isSafeConnection(config) ||
        routed.some((entry) => entry.route.kind === "safe-signer") ||
        !areRelayrChainsCompatible(writes.map((write) => write.chainId)))
    ) {
      throw new Error(
        "Choose one chain for this action when using Safe, unsupported networks, or a mix of mainnets and testnets. Confirm that chain's result before proceeding to another chain.",
      );
    }
    const direct = routed.filter((entry) => entry.route.kind === "direct").map((e) => e.write);
    const viaSafe = routed.filter(
      (
        entry,
      ): entry is RoutedWrite & { route: Extract<OperatorWriteRoute, { kind: "safe-signer" }> } =>
        entry.route.kind === "safe-signer",
    );

    const result: OperatorWritesResult = {
      chains: 0,
      viaRelayr: false,
      safeProposal: false,
      safeQueued: 0,
      safeConfirmed: 0,
    };

    for (const { write, route } of viaSafe) {
      const name = chainName(write.chainId);
      const client = publicClientFor(write.chainId);
      const call = {
        to: write.address,
        data: encodeFunctionData({
          abi: write.abi,
          functionName: write.functionName,
          args: write.args as unknown[],
        }),
        value: 0n,
      };
      // A proposal the Safe would revert on only wastes every signer's time.
      onProgress(`Simulating on ${name} as the operator Safe…`);
      await client.simulateContract({
        account: route.safe,
        address: write.address,
        abi: write.abi,
        functionName: write.functionName,
        args: write.args as unknown[],
      });

      onProgress(`Reading the Safe queue on ${name}…`);
      const nonce = await readBoundedSafeNonce(client, route.safe);
      if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`The operator Safe's nonce on ${name} could not be read.`);
      }
      // The pending list is load-bearing twice: it dedupes against an existing
      // proposal and it picks a free nonce. Treating an outage as an empty
      // queue would strand one of the two, so it stops the flow instead.
      const pending = await listPendingSafeTransactions(write.chainId, route.safe, Number(nonce));
      const reverify = async (signer: Address) => {
        const live = await readAuthorityIdentity(client, route.safe);
        if (live?.kind !== "safe") {
          throw new Error(`The operator on ${name} is no longer a supported Safe.`);
        }
        if (!live.owners.some((owner) => isAddressEqual(owner, signer))) {
          throw new Error(
            `The connected wallet is no longer a signer of the operator Safe on ${name}.`,
          );
        }
      };

      const existing = pending.find((tx) => queuedTransactionMatchesCall(tx, call));
      if (existing) {
        const confirmed = (existing.confirmations ?? []).some((confirmation) =>
          isAddressEqual(confirmation.owner, account),
        );
        if (!confirmed) {
          onProgress(`Sign the already-queued ${label} on ${name} in your wallet…`);
          const signature = await signSafeTransactionAsync({
            chainId: write.chainId,
            safe: route.safe,
            tx: existing,
            reverify,
          });
          await submitSafeConfirmation(write.chainId, existing, signature);
        }
        result.safeConfirmed += 1;
        continue;
      }

      const tx = safeProposalFor(call, nextProposalNonce(Number(nonce), pending));
      onProgress(`Sign the ${label} proposal for ${name} in your wallet…`);
      const signature = await signSafeTransactionAsync({
        chainId: write.chainId,
        safe: route.safe,
        tx,
        reverify,
      });
      onProgress(`Queuing the proposal with the Safe service on ${name}…`);
      await proposeSafeTransaction(write.chainId, route.safe, tx, account, signature);
      result.safeQueued += 1;
    }
    if (viaSafe.length) {
      // The Safe queue card lists what was just proposed; let it refetch.
      void queryClient.invalidateQueries({ queryKey: ["revnet-safe-queues"] });
    }

    if (!direct.length) return result;

    // Relayr forwards ERC-2771 requests signed by a key; a Safe app connection
    // has none, so it proposes each chain's call to its Safe one at a time.
    // A bundle must stay entirely on supported mainnets or entirely on testnets.
    if (
      direct.length === 1 ||
      isSafeConnection(config) ||
      !areRelayrChainsCompatible(direct.map((write) => write.chainId))
    ) {
      result.chains = await runSequentialWrites({
        writes: direct,
        account,
        writeContractAsync,
        onProgress,
      });
      return result;
    }

    const requests = await Promise.all(
      direct.map(async (write) => {
        const name = chainName(write.chainId);
        onProgress(`Simulating on ${name}…`);
        const gas = await publicClientFor(write.chainId).estimateContractGas({
          account,
          address: write.address,
          abi: write.abi,
          functionName: write.functionName,
          args: write.args as unknown[],
        });
        return {
          chainId: write.chainId,
          version: 6 as const,
          data: {
            from: account,
            to: write.address,
            value: 0n,
            gas: gasWithHeadroom(gas),
            data: encodeFunctionData({
              abi: write.abi,
              functionName: write.functionName,
              args: write.args as unknown[],
            }),
          },
          review: {
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            label: `${label} on ${name}`,
            contractName: write.contractName,
          },
        };
      }),
    );

    onProgress("Quoting the Relayr bundle…");
    const quote = await getRelayrTxQuote(requests);
    if (!quote) throw new Error("Relayr did not return a quote.");

    onProgress("Choose the chain for your Relayr payment…");
    const payment = await chooseRelayrPayment(quote.payment_info, preferredPaymentChainId);
    onProgress("Confirm the Relayr payment in your wallet…");
    const hash = await sendRelayrTx(payment);
    if (submittedViaSafe(hash)) {
      return { ...result, chains: direct.length, viaRelayr: true, safeProposal: true };
    }

    onProgress("Waiting for Relayr to execute on every chain…");
    await waitForRelayrBundle(quote.bundle_uuid);
    resetRelayr();
    return { ...result, chains: direct.length, viaRelayr: true };
  };

  return { runWrites };
}
