"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { buildBurnTokensRequest } from "@/lib/burnTokens";
import { formatWalletError } from "@/lib/utils";
import {
  formatUnits,
  JB_CHAINS,
  JB_TOKEN_DECIMALS,
  JBChainId,
  jbContractAddress,
  JBCoreContracts,
  jbDirectoryAbi,
  jbTokensAbi,
} from "@bananapus/nana-sdk-core";
import { PropsWithChildren, useEffect, useState } from "react";
import type { Address } from "viem";
import { parseUnits, zeroAddress } from "viem";
import { useAccount, usePublicClient } from "wagmi";

export type BurnRow = {
  chainId: JBChainId;
  projectId: bigint;
  balance: bigint;
};

export function V6BurnTokensDialog({
  rows,
  tokenSymbol,
  children,
}: PropsWithChildren<{ rows: BurnRow[]; tokenSymbol: string }>) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Burn tokens</DialogTitle>
          <DialogDescription>
            Permanently remove tokens from supply without receiving treasury funds. Credits are
            burned before claimed ERC-20 tokens. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-2">
          {rows.map((row) => (
            <BurnChainRow key={row.chainId} row={row} tokenSymbol={tokenSymbol} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BurnChainRow({ row, tokenSymbol }: { row: BurnRow; tokenSymbol: string }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: row.chainId });
  const { writeContractAsync, isPending } = useWriteContract({
    transactionReview: {
      title: "Review permanent token burn",
      description:
        "This permanently destroys project tokens and returns no funds. Verify the chain and amount.",
    },
    reverify: async (variables, reviewedAccount) => {
      if (!publicClient) throw new Error("The chain client is unavailable.");
      const args = variables.args as readonly [Address, bigint, bigint, string];
      const [holder, projectId, reviewedCount] = args;
      if (holder.toLowerCase() !== reviewedAccount.toLowerCase()) {
        throw new Error("The token holder changed. Review again.");
      }
      const [latestBalance, latestController] = await Promise.all([
        publicClient.readContract({
          address: jbContractAddress["6"][JBCoreContracts.JBTokens][row.chainId],
          abi: jbTokensAbi,
          functionName: "totalBalanceOf",
          args: [holder, projectId],
        }),
        publicClient.readContract({
          address: jbContractAddress["6"][JBCoreContracts.JBDirectory][row.chainId],
          abi: jbDirectoryAbi,
          functionName: "controllerOf",
          args: [projectId],
        }),
      ]);
      if (reviewedCount > latestBalance) {
        throw new Error("Your token balance changed. Review the amount.");
      }
      if (
        latestController === zeroAddress ||
        latestController.toLowerCase() !== variables.address.toLowerCase()
      ) {
        throw new Error("The project controller changed. Review again.");
      }
    },
  });
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [hash, setHash] = useState<`0x${string}`>();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash, chainId: row.chainId });
  const { toast } = useToast();
  const chainName = JB_CHAINS[row.chainId]?.name ?? String(row.chainId);
  let count = 0n;
  try {
    count = amount.trim() ? parseUnits(amount.trim(), JB_TOKEN_DECIMALS) : 0n;
  } catch {}
  const invalid = count <= 0n || count > row.balance;
  const amountLabel = `${formatUnits(count, JB_TOKEN_DECIMALS, { fractionDigits: 4 })} ${tokenSymbol}`;

  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Tokens burned",
        description: `Burn confirmed on ${JB_CHAINS[row.chainId]?.name ?? row.chainId}.`,
      });
    }
  }, [isSuccess, row.chainId, toast]);

  async function burn() {
    if (!address || !publicClient || invalid) return;
    setError(null);
    try {
      const freshBalance = await publicClient.readContract({
        address: jbContractAddress["6"][JBCoreContracts.JBTokens][row.chainId],
        abi: jbTokensAbi,
        functionName: "totalBalanceOf",
        args: [address, row.projectId],
      });
      if (count > freshBalance) throw new Error("Your token balance changed. Review the amount.");
      const controller = await publicClient.readContract({
        address: jbContractAddress["6"][JBCoreContracts.JBDirectory][row.chainId],
        abi: jbDirectoryAbi,
        functionName: "controllerOf",
        args: [row.projectId],
      });
      if (controller === zeroAddress) throw new Error("The project has no active controller.");
      const txHash = await writeContractAsync({
        ...buildBurnTokensRequest({
          chainId: row.chainId,
          controller: controller as Address,
          holder: address,
          projectId: row.projectId,
          tokenCount: count,
          memo,
        }),
      });
      setHash(txHash);
      setReviewing(false);
    } catch (cause) {
      setError(formatWalletError(cause));
    }
  }

  return (
    <div className="border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2">
          <ChainLogo chainId={row.chainId} width={16} height={16} />
          {JB_CHAINS[row.chainId]?.name ?? row.chainId}
        </span>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setAmount(formatUnits(row.balance, JB_TOKEN_DECIMALS))}
        >
          Max {formatUnits(row.balance, JB_TOKEN_DECIMALS, { fractionDigits: 4 })}
        </button>
      </div>
      <input
        className="mt-2 w-full border border-zinc-300 bg-white px-3 py-2 text-sm"
        inputMode="decimal"
        placeholder={`Amount of ${tokenSymbol}`}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <input
        className="mt-2 w-full border border-zinc-300 bg-white px-3 py-2 text-sm"
        placeholder="Memo (optional)"
        maxLength={256}
        value={memo}
        onChange={(event) => setMemo(event.target.value)}
      />
      <ButtonWithWallet
        targetChainId={row.chainId}
        className="mt-2 w-full"
        variant="outline"
        loading={isPending || isLoading}
        disabled={invalid || isSuccess}
        onClick={() => {
          setError(null);
          setReviewing(true);
        }}
      >
        {isSuccess ? "Burned" : "Burn permanently"}
      </ButtonWithWallet>
      <TxConfirmDialog
        open={reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false);
        }}
        title="Confirm burn"
        chainId={row.chainId}
        steps={[{ title: `Burn ${amountLabel}`, detail: "Credits go first, then ERC-20 tokens." }]}
        activeIndex={isPending ? 0 : -1}
        action="Burn permanently"
        onConfirm={() => void burn()}
        busy={isPending}
        error={error}
      >
        <SummaryRow label="Burns">{amountLabel}</SummaryRow>
        <SummaryRow label="On">{chainName}</SummaryRow>
        <SummaryRow label="Returns">Nothing. Supply drops permanently.</SummaryRow>
        {memo.trim() ? <SummaryRow label="Note">{memo.trim()}</SummaryRow> : null}
      </TxConfirmDialog>
    </div>
  );
}
