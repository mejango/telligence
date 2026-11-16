"use client";

import { AllowedDecreaseField } from "@/components/AllowedDecreaseField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SummaryRow } from "@/components/ui/TxProgress";
import { TxSteps } from "@/components/ui/TxSteps";
import { etherscanLink } from "@/lib/utils";
import { V6PayMode, V6PayTokenOption } from "@/lib/v6/pay";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { useStartOnce } from "@bananapus/nana-sdk-core/review/react";
import type { Permit2SignatureAuthorization } from "@bananapus/nana-sdk-core/v6";
import { PAY_MAX_SLIPPAGE_BPS, PAY_QUOTE_FAILED_MESSAGE } from "@bananapus/nana-sdk-core/v6";
import { Abi, Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { useSelectedSucker } from "../../PayCard/SelectedSuckerContext";
import { payContext } from "./payContext";

export { payContext };

export type V6PayPhase =
  | "preparing"
  | "ready"
  | "authorizing"
  | "approving-token"
  | "simulating"
  | "signing"
  | "pending"
  | "safe-proposed"
  | "success";

interface PreparedV6TransactionAction {
  kind: "token-approval" | "payment";
  label: string;
  request: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value: bigint;
  };
  calldata: Hex;
}

/** A fully resolved, encodable pay/add-to-balance transaction. */
export interface PreparedV6Pay {
  /** The card inputs it was built from; a change means it needs review again. */
  identity: string;
  /** The account it was built for: a payment's tokens go to it. */
  account: Address;
  /** The project's payment notice as it read when this was prepared. */
  projectNotice: string;
  mode: V6PayMode;
  chainId: JBChainId;
  token: V6PayTokenOption;
  amount: bigint;
  memo: string;
  terminal: Address;
  /** Fresh previewed token return (null for add-to-balance). */
  expectedTokens: bigint | null;
  reservedTokens: bigint | null;
  minReturned: bigint;
  /** The pool price was unreadable: `minReturned` is only the mint rate. */
  quoteFailed: boolean;
  needsApproval: boolean;
  tokenApprovalComplete: boolean;
  tokenApproval: PreparedV6TransactionAction | null;
  /** The exact Permit2 allowance the payer signs for this payment, free of gas; null when none is needed. */
  authorization: Permit2SignatureAuthorization | null;
  cartRows: { tierId: number; quantity: number; name: string }[];
  request: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value: bigint;
  };
  calldata: Hex;
}

const PHASE_LABELS: Record<Exclude<V6PayPhase, "ready" | "safe-proposed" | "success">, string> = {
  preparing: "Preparing…",
  authorizing: "Sign the payment authorization in your wallet. It is free.",
  "approving-token":
    "Confirm token access in your wallet. The payment will continue automatically…",
  simulating: "Checking the transaction…",
  signing: "Confirm in your wallet…",
  pending: "Transaction submitted, awaiting confirmation…",
};

/**
 * The payment's progress: a human summary of what is sent, its wallet steps,
 * and a recovery button after a failure. It never confirms: the payment's one
 * review opens as soon as it is prepared. The payment card owns route and chain
 * selection.
 */
