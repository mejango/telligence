"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SummaryRow } from "@/components/ui/TxConfirmDialog";
import { TxSteps } from "@/components/ui/TxSteps";
import { type DirectSwapQuote, type Permit2SignatureAuthorization } from "@/lib/directPaySwap";
import { etherscanLink } from "@/lib/utils";
import { formatPayAmount, V6PayMode, V6PayTokenOption } from "@/lib/v6/pay";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { Abi, Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { useSelectedSucker } from "../../PayCard/SelectedSuckerContext";

export type V6PayPhase =
  | "preparing"
  | "ready"
  | "approving-token"
  | "approving-router"
  | "simulating"
  | "signing"
  | "pending"
  | "safe-proposed"
  | "success";

export interface PreparedV6TransactionAction {
  kind: "token-approval" | "router-approval" | "payment";
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

interface PreparedV6SignatureAction {
  kind: "router-signature";
  label: string;
  authorization: Permit2SignatureAuthorization;
}

/** A fully resolved, encodable pay/add-to-balance transaction. */
export interface PreparedV6Pay {
  mode: V6PayMode;
  chainId: JBChainId;
  token: V6PayTokenOption;
  amount: bigint;
  memo: string;
  terminal: Address;
  /** True when the resolved route goes through the router registry (swap). */
  viaRouterRoute: boolean;
  /** True when payment bypasses the terminal for a better direct pool swap. */
  directSwapRoute: boolean;
  /** How a direct swap reaches the project's hooked V4 pool. */
  swapInputRoute: DirectSwapQuote["inputRoute"] | null;
  /** Fresh previewed token return (null for add-to-balance). */
  expectedTokens: bigint | null;
  reservedTokens: bigint | null;
  minReturned: bigint;
  needsApproval: boolean;
  needsPermit2Approval: boolean;
  tokenApprovalComplete: boolean;
  routerAuthorizationComplete: boolean;
  tokenApproval: PreparedV6TransactionAction | null;
  routerApproval: PreparedV6TransactionAction | null;
  routerSignature: PreparedV6SignatureAction | null;
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
  "approving-token":
    "Confirm token access in your wallet. The payment will continue automatically…",
  "approving-router":
    "Sign or confirm the swap-router authorization in your wallet. The payment will continue automatically…",
  simulating: "Simulating the transaction…",
  signing: "Confirm in your wallet…",
  pending: "Transaction submitted, awaiting confirmation…",
};

/**
 * The confirm-before-send dialog: a human summary of exactly what will be
 * sent and the wallet-aware action button. The payment card owns route and
 * chain selection; this dialog only confirms the resolved transaction.
 */
export function V6PayConfirmDialog({
  open,
  onOpenChange,
  prepared,
  phase,
  mode,
  error,
  projectTokenSymbol,
  txHash,
  onConfirm,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prepared: PreparedV6Pay | null;
  phase: V6PayPhase;
  mode: V6PayMode;
  error: string | null;
  projectTokenSymbol: string;
  txHash: `0x${string}` | undefined;
  onConfirm: () => void;
  /** Retained for caller compatibility; chain selection belongs to the payment card. */
  onSwitchChain?: (chainId: string) => void;
  onDone: () => void;
}) {
  const busy =
    phase === "approving-token" ||
    phase === "approving-router" ||
    phase === "simulating" ||
    phase === "signing" ||
    phase === "pending";
  const { address } = useAccount();
  const { selectedSucker } = useSelectedSucker();
  const chainId = prepared?.chainId ?? selectedSucker.peerChainId;
  const chainMeta = JB_CHAINS[chainId];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
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
                      : "The balance grew — no tokens were minted."}
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
                    The Safe has accepted this proposal, but the payment has not reached the project
                    yet. It still needs the required approvals and successful onchain execution.
                    Track the persistent transaction status and do not submit it again.
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
                      <SummaryRow label="Send">
                        {formatPayAmount(prepared.amount, prepared.token.decimals)}{" "}
                        {prepared.token.symbol}
                      </SummaryRow>
                      <SummaryRow label="On">
                        {chainMeta?.name ?? String(prepared.chainId)}
                      </SummaryRow>
                      {prepared.mode === "pay" ? (
                        <SummaryRow
                          label={prepared.viaRouterRoute ? "You get at least" : "You get"}
                        >
                          {formatPayAmount(prepared.minReturned, 18)} {projectTokenSymbol}
                        </SummaryRow>
                      ) : (
                        <SummaryRow label="Effect">
                          Adds to the project balance — nothing else.
                        </SummaryRow>
                      )}
                      {prepared.swapInputRoute && prepared.swapInputRoute.kind !== "single-v4" ? (
                        <SummaryRow label="Route">
                          {prepared.token.symbol} → {prepared.swapInputRoute.bridgeTokenSymbol} →{" "}
                          {projectTokenSymbol}
                        </SummaryRow>
                      ) : null}
                      {prepared.cartRows.length > 0 ? (
                        <SummaryRow label="Items">
                          {prepared.cartRows
                            .map((row) => `${row.quantity}× ${row.name}`)
                            .join(", ")}
                        </SummaryRow>
                      ) : null}
                      {prepared.memo ? <SummaryRow label="Note">{prepared.memo}</SummaryRow> : null}
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
                    </div>
                  ) : error ? (
                    <p className="py-4 text-sm text-red-600">{error}</p>
                  ) : null}

                  <div className="flex justify-end">
                    <ButtonWithWallet
                      targetChainId={chainId}
                      loading={busy || (phase === "preparing" && !!address)}
                      onClick={onConfirm}
                      connectWalletText="Connect Wallet"
                      className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                    >
                      {mode === "pay" ? "Pay" : "Add to balance"}
                    </ButtonWithWallet>
                  </div>
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
  if (prepared.needsApproval) {
    steps.push(`Approve ${prepared.token.symbol} access`);
  }
  if (prepared.needsPermit2Approval) {
    steps.push(
      prepared.routerSignature
        ? "Sign the swap authorization"
        : "Authorize the Uniswap swap router",
    );
  }
  steps.push(
    prepared.mode === "pay"
      ? prepared.directSwapRoute
        ? "Execute the swap"
        : "Execute the payment"
      : "Add to the project balance",
  );
  return steps;
}

function activeStepIndex(prepared: PreparedV6Pay, phase: V6PayPhase): number {
  const steps = walletActionSteps(prepared);
  if (phase === "approving-token") return 0;
  if (phase === "approving-router") return prepared.needsApproval ? 1 : 0;
  if (phase === "simulating" || phase === "signing" || phase === "pending") return steps.length - 1;
  if (phase === "success") return steps.length;
  if (prepared.needsApproval && !prepared.tokenApprovalComplete) return 0;
  if (prepared.needsPermit2Approval && !prepared.routerAuthorizationComplete) {
    return prepared.needsApproval ? 1 : 0;
  }
  return steps.length - 1;
}
