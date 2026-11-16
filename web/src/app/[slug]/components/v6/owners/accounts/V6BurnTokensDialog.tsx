"use client";

import { chainDisplayName } from "@/app/constants";
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
import { Input } from "@/components/ui/input";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import {
  failedLine,
  reviewedCall,
  ReviewRefusal,
  useReviewedAction,
  type ReviewedCall,
} from "@/hooks/useReviewedAction";
import { buildBurnTokensRequest } from "@/lib/burnTokens";
import { SAFE_PROPOSAL_PENDING_LINE, SAFE_PROPOSAL_UNCONFIRMED_LINE } from "@/lib/reviewed-call";
import { formatWalletError } from "@/lib/utils";
import {
  formatUnits,
  JB_TOKEN_DECIMALS,
  JBChainId,
  JBCoreContracts,
  jbDirectoryAbi,
  jbTokensAbi,
  jbV6ContractAddress,
} from "@bananapus/nana-sdk-core";
import { burnIntent } from "@bananapus/nana-sdk-core/review";
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
            Permanently remove tokens from supply. You receive no revnet funds. This cannot be
            undone.
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
  const { run, phase, status, held } = useReviewedAction();
  /** Right before the wallet: the holder still has the tokens and the controller is the same. */
  const reverify = async (call: ReviewedCall, account: Address) => {
    if (!publicClient) throw new ReviewRefusal("The chain client is unavailable.");
    const [latestBalance, latestController] = await Promise.all([
      publicClient.readContract({
        address: jbV6ContractAddress[JBCoreContracts.JBTokens][row.chainId],
        abi: jbTokensAbi,
        functionName: "totalBalanceOf",
        args: [account, row.projectId],
      }),
      publicClient.readContract({
        address: jbV6ContractAddress[JBCoreContracts.JBDirectory][row.chainId],
        abi: jbDirectoryAbi,
        functionName: "controllerOf",
        args: [row.projectId],
      }),
    ]);
    if (count > latestBalance) {
      throw new ReviewRefusal("Your token balance changed. Review the amount.");
    }
    if (
      latestController === zeroAddress ||
      latestController.toLowerCase() !== call.to.toLowerCase()
    ) {
      throw new ReviewRefusal("The project controller changed. Review again.");
    }
  };
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [memoOpen, setMemoOpen] = useState(false);
  const [isSuccess, setSuccess] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  // Busy from Confirm: the balance and controller reads before the wallet
  // prompt are part of the send, so the confirm cannot be closed under them.
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLoading = status === "receipt";
  const isSafeResultUnconfirmed = phase === "proposed" && !!held?.exit;
  const { toast } = useToast();
  const chainName = chainDisplayName(row.chainId);
  let count = 0n;
  try {
    count = amount.trim() ? parseUnits(amount.trim(), JB_TOKEN_DECIMALS) : 0n;
  } catch {}
  const invalid = count <= 0n || count > row.balance;
  const amountLabel = `${formatUnits(count, JB_TOKEN_DECIMALS, { fractionDigits: 4 })} ${tokenSymbol}`;
  const context = [
    { label: "Burns", value: amountLabel, strong: true },
    { label: "On", value: chainName },
    { label: "Returns", value: "Nothing. Supply drops permanently." },
    ...(memo.trim() ? [{ label: "Note", value: memo.trim() }] : []),
  ];

  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Tokens burned",
        description: `Burn confirmed on ${chainDisplayName(row.chainId)}.`,
      });
    }
  }, [isSuccess, row.chainId, toast]);

  async function burn() {
    if (!address || !publicClient || invalid) return;
    setError(null);
    setSending(true);
    try {
      const freshBalance = await publicClient.readContract({
        address: jbV6ContractAddress[JBCoreContracts.JBTokens][row.chainId],
        abi: jbTokensAbi,
        functionName: "totalBalanceOf",
        args: [address, row.projectId],
      });
      if (count > freshBalance) throw new Error("Your token balance changed. Review the amount.");
      const controller = await publicClient.readContract({
        address: jbV6ContractAddress[JBCoreContracts.JBDirectory][row.chainId],
        abi: jbDirectoryAbi,
        functionName: "controllerOf",
        args: [row.projectId],
      });
      if (controller === zeroAddress) throw new Error("The project has no active controller.");
      // Held by the holder's burn of this project (the SDK's burnIntent); the exact call an
      // earlier build held it by holds it too.
      const holder = address;
      const result = await run({
        account: holder,
        title: "Review permanent token burn",
        description:
          "This permanently destroys project tokens and returns no funds. Verify the chain and amount.",
        context,
        reverify: (call) => reverify(call, holder),
        // Sent: the confirm closes while the burn confirms onchain.
        onSubmitted: () => {
          setReviewing(false);
          setSending(false);
        },
        calls: [
          reviewedCall(
            buildBurnTokensRequest({
              chainId: row.chainId,
              controller: controller as Address,
              holder,
              projectId: row.projectId,
              tokenCount: count,
              memo,
            }),
            { intent: burnIntent({ chainId: row.chainId, project: row.projectId, holder }) },
          ),
        ],
      });
      if (!result) setReviewing(false);
      if (result?.status === "failed") throw new ReviewRefusal(failedLine(result));
      if (result?.status === "done") setSuccess(true);
      if (result?.status === "proposed")
        toast({ title: "Safe proposal submitted", description: SAFE_PROPOSAL_PENDING_LINE });
    } catch (cause) {
      setError(formatWalletError(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border border-zinc-200 p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2">
          <ChainLogo chainId={row.chainId} width={16} height={16} />
          {chainDisplayName(row.chainId)}
        </span>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setAmount(formatUnits(row.balance, JB_TOKEN_DECIMALS))}
        >
          Max {formatUnits(row.balance, JB_TOKEN_DECIMALS, { fractionDigits: 4 })}
        </button>
      </div>
      <Input
        className="mt-2"
        inputMode="decimal"
        placeholder={`Amount of ${tokenSymbol}`}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <label className="mt-2 flex items-center gap-2 text-sm font-medium text-zinc-800">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={memoOpen}
          onChange={() => {
            if (memoOpen) setMemo("");
            setMemoOpen(!memoOpen);
          }}
        />
        Add a note
      </label>
      {memoOpen ? (
        <Input
          className="mt-2"
          aria-label={`Note for the burn on ${chainName}`}
          placeholder="Note"
          maxLength={256}
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
        />
      ) : null}
      <ButtonWithWallet
        targetChainId={row.chainId}
        className="mt-2 w-full"
        variant="outline"
        loading={sending || isLoading}
        disabled={invalid || isSuccess}
        onClick={() => {
          setError(null);
          setReviewing(true);
        }}
      >
        {isSuccess ? "Burned" : "Burn permanently"}
      </ButtonWithWallet>
      {isSafeResultUnconfirmed ? (
        <p className="mt-2 text-xs text-zinc-600">{SAFE_PROPOSAL_UNCONFIRMED_LINE}</p>
      ) : null}
      <TxProgress
        open={reviewing}
        onClose={() => setReviewing(false)}
        title="Confirm burn"
        steps={[{ title: `Burn ${amountLabel}` }]}
        activeIndex={sending ? 0 : -1}
        start={() => void burn()}
        busy={sending}
        error={error}
        rows={context}
      />
    </div>
  );
}
