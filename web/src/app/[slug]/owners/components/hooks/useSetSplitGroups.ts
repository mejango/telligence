"use client";

import { runSequentialWrites } from "@/app/[slug]/components/v6/operator/operatorLib";
import { RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import { useToast } from "@/components/ui/use-toast";
import {
  isSafeProposalPendingError,
  reviewClosed,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import { submittedViaSafe } from "@/lib/held-rows";
import { useJBContractContext } from "@/lib/nana/project";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { isSafeConnection, useSafeConnection } from "@/lib/safe-connector";
import {
  isStickyRow,
  requireStickyDistributor,
  stickyDraftGroupId,
  stickyGroupDraft,
  stickyGroupOf,
} from "@/lib/sticky";
import { chooseRelayrPayment } from "@/lib/transaction-review";
import { formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { heldLineOf } from "@/lib/write-hold";
import { jbControllerAbi, JBCoreContracts, SPLITS_TOTAL_PERCENT } from "@bananapus/nana-sdk-core";
import type { ReviewContextRow } from "@bananapus/nana-sdk-core/review";
import { gasWithHeadroom } from "@bananapus/nana-sdk-core/review";
import { fillSplitPercents } from "@bananapus/nana-sdk-core/v6";
import { useCallback, useState } from "react";
import { Address, encodeFunctionData, zeroAddress } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ChainFormData, SplitFormData } from "../ChangeSplitRecipientsDialog";

export function useSetSplitGroups(props: { onSuccess: (txHash: string) => void }) {
  const { onSuccess } = props;
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { contractAddress } = useJBContractContext();
  const { address: userAddress, chainId: connectedChainId } = useAccount();
  const config = useConfig();
  const viaSafe = useSafeConnection(config);
  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const { run, phase, status, held, busy } = useReviewedAction();

  const submitSplits = useCallback(
    async (selectedChains: ChainFormData[], context?: readonly ReviewContextRow[]) => {
      if (!userAddress) return;

      setIsSubmitting(true);

      try {
        if (selectedChains.length === 0) throw new Error("Please select at least one chain");
        const direct =
          selectedChains.length === 1 ||
          isSafeConnection(config) ||
          !areRelayrChainsCompatible(selectedChains.map((chain) => chain.chainId));
        if (direct)
          for (const chain of selectedChains)
            await requireRelayrRecoveryScopeAvailable(
              userAddress,
              `project-splits:${chain.chainId}:${chain.projectId}:${chain.rulesetId}:${RESERVED_TOKEN_SPLIT_GROUP_ID}`,
            );
        if (direct) {
          const hashes = await runSequentialWrites({
            writes: selectedChains.map((chain) => ({
              chainId: chain.chainId,
              address: contractAddress(JBCoreContracts.JBController, chain.chainId),
              abi: jbControllerAbi,
              functionName: "setSplitGroupsOf",
              args: prepareArgs(chain),
            })),
            account: userAddress,
            label: "Update reserved token recipients",
            run,
            context,
          });
          const lastHash = hashes.at(-1);
          if (!lastHash) throw new Error("No split update was submitted.");
          onSuccess(lastHash);
          return { success: true };
        }

        // Multi-chain - use relayr
        const relayrTransactions = [];

        for (const chain of selectedChains) {
          const publicClient = getPublicClient(wagmiConfig, { chainId: chain.chainId });
          if (!publicClient) throw new Error("Public client not available");

          const controller = contractAddress(JBCoreContracts.JBController, chain.chainId);
          const args = prepareArgs(chain);

          const gasEstimate = await publicClient.estimateContractGas({
            address: controller,
            abi: jbControllerAbi,
            functionName: "setSplitGroupsOf",
            args,
            account: userAddress,
          });

          relayrTransactions.push({
            recoveryScope: `project-splits:${chain.chainId}:${chain.projectId}:${chain.rulesetId}:${RESERVED_TOKEN_SPLIT_GROUP_ID}`,
            data: {
              from: userAddress,
              to: controller,
              value: 0n,
              gas: gasWithHeadroom(gasEstimate),
              data: encodeFunctionData({
                abi: jbControllerAbi,
                functionName: "setSplitGroupsOf",
                args,
              }),
            },
            chainId: chain.chainId,
            version: 6 as const,
            review: {
              abi: jbControllerAbi,
              functionName: "setSplitGroupsOf",
              args,
              label: "Update reserved token recipients",
              contractName: "JBController",
            },
          });
        }

        const quote = await getRelayrTxQuote(relayrTransactions);
        if (!quote) throw new Error("Failed to get relayr tx quote");

        const payment = await chooseRelayrPayment(quote.payment_info, connectedChainId);
        const hash = await sendRelayrTx?.(payment);
        if (!hash) throw new Error("Payment was not submitted.");
        if (submittedViaSafe(hash)) {
          toast({
            title: "Safe payment proposal submitted",
            description:
              "The split changes are not executing yet. Complete the payment proposal in Safe and do not submit another payment.",
          });
          return { success: true };
        }
        await waitForRelayrBundle(quote.bundle_uuid);
        onSuccess(hash);
        resetRelayr();
        return { success: true };
      } catch (e: any) {
        if (reviewClosed(e)) return { success: false, closed: true };
        // A chain's write went to the Safe as a proposal, and the later chains wait on it.
        if (isSafeProposalPendingError(e)) {
          toast({ title: "Safe proposal submitted", description: formatWalletError(e) });
          return { success: false, proposal: formatWalletError(e) };
        }
        const error = formatWalletError(e, "Failed to update splits");
        toast({ variant: "destructive", title: "Error", description: error });
        console.error(e);
        return { success: false, error };
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      userAddress,
      connectedChainId,
      config,
      contractAddress,
      run,
      getRelayrTxQuote,
      sendRelayrTx,
      toast,
      resetRelayr,
      onSuccess,
    ],
  );

  return {
    submitSplits,
    isSubmitting,
    isPending: busy && status !== "receipt",
    isTxLoading: status === "receipt",
    /** A Safe proposal the hold can no longer prove: its account checks it in Safe. */
    isTxUnconfirmed: phase === "proposed" && Boolean(held?.exit),
    /** The write went to the Safe as a proposal and has not executed. */
    isSafeProposal: phase === "proposed",
    /** The run ended with the write still held: it may still land. */
    isTxReceiptUnconfirmed: phase === "idle" && Boolean(held),
    /** The hold's line for that write. */
    txHeldLine: held ? heldLineOf(held) : undefined,
    relayrAvailable: !viaSafe,
  };
}

export function prepareArgs(chain: ChainFormData) {
  return [
    chain.projectId,
    chain.rulesetId,
    [{ groupId: RESERVED_TOKEN_SPLIT_GROUP_ID, splits: prepareSplits(chain) }],
  ] as const;
}

/**
 * `setSplitGroupsOf` replaces a group wholesale, so every field of every split
 * has to be re-sent. Only percent and beneficiary are the form's to change —
 * hook, projectId and lockedUntil are carried through, or a save would strip a
 * split's routing and drop locks the chain still enforces.
 */
function prepareSplits(chain: ChainFormData) {
  const splitPercent = chain.splits.reduce((sum, s) => sum + Number(s.percentage), 0) * 100;

  // Independent Math.round per row can sum to 1e9 ± 1, which JBSplits rejects outright
  // (`JBSplits_TotalPercentExceeds100`) — the save then fails at simulate with an opaque
  // error. `fillSplitPercents` assigns the remainder so the group totals exactly.
  const shares = fillSplitPercents(
    chain.splits.map((split) =>
      Math.round((Number(split.percentage) * 100 * SPLITS_TOTAL_PERCENT) / splitPercent),
    ),
  );

  return chain.splits.map((split, index) =>
    isStickyRow(split)
      ? {
          preferAddToBalance: false,
          lockedUntil: split.lockedUntil ?? 0,
          percent: shares[index],
          projectId: stickySplitGroupId(split),
          beneficiary: split.beneficiary as Address,
          hook: requireStickyDistributor(chain.chainId),
        }
      : {
          preferAddToBalance: split.preferAddToBalance ?? false,
          lockedUntil: split.lockedUntil ?? 0,
          percent: shares[index],
          projectId: split.projectId ?? 0n,
          beneficiary: split.beneficiary as Address,
          hook: split.hook ?? zeroAddress,
        },
  );
}

/**
 * A Sticky row's group ID. An untouched group re-sends the stored ID verbatim, so a locked
 * split (or one saved with a group the distributor reads as 0) stays byte-exact.
 */
export function stickySplitGroupId(split: SplitFormData): bigint {
  const group = stickyGroupOf(split);
  const stored = split.projectId;
  if (stored !== undefined) {
    const decoded = stickyGroupDraft(stored);
    if (
      decoded.stickyGroup === group.stickyGroup &&
      decoded.stickyMinWeeks === group.stickyMinWeeks.trim() &&
      decoded.stickyMaxWeeks === group.stickyMaxWeeks.trim()
    ) {
      return stored;
    }
  }
  return stickyDraftGroupId(group);
}
