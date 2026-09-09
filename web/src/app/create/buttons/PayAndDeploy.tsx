import { chainDisplayName } from "@/app/constants";
import EtherscanLink from "@/components/EtherscanLink";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  CircleDashedIcon,
  CircleDotDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  FastForward,
  SquareArrowOutUpRightIcon,
} from "@/components/ui/icons";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useGetRelayrTxBundle, useSendRelayrTx } from "@/hooks/useReviewedRelayr";
import { submittedViaSafe } from "@/hooks/useReviewedWriteContract";
import type {
  ChainPayment,
  RelayrGetBundleResponse,
  RelayrPostBundleResponse,
} from "@/lib/nana/types";
import { formatHexEther, formatWalletError } from "@/lib/utils";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { Hash } from "viem";
import { useCreateForm } from "../form/useCreateForm";
import { ensureFreshQuote, type QuotedStageStart } from "../helpers/staleQuote";
import { GoToProjectButton } from "./GoToProjectButton";

interface PaymentAndDeploySectionProps {
  relayrResponse: RelayrPostBundleResponse;
  revnetTokenSymbol: string;
  quotedStageStart?: QuotedStageStart;
  rebuildStaleQuote?: () => Promise<RelayrPostBundleResponse>;
}

const statusToIcon = (status: string) => {
  if (status === "Pending")
    return <CircleDashedIcon className="w-5 h-5 text-amber-400 animate-spin" />;
  if (status === "Mempool")
    return <CircleDotDashedIcon className="w-5 h-5 text-blue-400 animate-spin" />;
  if (status === "Included")
    return <CircleDotIcon className="w-5 h-5 text-cyan-400 animate-spin" />;
  if (status === "Success" || status === "Completed")
    return <CheckCircle className="w-5 h-5 text-emerald-500 fade-in-50" />;
  return <CircleXIcon className="w-5 h-5 text-red-500 fade-in-50" />;
};

function destinationHash(transaction: RelayrGetBundleResponse["transactions"][number]) {
  const data = transaction.status?.data as
    { hash?: Hash; transaction?: { hash?: Hash } } | undefined;
  return data?.hash ?? data?.transaction?.hash;
}

