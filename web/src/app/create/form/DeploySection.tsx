import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { StickyRecipient } from "@/components/sticky/StickyRecipient";
import { TxProgress } from "@/components/ui/TxProgress";
import { hasErrors } from "@/lib/forms";
import type { JBChainId } from "@/lib/nana/types";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { useSafeConnection } from "@/lib/safe-connector";
import {
  isStickyRow,
  stickyDraftGroupId,
  stickyGroupDraftError,
  stickyGroupOf,
  stickySplitsProblem,
} from "@/lib/sticky";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { useState } from "react";
import { isAddress, type Address, type PublicClient } from "viem";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { formatFormErrors } from "../helpers/formatFormErrors";
import { useCreateForm } from "./useCreateForm";

export function DeploySection({
  disabled = false,
  validBundle = false,
}: {
  disabled?: boolean;
  validBundle?: boolean;
}) {
  const {
    revnetTokenSymbol,
    reserveAssetSymbol,
    values,
    submitForm,
    isSubmitting,
    isValid,
    errors,
    submitCount,
  } = useCreateForm();
  const [review, setReview] = useState(false);
  const [stickyProblem, setStickyProblem] = useState<string | null>(null);
  const [checkingSticky, setCheckingSticky] = useState(false);
  // Sticky rows pay a token's holders on every chain. The distributor never reverts, so an
  // unregistered token would quietly pay group 0: check each one on each chain first.
  const stickySplits = values.stages.flatMap((stage, index) =>
    stage.splits
      .filter((split) => isStickyRow(split) && isAddress(split.defaultBeneficiary))
      .flatMap((split) => {
        const group = stickyGroupOf(split);
        return stickyGroupDraftError(group)
          ? []
          : [
              {
                stage: index + 1,
                beneficiary: split.defaultBeneficiary as Address,
                projectId: stickyDraftGroupId(group),
              },
            ];
      }),
  );
  const openReview = async () => {
    setStickyProblem(null);
    if (stickySplits.length > 0) {
      setCheckingSticky(true);
      try {
        const problem = await stickySplitsProblem(stickySplits, values.chainIds, (chainId) => {
          const client = getPublicClient(wagmiConfig, {
            chainId: chainId as JBChainId,
          }) as PublicClient | undefined;
          if (!client) throw new Error(`Could not connect to ${chainDisplayName(chainId)}.`);
          return client;
        });
        if (problem) {
          setStickyProblem(problem);
          return;
        }
      } catch (error) {
        setStickyProblem(
          error instanceof Error ? error.message : "Could not check the Sticky tokens.",
        );
        return;
      } finally {
        setCheckingSticky(false);
      }
    }
    setReview(true);
  };
  // The explicit config keeps this section renderable outside a WagmiProvider.
  const { chainId: connectedChainId } = useAccount({ config: wagmiConfig });
  const viaSafe = useSafeConnection(wagmiConfig);

  // A Safe proposal executes arbitrarily later, but the request encodes stage
  // 1's start time now. REVDeployer locks cash-outs and loans for 7 days when
  // that start is already past at execution, so warn before proposing.
  const deploysViaSafe = viaSafe && values.chainIds.length === 1;
  const singleChain = values.chainIds.length === 1;
  const unsupportedMultichain =
    !singleChain && (viaSafe || !areRelayrChainsCompatible(values.chainIds));
  const chainNames = values.chainIds.map((chainId) => chainDisplayName(chainId));
  const action = singleChain ? "Deploy the revnet" : "Sign and get quote";

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">6. Deploy</h2>
        <p className="text-lg text-zinc-600">
          Create your revnet on the selected chains. Once its first stage starts, people can pay it
          to receive {revnetTokenSymbol} under its terms.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          If you chose an operator, they can add chains later using the same launch settings.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        {deploysViaSafe && (
          <p className="mb-4 border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800">
            This proposal fixes stage 1&apos;s start time, about 10 minutes ahead unless you chose a
            date. If your Safe carries out the proposal after that time, cash-outs and loans will be
            locked for 7 days. To avoid the lock, choose a start date that gives your Safe enough
            time to approve and carry out the proposal.
          </p>
        )}
        {unsupportedMultichain ? (
          <p
            role="alert"
            className="mb-4 border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800"
          >
            {viaSafe
              ? "For a Safe deployment, select one chain."
              : "Choose either live chains or test chains, not a mix."}
          </p>
        ) : null}
        <div className="flex justify-end">
          <ButtonWithWallet
            targetChainId={
              singleChain
                ? values.chainIds[0]
                : areRelayrChainsCompatible([...values.chainIds, connectedChainId ?? 0])
                  ? (connectedChainId as JBChainId)
                  : undefined
            }
            size="lg"
            loading={isSubmitting || checkingSticky}
            disabled={isSubmitting || checkingSticky || disabled || unsupportedMultichain}
            onClick={() => {
              if (hasErrors(errors)) void submitForm();
              else void openReview();
            }}
            connectWalletText="Connect Wallet"
            className="bg-teal-500 text-melon-950 hover:bg-teal-600"
          >
            {validBundle ? "Quote complete" : action}
          </ButtonWithWallet>
        </div>
        {stickyProblem ? (
          <p
            role="alert"
            className="mt-3 max-w-xl border-l-2 border-red-500 pl-3 text-sm text-red-700"
          >
            {stickyProblem}
          </p>
        ) : null}
        {review && values.chainIds[0] ? (
          <TxProgress
            open
            onClose={() => setReview(false)}
            title={singleChain ? "Confirm deployment" : "Confirm deploy request"}
            steps={
              singleChain
                ? [
                    {
                      title: `Deploy ${values.name || "the revnet"} on ${chainNames[0]}`,
                      detail: "Creates the revnet with the terms you chose.",
                    },
                  ]
                : values.chainIds.map((chainId) => ({
                    key: String(chainId),
                    title: `Sign the authorization for ${chainDisplayName(chainId)}`,
                  }))
            }
            stepsIntro={
              singleChain
                ? undefined
                : `Your wallet will ask for ${values.chainIds.length} signatures. The relay payment comes after the quote.`
            }
            activeIndex={isSubmitting ? 0 : -1}
            start={() => {
              void submitForm().finally(() => setReview(false));
            }}
            busy={isSubmitting}
            rows={[
              { label: "Revnet", value: values.name || "Unnamed", strong: true },
              { label: "Token", value: revnetTokenSymbol },
              { label: "On", value: chainNames.join(", ") },
              { label: "Backed by", value: reserveAssetSymbol },
              ...(stickySplits.length > 0
                ? [
                    {
                      label: "Sticky",
                      value: stickySplits.map((split, index) => (
                        <span key={index} className="block">
                          Stage {split.stage}:{" "}
                          <StickyRecipient split={split} chainId={values.chainIds[0]} />
                        </span>
                      )),
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
        {submitCount > 0 && !isValid ? (
          <div className="mt-3 max-w-xl border-l-2 border-red-500 pl-3" role="alert">
            <p className="text-sm font-semibold text-red-700">Please fix these details:</p>
            <p className="mt-1 whitespace-pre-line text-sm text-red-700">
              {formatFormErrors(errors)}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