export function V6PayConfirmDialog({
  open,
  onOpenChange,
  prepared,
  phase,
  mode,
  error,
  reviewAgain,
  retrySlippage,
  quoteSettled = true,
  projectTokenSymbol,
  txHash,
  onConfirm,
  onDone,
  following = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prepared: PreparedV6Pay | null;
  phase: V6PayPhase;
  mode: V6PayMode;
  error: string | null;
  /** The payment reverted onchain: the button quotes and reviews it again. */
  reviewAgain?: boolean;
  /** After a minimum shortfall: the looser tolerance the payment is reviewed again with. */
  retrySlippage?: { bps: number; onChange: (bps: number) => void } | null;
  /** The route quote the payment is checked against has settled; its review waits for it. */
  quoteSettled?: boolean;
  projectTokenSymbol: string;
  txHash: `0x${string}` | undefined;
  onConfirm: () => void;
  /** Retained for caller compatibility; chain selection belongs to the payment card. */
  onSwitchChain?: (chainId: string) => void;
  onDone: () => void;
  /** The sent payment is only followed until its hold settles: the confirm can close. */
  following?: boolean;
}) {
  const busy =
    phase === "authorizing" ||
    phase === "approving-token" ||
    phase === "simulating" ||
    phase === "signing" ||
    phase === "pending";
  const { address } = useAccount();
  const { selectedSucker } = useSelectedSucker();
  const chainId = prepared?.chainId ?? selectedSucker.peerChainId;
  // The payment's one review opens as soon as it is prepared; the button is only for recovery.
  const recovering = !!error || !!retrySlippage || !!reviewAgain;
  useStartOnce(
    open,
    false,
    onConfirm,
    prepared,
    phase !== "ready" || !prepared || recovering || !address || !quoteSettled,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !following) return;
        if (!next && phase === "success") onDone();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>
            {phase === "success"
              ? mode === "pay"
                ? "Payment confirmed"
                : "Added to the balance"
              : phase === "safe-proposed"
                ? "Safe proposal submitted"
                : mode === "pay"
                  ? "Confirm payment"
                  : "Confirm add to balance"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left">
              {phase === "success" ? (
                <div className="py-2">
                  <p className="text-sm text-zinc-700">
                    {mode === "pay"
                      ? "Your payment went through."
                      : "The balance grew. No tokens were minted."}
                  </p>
                  {txHash && etherscanLink(txHash, { type: "tx", chainId }) ? (
                    <a
                      href={etherscanLink(txHash, { type: "tx", chainId })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
                    >
                      View the transaction
                    </a>
                  ) : null}
                  <div className="mt-4">
                    <Button
                      className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                      onClick={onDone}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              ) : phase === "safe-proposed" ? (
                <div className="py-2">
                  <p className="text-sm leading-relaxed text-zinc-700">
                    The payment is proposed in Safe. It still needs the required approvals and a
                    successful transaction. Follow its saved status before trying again.
                  </p>
                  {txHash ? (
                    <p className="mt-2 break-all font-mono text-xs text-zinc-500">{txHash}</p>
                  ) : null}
                  <Button
                    className="mt-4 bg-teal-500 text-melon-950 hover:bg-teal-600"
                    onClick={() => onOpenChange(false)}
                  >
                    Close and track status
                  </Button>
                </div>
              ) : (
                <>
                  {phase === "preparing" ? (
                    <div className="py-4 text-sm text-zinc-500">
                      {address
                        ? PHASE_LABELS.preparing
                        : "Connect your wallet to get a live quote."}
                    </div>
                  ) : prepared ? (
                    <div className="flex flex-col gap-3 py-2">
                      {payContext(prepared, projectTokenSymbol).map((row) => (
                        <SummaryRow key={row.label} label={row.label}>
                          {row.value}
                        </SummaryRow>
                      ))}
                      {prepared.mode === "pay" && prepared.quoteFailed && !busy && !error ? (
                        <p className="text-xs text-zinc-600">{PAY_QUOTE_FAILED_MESSAGE}</p>
                      ) : null}
                      {/* Each action's exact payload is reviewed in the one
                          transaction safety check, the same shell every
                          multi-step flow uses. */}
                      <TxSteps
                        steps={walletActionSteps(prepared).map((title) => ({ title }))}
                        activeIndex={activeStepIndex(prepared, phase)}
                      />

                      {busy ? (
                        <p className="text-sm text-zinc-500">
                          {PHASE_LABELS[phase as keyof typeof PHASE_LABELS]}
                        </p>
                      ) : null}
                      {error ? <p className="text-sm text-red-600">{error}</p> : null}
                      {retrySlippage ? (
                        <AllowedDecreaseField
                          className=""
                          bps={retrySlippage.bps}
                          onChange={retrySlippage.onChange}
                          maxBps={Number(PAY_MAX_SLIPPAGE_BPS)}
                        />
                      ) : null}
                    </div>
                  ) : error ? (
                    <p className="py-4 text-sm text-red-600">{error}</p>
                  ) : null}

                  {recovering || (!prepared && phase !== "preparing") ? (
                    <div className="flex justify-end">
                      {/* The pay card asks for a wallet before this opens, and the payment's own
                        writes switch the wallet to its chain after review. */}
                      <Button
                        loading={busy || (phase === "preparing" && !!address)}
                        disabled={!address}
                        onClick={onConfirm}
                        className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                      >
                        {retrySlippage || reviewAgain
                          ? "Review again"
                          : !prepared
                            ? "Try again"
                            : mode === "pay"
                              ? "Pay"
                              : "Add to balance"}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

function walletActionSteps(prepared: PreparedV6Pay): string[] {
  const steps: string[] = [];
  if (prepared.authorization) steps.push("Authorize the payment (free signature)");
  if (prepared.tokenApproval) steps.push(prepared.tokenApproval.label);
  steps.push(prepared.mode === "pay" ? "Execute the payment" : "Add to the project balance");
  return steps;
}

function activeStepIndex(prepared: PreparedV6Pay, phase: V6PayPhase): number {
  const steps = walletActionSteps(prepared);
  if (phase === "authorizing") return 0;
  if (phase === "approving-token") return steps.length - 2;
  if (phase === "simulating" || phase === "signing" || phase === "pending") return steps.length - 1;
  if (phase === "success") return steps.length;
  if (prepared.authorization) return 0;
  if (prepared.needsApproval && !prepared.tokenApprovalComplete) return 0;
  return steps.length - 1;
}