export function PayAndDeploy({
  relayrResponse,
  revnetTokenSymbol,
  quotedStageStart,
  rebuildStaleQuote,
}: PaymentAndDeploySectionProps) {
  const [selectedPayment, selectPayment] = useState<ChainPayment | null>(null);
  const [payIsProcessing, setPayIsProcessing] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [safeProposalSubmitted, setSafeProposalSubmitted] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { values } = useCreateForm();
  const { sendRelayrTx, data: paymentHash } = useSendRelayrTx();
  const {
    startPolling,
    response: bundleResponse,
    isComplete,
    hasFailed,
    isPolling,
    error: bundleError,
  } = useGetRelayrTxBundle();
  const { toast } = useToast();
  // A receipt or bundle verification error cannot make an existing payment safe to repeat.
  const paymentSent = paymentSubmitted || !!paymentHash;
  const paymentLocked = paymentSent || isComplete || hasFailed;
  const busy = payIsProcessing || isPolling;

  return (
    <div>
      <RelayrPaymentSelect
        payments={relayrResponse.payment_info}
        tokenSymbol="ETH"
        selectedPayment={selectedPayment}
        onSelectPayment={selectPayment}
        disabled={payIsProcessing || paymentLocked}
      />
      <div className="flex justify-end md:col-span-3 mt-4">
        <Button
          type="submit"
          size="lg"
          disabled={payIsProcessing || paymentLocked || !selectedPayment}
          className="disabled:text-black disabled:bg-transparent disabled:border disabled:border-black disabled:bg-gray-100 bg-teal-500 text-melon-950 hover:bg-teal-600"
          onClick={() => {
            setError(null);
            setReview(true);
          }}
        >
          Pay and ship
          {isComplete ? (
            <CheckCircle className={"h-4 w-4 ml-2 fill-none text-emerald-500"} />
          ) : (
            <FastForward
              className={twMerge(
                "h-4 w-4 fill-melon-950 ml-2",
                busy ? "animate-spin" : paymentLocked ? "" : "animate-pulse",
              )}
            />
          )}
        </Button>
      </div>
      {review && selectedPayment ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReview(false);
          }}
          title="Confirm payment"
          chainId={selectedPayment.chain}
          steps={[
            {
              title: `Pay ${formatHexEther(selectedPayment.amount)} ETH to relay`,
              detail: "Relayr then deploys on every chain; no further prompts.",
            },
          ]}
          activeIndex={payIsProcessing ? 0 : -1}
          action="Pay and ship"
          busy={payIsProcessing}
          disabled={paymentLocked}
          error={error}
          onConfirm={async () => {
            if (payIsProcessing || paymentLocked) return;
            setPayIsProcessing(true);
            setError(null);
            try {
              if (!selectedPayment || !sendRelayrTx) throw new Error("No payment selected");
              const { bundle, payment } = await ensureFreshQuote({
                bundle: relayrResponse,
                payment: selectedPayment,
                quotedStageStart,
                rebuildStaleQuote,
                onRebuild: () =>
                  toast({
                    title: "Refreshing stale quote",
                    description:
                      "This quote's encoded start time has passed. Sign the refreshed deploy requests to keep cash-outs and loans open at launch.",
                  }),
              });
              if (payment !== selectedPayment) selectPayment(payment);
              const hash = await sendRelayrTx(payment);
              setPaymentSubmitted(true);
              if (submittedViaSafe(hash)) {
                setSafeProposalSubmitted(true);
                setReview(false);
                toast({
                  title: "Safe payment proposal submitted",
                  description:
                    "The Relayr bundle is not paid yet. Approve and execute the payment in Safe, then check this bundle; do not propose another payment. Execute it before the quoted start time — about 10 minutes after the quote was created — or cash-outs and loans will be locked for 7 days from execution.",
                });
                return;
              }
              setReview(false);
              startPolling(bundle.bundle_uuid);
            } catch (e: any) {
              setError(formatWalletError(e));
              toast({
                title: "Error",
                description: formatWalletError(e),
                variant: "destructive",
              });
            } finally {
              setPayIsProcessing(false);
            }
          }}
        >
          <SummaryRow label="Pays">{formatHexEther(selectedPayment.amount)} ETH</SummaryRow>
          <SummaryRow label="On">{chainDisplayName(selectedPayment.chain)}</SummaryRow>
          <SummaryRow label="Deploys on">
            {values.chainIds.map((chainId) => chainDisplayName(chainId)).join(", ")}
          </SummaryRow>
          <SummaryRow label="Revnet">
            {values.name || "Unnamed"} (${revnetTokenSymbol})
          </SummaryRow>
        </TxConfirmDialog>
      ) : null}
      {safeProposalSubmitted ? (
        <p className="mt-4 text-sm text-melon-700">
          Complete the existing payment proposal in Safe, then check transaction activity. Do not
          submit another payment.
        </p>
      ) : null}
      {bundleError ? (
        <p
          role="alert"
          className="mt-4 border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800"
        >
          {formatWalletError(bundleError)} Check the existing bundle in transaction activity. Do not
          make another Relayr payment.
        </p>
      ) : null}
      {!!bundleResponse && (
        <div className="mt-10 flex flex-col space-y-2">
          <div className="text-left text-zinc-500 mb-2">
            Your revnet is made up of components deployed on each blockchain where it'll accept
            funds and issue {revnetTokenSymbol} from. These transactions take 1-2 minutes to settle.
          </div>
          <div className="grid grid-cols-3 gap-4 font-semibold border-b mb-2">
            <div>Network</div>
            <div>Status</div>
            <div>Transaction</div>
          </div>
          {bundleResponse.transactions.map(
            (txn) =>
              txn?.status && (
                <div key={txn?.tx_uuid} className="grid grid-cols-3 gap-4">
                  <div>{chainDisplayName(txn.request.chain as JBChainId)}</div>
                  <div className="flex flex-row space-x-2 items-center justify-start">
                    <div>{statusToIcon(txn.status.state)}</div>
                    <div>{txn.status.state}</div>
                  </div>
                  {destinationHash(txn) ? (
                    <div className="flex flex-row space-x-1 items-center">
                      <EtherscanLink
                        value={destinationHash(txn)}
                        type="tx"
                        chain={JB_CHAINS[txn.request.chain as JBChainId].chain}
                        truncateTo={6}
                      />
                      <SquareArrowOutUpRightIcon className="w-3 h-3" />
                    </div>
                  ) : (
                    <div className="animate-pulse italic">generating...</div>
                  )}
                </div>
              ),
          )}
          {isComplete && bundleResponse.transactions[0] ? (
            <GoToProjectButton
              txHash={destinationHash(bundleResponse.transactions[0])}
              chainId={bundleResponse.transactions[0].request.chain}
            />
          ) : bundleError ? null : hasFailed ? (
            <p className="border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800">
              At least one destination transaction failed. Review the per-chain status above; do not
              make another Relayr payment.
            </p>
          ) : (
            <p className="text-sm text-melon-700">
              Relayr payment confirmed. Destination transactions are still pending.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
