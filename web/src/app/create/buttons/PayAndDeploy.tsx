import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import EtherscanLink from "@/components/EtherscanLink";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import {
  CheckCircle,
  CircleDashedIcon,
  CircleDotDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  FastForward,
  SquareArrowOutUpRightIcon,
} from "@/components/ui/icons";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useGetRelayrTxBundle, useSendRelayrTx } from "@/hooks/useReviewedRelayr";
import { submittedViaSafe } from "@/lib/held-rows";
import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import { reviewClosed } from "@/lib/review-refusal";
import { preselectedRelayrPayment, relayrPaymentOptions } from "@/lib/transaction-review";
import { formatHexEther, formatWalletError } from "@/lib/utils";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import {
  relayrDestinationHash,
  relayrStateIsFailed,
  relayrStateIsSuccess,
} from "@bananapus/nana-sdk-core/review/relayr";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { useCreateForm } from "../form/useCreateForm";
import { ensureFreshQuote, type QuotedStageStart } from "../helpers/staleQuote";
import { GoToProjectButton } from "./GoToProjectButton";

interface PaymentAndDeploySectionProps {
  relayrResponse: RelayrPostBundleResponse;
  revnetTokenSymbol: string;
  /** The chain the wallet was on before signing switched it. */
  preferredPaymentChainId?: number;
  quotedStageStart?: QuotedStageStart;
  rebuildStaleQuote?: (stale: RelayrPostBundleResponse) => Promise<RelayrPostBundleResponse>;
}

// Only Relayr's Failed is a failure; any state it has not settled shows as pending.
const statusToIcon = (status: string) => {
  if (relayrStateIsSuccess(status))
    return <CheckCircle className="w-5 h-5 text-emerald-500 fade-in-50" />;
  if (relayrStateIsFailed(status))
    return <CircleXIcon className="w-5 h-5 text-red-500 fade-in-50" />;
  if (status === "Mempool")
    return <CircleDotDashedIcon className="w-5 h-5 text-blue-400 animate-spin" />;
  if (status === "Included")
    return <CircleDotIcon className="w-5 h-5 text-cyan-400 animate-spin" />;
  return <CircleDashedIcon className="w-5 h-5 text-amber-400 animate-spin" />;
};

export function PayAndDeploy({
  relayrResponse,
  revnetTokenSymbol,
  preferredPaymentChainId,
  quotedStageStart,
  rebuildStaleQuote,
}: PaymentAndDeploySectionProps) {
  const [selectedPayment, selectPayment] = useState<ChainPayment | null>(() =>
    preselectedRelayrPayment(relayrResponse.payment_info, preferredPaymentChainId),
  );
  /** The launch payment: not sent, being sent, sent (its bundle is then followed), or with a Safe. */
  const [paid, setPaid] = useState<"unsent" | "sending" | "sent" | "safe-proposed">("unsent");
  const payIsProcessing = paid === "sending";
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
  const paymentSent = paid === "sent" || paid === "safe-proposed" || !!paymentHash;
  const paymentLocked = paymentSent || isComplete || hasFailed;
  const busy = payIsProcessing || isPolling;

  const payAndLaunch = async () => {
    if (payIsProcessing || paymentLocked) return;
    setPaid("sending");
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
            title: "Refreshing quote",
            description:
              "The quoted start time has passed. Sign the new launch requests to avoid a 7-day lock on cash-outs and loans.",
          }),
      });
      if (payment !== selectedPayment) selectPayment(payment);
      const hash = await sendRelayrTx(payment);
      if (submittedViaSafe(hash)) {
        setPaid("safe-proposed");
        setReview(false);
        toast({
          title: "Safe payment proposal submitted",
          description:
            "The launch is not paid yet. Approve and carry out this payment in Safe, then check transaction activity. Do not propose another payment. If it runs after the quoted start time, cash-outs and loans will be locked for 7 days from launch.",
        });
        return;
      }
      setPaid("sent");
      setReview(false);
      startPolling(bundle.bundle_uuid);
    } catch (e: any) {
      if (reviewClosed(e)) {
        setReview(false);
        return;
      }
      setError(formatWalletError(e));
      toast({
        title: "Error",
        description: formatWalletError(e),
        variant: "destructive",
      });
    } finally {
      setPaid((now) => (now === "sending" ? "unsent" : now));
    }
  };

  return (
    <div>
      <RelayrPaymentSelect
        options={relayrPaymentOptions(relayrResponse.payment_info)}
        value={selectedPayment?.chain ?? null}
        onValueChange={(chainId) =>
          selectPayment(
            relayrResponse.payment_info.find((payment) => payment.chain === chainId) ?? null,
          )
        }
        disabled={payIsProcessing || paymentLocked}
      />
      <div className="flex justify-end md:col-span-3 mt-4">
        {/* The payment's confirm cannot connect a wallet, so this asks for one first. */}
        <ButtonWithWallet
          size="lg"
          disabled={payIsProcessing || paymentLocked || !selectedPayment}
          className="disabled:text-black disabled:bg-transparent disabled:border disabled:border-black disabled:bg-gray-100 bg-teal-500 text-melon-950 hover:bg-teal-600"
          onClick={() => {
            setError(null);
            setReview(true);
          }}
        >
          Pay and launch
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
        </ButtonWithWallet>
      </div>
      {review && selectedPayment ? (
        <TxProgress
          open
          onClose={() => setReview(false)}
          title="Confirm payment"
          steps={[
            {
              title: `Pay ${formatHexEther(selectedPayment.amount)} ETH to relay`,
              detail:
                "The launch transactions are sent to each selected chain. No further wallet prompts are needed.",
            },
          ]}
          activeIndex={payIsProcessing ? 0 : -1}
          busy={payIsProcessing}
          error={error}
          start={paymentLocked ? undefined : () => void payAndLaunch()}
          rows={[
            { label: "Pays", value: `${formatHexEther(selectedPayment.amount)} ETH`, strong: true },
            { label: "On", value: chainDisplayName(selectedPayment.chain) },
            {
              label: "Deploys on",
              value: values.chainIds.map((chainId) => chainDisplayName(chainId)).join(", "),
            },
            { label: "Revnet", value: `${values.name || "Unnamed"} (${revnetTokenSymbol})` },
          ]}
        />
      ) : null}
      {paid === "safe-proposed" ? (
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
          {formatWalletError(bundleError)} Check the launch in transaction activity. Do not make
          another payment.
        </p>
      ) : null}
      {!!bundleResponse && (
        <div className="mt-10 flex flex-col space-y-2">
          <div className="text-left text-zinc-500 mb-2">
            Track the launch on each chain below. It usually takes 1–2 minutes; your revnet is ready
            on a chain once its transaction confirms.
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
                  {relayrDestinationHash(txn) ? (
                    <div className="flex flex-row space-x-1 items-center">
                      <EtherscanLink
                        value={relayrDestinationHash(txn) ?? undefined}
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
              txHash={relayrDestinationHash(bundleResponse.transactions[0]) ?? undefined}
              chainId={bundleResponse.transactions[0].request.chain}
            />
          ) : bundleError ? null : hasFailed ? (
            <p className="border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800">
              At least one launch transaction failed. Review each chain’s status above; do not make
              another payment.
            </p>
          ) : (
            <p className="text-sm text-melon-700">
              Payment confirmed. The launch transactions are still pending.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
