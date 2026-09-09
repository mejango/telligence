"use client";

import { requireOnchainExecution, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { useCallback, useRef, useState } from "react";
import { erc20Abi, type Hex, type TransactionReceipt } from "viem";
import { useAccount, usePublicClient } from "wagmi";

export function useAllowance(chainId: number, options?: { reviewedInParent?: boolean }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract({
    reviewedInParent: options?.reviewedInParent,
  });
  const [isApproving, setIsApproving] = useState(false);
  const approvalReceipts = useRef(new Map<Hex, TransactionReceipt>());

  const ensureAllowance = useCallback(
    async (tokenAddress: `0x${string}`, spender: `0x${string}`, value: bigint) => {
      if (!address) throw new Error("Wallet not connected");
      if (!publicClient) throw new Error("Please try again");

      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      });

      if (BigInt(allowance) >= BigInt(value)) return null;

      setIsApproving(true);
      try {
        const hash = await writeContractAsync({
          chainId,
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, value],
        });
        requireOnchainExecution(hash, "Token approval");
        const receipt = await waitForReceiptWithRetry(publicClient, hash);
        if (!receipt) {
          throw new Error(`Token approval ${hash} was submitted, but confirmation is unavailable.`);
        }
        if (receipt.status !== "success") {
          throw new Error(`Token approval ${hash} reverted onchain.`);
        }
        approvalReceipts.current.set(hash, receipt);
        return hash;
      } finally {
        setIsApproving(false);
      }
    },
    [address, chainId, publicClient, writeContractAsync],
  );

  const getApprovalReceipt = useCallback(
    (hash: Hex | null | undefined) => (hash ? approvalReceipts.current.get(hash) : undefined),
    [],
  );

  return { ensureAllowance, getApprovalReceipt, isApproving };
}
