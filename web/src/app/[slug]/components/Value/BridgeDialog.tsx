"use client";

import { chainDisplayName } from "@/app/constants";
import { AllowedDecreaseField } from "@/components/AllowedDecreaseField";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import { toast } from "@/components/ui/use-toast";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import {
  failedLine,
  isSafeProposalPendingError,
  reviewedCall,
  ReviewRefusal,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import { useSuckerPairs } from "@/hooks/useSuckerPairs";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import type { Project } from "@/lib/bendystraw/types";
import {
  buildProtectedBridgePrepareTx,
  quoteBridgePrepare,
  verifyBridgePrepareDestination,
} from "@/lib/bridgePrepare";
import { revalidateCacheTag } from "@/lib/cache";
import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { legacyIntents } from "@/lib/legacy-intents";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { useJBTokenContext } from "@/lib/nana/project";
import { useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import { SAFE_PROPOSAL_PENDING_LINE, SAFE_PROPOSAL_UNCONFIRMED_LINE } from "@/lib/reviewed-call";
import { getTokenAddress } from "@/lib/token";
import { getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { cn, formatTokenSymbol, formatWalletError } from "@/lib/utils";
import { JB_TOKEN_DECIMALS, JBChainId } from "@bananapus/nana-sdk-core";
import { approvalIntent, bridgeIntent } from "@bananapus/nana-sdk-core/review";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, getAddress, Hex, parseUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";

interface Props {
  projects: Array<Pick<Project, "projectId" | "chainId" | "token">>;
}

const NO_FUNDING_MOVES = "None. The same tokens arrive, with no funding.";

export function BridgeDialog(props: PropsWithChildren<Props>) {
  const { children, projects } = props;
  const sourceChains = useMemo(() => projects.map((p) => p.chainId as JBChainId), [projects]);
  const [sourceChainId, setSourceChainId] = useState<JBChainId>(sourceChains[0]);
  const [targetChainId, setTargetChainId] = useState<JBChainId>();
  // Where the amount came from: typed, a share option (Max), or the app's seed. The write's
  // intent keys an option by its name, since the amount it fills follows the balance.
  const [amount, setAmount] = useState<string>();
  const [slippageBps, setSlippageBps] = useState(100);
  const { token } = useJBTokenContext();
  const baseToken = useProjectBaseToken();
  const tokenSymbol = formatTokenSymbol(token);
  const [isApproving, setApproving] = useState(false);
  // Null until the allowance is read; the confirm prepares in the meantime.
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { address } = useAccount();
  // Estimates read for the account on screen; the send below stays with the connected wallet.
  const { address: viewedAddress } = useViewedAccount();
  const router = useRouter();
  const publicClient = usePublicClient({ chainId: sourceChainId });
  const destinationClient = usePublicClient({ chainId: targetChainId });
  const { run, phase, status, held, reset } = useReviewedAction();
  const [hash, setHash] = useState<Hex>();
  const isLoading = status === "receipt";
  // Only the move's own hash is success: a Safe that ran just the approval leaves the move to send.
  const isSuccess = status === "done" && !!hash;
  const isSafeResultUnconfirmed = phase === "proposed" && !!held?.exit;
  const { data: balances, isLoading: isBalanceLoading } = useSuckersUserTokenBalance();
  const { balance } = balances?.find((b) => b.chainId === sourceChainId) || {
    balance: { value: 0n },
  };
  const tokenDecimals = JB_TOKEN_DECIMALS;
  const maxAmount = balance ? formatUnits(balance.value, tokenDecimals) : "0";

  const project = projects.find((p) => p.chainId === sourceChainId)!;
  const targetProjects = projects.filter((candidate) => candidate.chainId === targetChainId);
  const targetProject = targetProjects.length === 1 ? targetProjects[0] : undefined;
  // Both projects come from the server sucker-group list: bridge only between registry-listed pairs.
  const routeProjects = useMemo(
    () => (targetProject ? [project, targetProject] : [project]),
    [project, targetProject],
  );
  const gate = useGroupWriteGate(routeProjects);
  const { suckerPairs } = useSuckerPairs(project.projectId, sourceChainId);
  const suckerPair = suckerPairs.find(
    (candidate) => Number(candidate.remoteChainId) === targetChainId,
  );
  const amountValue = useMemo(() => {
    if (!amount) return undefined;
    try {
      const value = parseUnits(amount, tokenDecimals);
      return value > 0n ? value : undefined;
    } catch {
      return undefined;
    }
  }, [amount, tokenDecimals]);
  const terminalToken = useMemo(() => {
    try {
      return project.token ? getAddress(project.token) : undefined;
    } catch {
      return undefined;
    }
  }, [project.token]);
  const backingTokenSymbol =
    baseToken?.tokenMap[sourceChainId]?.symbol ??
    baseToken?.symbol ??
    (terminalToken ? getTokenSymbolFromAddress(terminalToken) : "tokens");

  const prepareQuote = useQuery({
    queryKey: [
      "bridge-prepare-quote",
      sourceChainId,
      project.projectId,
      suckerPair?.local,
      targetChainId,
      targetProject?.projectId,
      suckerPair?.remote,
      viewedAddress,
      amountValue?.toString(),
      terminalToken,
      slippageBps,
    ],
    enabled:
      !!publicClient &&
      !!destinationClient &&
      !!targetChainId &&
      !!targetProject &&
      !!viewedAddress &&
      !!suckerPair &&
      amountValue !== undefined &&
      !!terminalToken,
    queryFn: async () => {
      if (
        !publicClient ||
        !destinationClient ||
        !targetChainId ||
        !targetProject ||
        !viewedAddress ||
        !suckerPair ||
        amountValue === undefined ||
        !terminalToken
      ) {
        throw new Error("The bridge quote is incomplete.");
      }
      return quoteBridgePrepare(publicClient, {
        chainId: sourceChainId,
        projectId: BigInt(project.projectId),
        sucker: suckerPair.local,
        projectTokenCount: amountValue,
        terminalToken,
        slippageBps: BigInt(slippageBps),
        beneficiary: viewedAddress,
        destinationClient,
        destinationChainId: targetChainId,
        destinationProjectId: BigInt(targetProject.projectId),
        destinationSucker: suckerPair.remote,
      });
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  // A project can hold more than one active sucker to the same chain.
  const targetChains = useMemo(
    () =>
      [...new Set(suckerPairs.map((s) => Number(s.remoteChainId)))].filter(
        (id) => id !== sourceChainId,
      ) as JBChainId[],
    [sourceChainId, suckerPairs],
  );

  const isDisabled = isSubmitting || isLoading || isSuccess;

  useEffect(() => {
    if (hash) setReview(false);
  }, [hash]);

  // The approval is its own wallet prompt, so it is named before the confirm
  // opens rather than discovered mid-flow.
  const reviewMove = useCallback(async () => {
    if (!address || amountValue === undefined || !publicClient || !suckerPair || gate.blocked)
      return;
    setIsSubmitting(true);
    setNeedsApproval(null);
    setError(null);
    setReview(true);
    try {
      const tokenAddress = await getTokenAddress(sourceChainId, project.projectId);
      const allowance = tokenAddress
        ? await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, suckerPair.local],
          })
        : 0n;
      setNeedsApproval(allowance < amountValue);
    } catch (cause) {
      setReview(false);
      toast({ variant: "destructive", title: "Error", description: formatWalletError(cause) });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    address,
    amountValue,
    publicClient,
    suckerPair,
    sourceChainId,
    project.projectId,
    gate.blocked,
  ]);

  const moveContext = useMemo(
    () =>
      targetChainId && prepareQuote.data
        ? [
            { label: "Move", value: `${amount} ${tokenSymbol}`, strong: true },
            { label: "From", value: chainDisplayName(sourceChainId) },
            { label: "To", value: chainDisplayName(targetChainId) },
            {
              label: "Funding moved",
              value: `~${formatUnits(prepareQuote.data.netReclaimAmount, prepareQuote.data.tokenDecimals)} ${backingTokenSymbol}`,
            },
            {
              label: "Minimum funding moved",
              value:
                prepareQuote.data.minTokensReclaimed === 0n
                  ? NO_FUNDING_MOVES
                  : `At least ${formatUnits(prepareQuote.data.minTokensReclaimed, prepareQuote.data.tokenDecimals)} ${backingTokenSymbol}`,
            },
          ]
        : [],
    [amount, backingTokenSymbol, prepareQuote.data, sourceChainId, targetChainId, tokenSymbol],
  );

  const moveTokens = useCallback(async () => {
    try {
      setIsSubmitting(true);
      gate.assertVerified(routeProjects);

      if (!address) {
        throw new Error("Please connect your wallet");
      }

      if (!amount || amountValue === undefined) {
        throw new Error("Please enter an amount");
      }

      if (amountValue > balance.value) {
        throw new Error("Insufficient balance");
      }

      const projectId = project.projectId;

      if (!publicClient || !projectId || !terminalToken) {
        throw new Error("Please try again");
      }

      const reviewedQuote = prepareQuote.data;
      if (!reviewedQuote || Date.now() - prepareQuote.dataUpdatedAt > 30_000) {
        throw new Error("The transfer quote is missing or out of date. Wait for it to refresh.");
      }

      const tokenAddress = await getTokenAddress(sourceChainId, projectId);

      if (!tokenAddress) {
        throw new Error("Couldn't determine token address. Please try again");
      }

      if (!suckerPair) {
        throw new Error("Could not find a bridge between these networks. Try again.");
      }

      // The approval, when one is needed, is the first step of the move's one review.
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, suckerPair.local],
      });
      const approve = allowance < amountValue;
      setNeedsApproval(approve);
      const intent = bridgeIntent({
        chainId: sourceChainId,
        sucker: suckerPair.local,
        token: terminalToken,
        account: address,
      });

      const request = buildProtectedBridgePrepareTx({
        chainId: sourceChainId,
        sucker: suckerPair.local,
        projectTokenCount: amountValue,
        beneficiary: address,
        minTokensReclaimed: reviewedQuote.minTokensReclaimed,
        token: terminalToken,
      });
      // Held by the sucker, token and account: the quoted minimum is read again on a retry.
      const sucker = suckerPair.local;
      const result = await run({
        account: address,
        context: moveContext,
        scope: approve ? intent : undefined,
        beforeWallet: (_call, step) => setApproving(approve && step === 0),
        // The route, the destination and the reviewed minimum, right before the wallet.
        reverify: async (_call, step) => {
          if (approve && step === 0) return;
          // An approval can leave the dialog open for minutes: the quote is read again here.
          const freshQuote = await prepareQuote.refetch();
          if (freshQuote.error || !freshQuote.data)
            throw new ReviewRefusal(
              "The transfer quote could not be refreshed. Nothing was submitted.",
            );
          if (freshQuote.data.netReclaimAmount < reviewedQuote.minTokensReclaimed)
            throw new ReviewRefusal("The transfer quote fell below your minimum. Review it again.");
          if (!destinationClient || !targetChainId || !targetProject) {
            throw new ReviewRefusal("The bridge route changed. Review the transfer again.");
          }
          await verifyBridgePrepareDestination(publicClient, {
            chainId: sourceChainId,
            projectId: BigInt(project.projectId),
            sucker,
            projectTokenCount: amountValue,
            beneficiary: address,
            destinationClient,
            destinationChainId: targetChainId,
            destinationProjectId: BigInt(targetProject.projectId),
            destinationSucker: suckerPair.remote,
          }).catch((cause: Error) => {
            throw new ReviewRefusal(cause.message);
          });
        },
        onSubmitted: (_call, step, sent) => {
          if (!approve || step === 1) setHash(sent);
        },
        calls: [
          ...(approve
            ? [
                reviewedCall(
                  {
                    chainId: sourceChainId,
                    address: tokenAddress,
                    abi: erc20ApproveAbi,
                    functionName: "approve",
                    args: [suckerPair.local, amountValue],
                  },
                  {
                    intent: approvalIntent(intent, {
                      step: "erc20",
                      token: tokenAddress,
                      spender: suckerPair.local,
                    }),
                  },
                ),
              ]
            : []),
          reviewedCall(
            { ...request, chainId: sourceChainId },
            {
              dependsOnPrior: approve,
              intent,
              legacyIntents: legacyIntents.bridge({
                sucker,
                token: terminalToken,
                amount: amountValue,
              }),
            },
          ),
        ],
      });
      setApproving(false);
      if (!result) {
        setReview(false);
        return;
      }
      if (result.status === "failed") throw new ReviewRefusal(failedLine(result));
      if (result?.status === "proposed") {
        setReview(false);
        toast({ title: "Safe proposal submitted", description: SAFE_PROPOSAL_PENDING_LINE });
      }
    } catch (error) {
      console.error(error);
      setApproving(false);
      if (isSafeProposalPendingError(error)) {
        setReview(false);
        toast({ title: "Safe proposal submitted", description: formatWalletError(error) });
      } else {
        setError(formatWalletError(error));
        toast({ variant: "destructive", title: "Error", description: formatWalletError(error) });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    amount,
    amountValue,
    balance.value,
    prepareQuote,
    publicClient,
    project.projectId,
    sourceChainId,
    moveContext,
    suckerPair,
    run,
    destinationClient,
    targetChainId,
    targetProject,
    address,
    terminalToken,
    gate,
    routeProjects,
  ]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          reset();
          setAmount(undefined);
          setSlippageBps(100);
          setSourceChainId(sourceChains[0]);
          setTargetChainId(undefined);
          revalidateCacheTag("suckerTransactions").then(router.refresh);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move between networks</DialogTitle>
          <DialogDescription>
            Move your tokens and their share of revnet funds to another network. The move takes more
            than one step.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void reviewMove();
          }}
        >
          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sourceChainId" className="text-zinc-900">
                From network
              </Label>
              <Select
                value={sourceChainId.toString()}
                onValueChange={(v) => {
                  const newId = Number(v) as JBChainId;
                  setSourceChainId(newId);
                  setTargetChainId(undefined);
                }}
                disabled={isDisabled}
              >
                <SelectTrigger className="w-fit gap-2">
                  <SelectValue placeholder="Choose network..." id="sourceChainId">
                    <div className="flex items-center gap-2">
                      <ChainLogo chainId={sourceChainId} />
                      {chainDisplayName(sourceChainId)}
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sourceChains.map((chainId) => {
                    return (
                      <SelectItem
                        value={chainId.toString()}
                        key={chainId}
                        className="[&>*:last-child]:flex [&>*:last-child]:w-full"
                      >
                        <div className="flex items-center gap-2 grow">
                          <ChainLogo chainId={chainId} />
                          {chainDisplayName(chainId)}
                        </div>
                        <span className="shrink-0 pl-2">
                          {balances?.find((b) => b.chainId === chainId)?.balance.format(2)}{" "}
                          {tokenSymbol}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="targetChainId" className="text-zinc-900">
                To network
              </Label>
              <Select
                value={targetChainId?.toString() ?? ""}
                onValueChange={(v) => {
                  if (!v) return;
                  setTargetChainId(Number(v) as JBChainId);
                }}
                disabled={isDisabled}
              >
                <SelectTrigger className="w-fit gap-2">
                  <SelectValue placeholder="Choose network..." id="targetChainId">
                    {targetChainId && (
                      <div className="flex items-center gap-2">
                        <ChainLogo chainId={targetChainId} />
                        {chainDisplayName(targetChainId)}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {targetChains.map((chainId) => {
                    return (
                      <SelectItem
                        value={chainId.toString()}
                        key={chainId}
                        className="[&>*:last-child]:flex [&>*:last-child]:w-full"
                      >
                        <div className="flex items-center gap-2 grow">
                          <ChainLogo chainId={chainId as JBChainId} />
                          {chainDisplayName(chainId as JBChainId)}
                        </div>
                        <span className="shrink-0 pl-2">
                          {balances?.find((b) => b.chainId === chainId)?.balance.format(2)}{" "}
                          {tokenSymbol}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="amount" className="text-zinc-900">
                Amount
              </Label>
              <div className="relative">
                <Input
                  id="amount"
                  name="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value?.trim())}
                  disabled={isDisabled}
                  autoComplete="off"
                  type="text"
                  className="pr-20"
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 z-10">
                  <span className="text-zinc-500 sm:text-md">{tokenSymbol}</span>
                </div>
              </div>
              <div className="flex gap-1 mt-1 mb-2 justify-end">
                {[10, 25, 50, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={isBalanceLoading || isDisabled}
                    onClick={() => {
                      setAmount(
                        pct === 100 ? maxAmount : (Number(maxAmount) * (pct / 100)).toFixed(8),
                      );
                    }}
                    className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 bg-white hover:bg-zinc-100"
                  >
                    {pct === 100 ? "Max" : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>
            <fieldset disabled={isDisabled} className="min-w-0 sm:col-span-2">
              <AllowedDecreaseField
                bps={slippageBps}
                onChange={setSlippageBps}
                maxBps={500}
                className=""
              />
              <p className="mt-1 text-xs text-zinc-500">
                The transfer stops if the amount falls below your minimum.
              </p>
            </fieldset>
            <div className="border border-melon-300 p-3 text-sm sm:col-span-2" aria-live="polite">
              {prepareQuote.isPending && prepareQuote.fetchStatus === "fetching" ? (
                <span className="text-zinc-600">
                  Checking how much revnet funding moves with your tokens…
                </span>
              ) : prepareQuote.data ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <SummaryRow label="Estimated funding moved">
                    {formatUnits(
                      prepareQuote.data.netReclaimAmount,
                      prepareQuote.data.tokenDecimals,
                    )}{" "}
                    {backingTokenSymbol}
                  </SummaryRow>
                  <SummaryRow label="Minimum funding moved">
                    {prepareQuote.data.minTokensReclaimed === 0n ? (
                      NO_FUNDING_MOVES
                    ) : (
                      <>
                        {formatUnits(
                          prepareQuote.data.minTokensReclaimed,
                          prepareQuote.data.tokenDecimals,
                        )}{" "}
                        {backingTokenSymbol}
                      </>
                    )}
                  </SummaryRow>
                </div>
              ) : (
                <span className="text-amber-700">
                  {prepareQuote.error instanceof Error
                    ? prepareQuote.error.message
                    : !targetChainId || amountValue === undefined
                      ? "Choose both networks and an amount to see the minimum funding moved."
                      : !viewedAddress
                        ? "Connect a wallet to see the minimum funding moved."
                        : "Couldn't estimate a move between these networks."}
                </span>
              )}
            </div>
          </fieldset>

          <DialogFooter className="flex items-center sm:justify-between w-full gap-4">
            <div
              className={cn("text-sm text-zinc-700", {
                "animate-pulse": isApproving || isLoading,
              })}
            >
              {isApproving && "Waiting for confirmation..."}
              {isLoading && "Waiting for confirmation..."}
              {isSuccess &&
                "First step confirmed. Close this window and use the transaction table to finish the move."}
              {isSafeResultUnconfirmed && SAFE_PROPOSAL_UNCONFIRMED_LINE}
              {gate.line}
              {amountValue !== undefined && !isBalanceLoading && amountValue > balance.value ? (
                <p>{`Not enough ${tokenSymbol} on ${chainDisplayName(sourceChainId)}`}</p>
              ) : null}
            </div>
            <ButtonWithWallet
              connectWhileDisabled
              targetChainId={sourceChainId}
              loading={gate.pending}
              disabled={
                gate.blocked ||
                isDisabled ||
                !prepareQuote.data ||
                prepareQuote.isError ||
                amountValue === undefined ||
                amountValue > balance.value
              }
              className="bg-teal-500 text-melon-950 hover:bg-teal-600"
            >
              Move {tokenSymbol}
            </ButtonWithWallet>
          </DialogFooter>
        </form>
        {review && targetChainId && prepareQuote.data ? (
          <TxProgress
            open
            onClose={() => setReview(false)}
            title="Confirm move"
            preparing={needsApproval === null}
            status={needsApproval === null ? "Checking permission to use your tokens…" : null}
            steps={[
              ...(needsApproval
                ? [
                    {
                      key: "approve",
                      title: "Let the bridge use your tokens",
                      detail: "Lets the bridge take the amount shown.",
                    },
                  ]
                : []),
              {
                key: "prepare",
                title: "Start the move",
                detail: "Cashes out here and queues the funds for the other network.",
              },
            ]}
            activeIndex={isApproving ? 0 : isSubmitting ? (needsApproval ? 1 : 0) : -1}
            start={() => void moveTokens()}
            busy={isSubmitting}
            error={error}
            rows={moveContext}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
