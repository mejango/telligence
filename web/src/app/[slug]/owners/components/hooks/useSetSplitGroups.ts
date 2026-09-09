"use client";

import { runSequentialWrites } from "@/app/[slug]/components/v6/operator/operatorLib";
import { RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import { useToast } from "@/components/ui/use-toast";
import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import {
  isSafeConnection,
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { gasWithHeadroom } from "@/lib/gas";
import { useJBContractContext } from "@/lib/nana/project";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { chooseRelayrPayment } from "@/lib/transaction-review";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { jbControllerAbi, JBCoreContracts, SPLITS_TOTAL_PERCENT } from "@bananapus/nana-sdk-core";
import { fillSplitPercents } from "@bananapus/nana-sdk-core/v6";
import { useCallback, useEffect, useState } from "react";
import { Address, encodeFunctionData, zeroAddress, type Hash } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ChainFormData } from "../ChangeSplitRecipientsDialog";

export function useSetSplitGroups(props: { onSuccess: (txHash: string) => void }) {
  const { onSuccess } = props;
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { contractAddress } = useJBContractContext();
  const { address: userAddress, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const config = useConfig();
  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const [onSuccessCalled, setOnSuccessCalled] = useState(false);
  const [singleTxHash, setSingleTxHash] = useState<Hash>();

  const { writeContractAsync, isPending } = useWriteContract({
    mutation: {
      onSuccess() {
        toast({ title: "Transaction submitted. Awaiting confirmation..." });
      },
    },
  });
  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({
    hash: singleTxHash,
  });

  useEffect(() => {
    if (!isSuccess || onSuccessCalled || !singleTxHash) return;
    onSuccess(singleTxHash);
    setOnSuccessCalled(true);
  }, [isSuccess, onSuccess, onSuccessCalled, singleTxHash]);

  const submitSplits = useCallback(
    async (selectedChains: ChainFormData[]) => {
      if (!userAddress) return;

      setIsSubmitting(true);

      try {
        if (selectedChains.length === 0) throw new Error("Please select at least one chain");
        const direct =
          selectedChains.length === 1 ||
          isSafeConnection(config) ||
          !areRelayrChainsCompatible(selectedChains.map((chain) => chain.chainId));
        if (direct)
          selectedChains.forEach((chain) =>
            requireRelayrRecoveryScopeAvailable(
              userAddress,
              `project-splits:${chain.chainId}:${chain.projectId}:${chain.rulesetId}:${RESERVED_TOKEN_SPLIT_GROUP_ID}`,
            ),
          );
        setSingleTxHash(undefined);

        // Single chain - use direct writeContract
        if (selectedChains.length === 1) {
          setOnSuccessCalled(false);
          const chain = selectedChains[0];

          if (connectedChainId !== chain.chainId) {
            await switchChainAsync?.({ chainId: chain.chainId });
          }

          const hash = await writeContractAsync({
            abi: jbControllerAbi,
            functionName: "setSplitGroupsOf",
            chainId: chain.chainId,
            address: contractAddress(JBCoreContracts.JBController, chain.chainId),
            args: prepareArgs(chain),
          });
          setSingleTxHash(hash);

          return { success: true };
        }

        if (
          isSafeConnection(config) ||
          !areRelayrChainsCompatible(selectedChains.map((chain) => chain.chainId))
        ) {
          let lastHash: Hash | undefined;
          await runSequentialWrites({
            writes: selectedChains.map((chain) => ({
              chainId: chain.chainId,
              address: contractAddress(JBCoreContracts.JBController, chain.chainId),
              abi: jbControllerAbi,
              functionName: "setSplitGroupsOf",
              args: prepareArgs(chain),
            })),
            account: userAddress,
            writeContractAsync: async (call) => {
              lastHash = await writeContractAsync(call);
              return lastHash;
            },
            onProgress: () => undefined,
          });
          if (!lastHash) throw new Error("No split update was submitted.");
          onSuccess(lastHash);
          setOnSuccessCalled(true);
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
        if (!hash) throw new Error("Relayr payment was not submitted.");
        if (submittedViaSafe(hash)) {
          toast({
            title: "Safe payment proposal submitted",
            description:
              "The split changes are not executing yet. Complete the Relayr payment proposal in Safe and do not submit another payment.",
          });
          return { success: true };
        }
        await waitForRelayrBundle(quote.bundle_uuid);
        onSuccess(hash);
        setOnSuccessCalled(true);
        resetRelayr();
        return { success: true };
      } catch (e: any) {
        toast({
          variant: "destructive",
          title: "Error",
          description: e.message || "Failed to update splits",
        });
        console.error(e);
        return { success: false };
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      userAddress,
      connectedChainId,
      config,
      contractAddress,
      switchChainAsync,
      writeContractAsync,
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
    isPending,
    isTxLoading,
    isSuccess,
    relayrAvailable: !isSafeConnection(config),
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

  return chain.splits.map((split, index) => ({
    preferAddToBalance: split.preferAddToBalance ?? false,
    lockedUntil: split.lockedUntil ?? 0,
    percent: shares[index],
    projectId: split.projectId ?? 0n,
    beneficiary: split.beneficiary as Address,
    hook: split.hook ?? zeroAddress,
  }));
}
