import { chainDisplayName } from "@/app/constants";
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
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useCashOutRoute } from "@/hooks/useCashOutRoute";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import {
  cashOutExecutionErrorMessage,
  cashOutPoolBufferBps,
  resolveCashOutChainId,
} from "@/lib/cashOutQuote";
import {
  buildDirectSellSwapTx,
  PERMIT2_ADDRESS,
  permit2Abi,
  quoteDirectSellSwap,
} from "@/lib/directPaySwap";
import { useJBChainId, useJBTokenContext } from "@/lib/nana/project";
import { useSuckers, useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { formatDecimals } from "@/lib/number";
import { getTokenConfigForChain, isNativeToken } from "@/lib/tokenUtils";
import { formatWalletError } from "@/lib/utils";
import {
  formatUnits,
  getJBContractAddress,
  JB_CHAINS,
  JB_TOKEN_DECIMALS,
  JBCoreContracts,
  JBProjectToken,
  NATIVE_TOKEN,
} from "@bananapus/nana-sdk-core";
import {
  getTokenAddress,
  prepareHookAwareCashOut,
  uniswapV4Deployment,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { PropsWithChildren, useEffect, useState } from "react";
import { erc20Abi, type Address, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { readPoolSnapshot } from "../v6/owners/market/lib";

interface Props {
  projectId: bigint;
  tokenSymbol: string;
  disabled?: boolean;
}

export function RedeemDialog(props: PropsWithChildren<Props>) {
  const { projectId, tokenSymbol, disabled, children } = props;
  const [redeemAmount, setRedeemAmount] = useState<string>();
  // Max slippage tolerance in basis points; protects both routes (terminal
  // minimum on the treasury path, metadata minimum on the AMM path).
  const [slippageBps, setSlippageBps] = useState(100);

  const { address } = useAccount();
  const { data: balances } = useSuckersUserTokenBalance();
  const [cashOutChainId, setCashOutChainId] = useState<string>();
  const cashOutableBalances = balances?.filter((balance) => balance.balance.value > 0n) ?? [];
  const activeCashOutChainId = resolveCashOutChainId(
    cashOutableBalances.map((balance) => balance.chainId),
    cashOutChainId,
  );
  const chainId = useJBChainId();
  const [isApproving, setIsApproving] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { data: suckers } = useSuckers();
  const { token } = useJBTokenContext();
  const baseToken = useProjectBaseToken();
  const selectedChainId = activeCashOutChainId
    ? (Number(activeCashOutChainId) as JBChainId)
    : undefined;
  const publicClient = usePublicClient({ chainId: selectedChainId }) as PublicClient | undefined;

  // Get the selected sucker based on cashOutChainId
  const selectedSucker = activeCashOutChainId
    ? suckers?.find((s) => s.peerChainId === Number(activeCashOutChainId))
    : suckers?.find((s) => s.peerChainId === chainId);
  const cashOutTerminal = selectedSucker
    ? getJBContractAddress(
        JBCoreContracts.JBMultiTerminal,
        6,
        selectedSucker.peerChainId as JBChainId,
      )
    : undefined;

  // Get the correct project ID for the selected chain
  const effectiveProjectId = selectedSucker?.projectId || projectId;

  // Get the suckerGroupId from the current project
  const { data: projectData } = useBendystrawQuery(
    ProjectOperation,
    { chainId: Number(chainId), projectId: Number(projectId), version: 6 },
    { enabled: !!chainId && !!projectId },
  );
  const suckerGroupId = projectData?.project?.suckerGroupId;

  // Get all projects in the sucker group with their token data
  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, chainId: Number(chainId) },
  );

  // Use project token decimals, not base token decimals
  const projectTokenDecimals = token?.data?.decimals || JB_TOKEN_DECIMALS;

  const redeemAmountBN = redeemAmount
    ? JBProjectToken.parse(redeemAmount, projectTokenDecimals).value
    : 0n;

  const { writeContractAsync, isPending: isWriteLoading, data: hash } = useWriteContract();
  const {
    writeContractAsync: writeApprovalAsync,
    isPending: approvalSigning,
    data: approvalHash,
  } = useWriteContract();

  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { isLoading: approvalConfirming, isSuccess: approvalConfirmed } =
    useWaitForTransactionReceipt({ hash: approvalHash });
  // const { data: redeemQuote } = useTokenCashOutQuoteEth(redeemAmountBN, {
  //   chainId: selectedSucker?.peerChainId as JBChainId,
  // });
  const loading = isWriteLoading || isTxLoading || approvalSigning || approvalConfirming;
  const { balance } = balances?.find((b) => b.chainId === Number(activeCashOutChainId)) || {
    balance: { value: 0n },
  };
  const maxRedeemAmount = balance ? formatUnits(balance.value, projectTokenDecimals) : "0";

  const valid = redeemAmountBN > 0n && redeemAmountBN <= balance.value;

  // The selected chain's accounting-token config. Null while a chain is
  // selected means LOADING — never assume the native token: gate the quote
  // and submission until it resolves.
  const selectedChainTokenConfig = activeCashOutChainId
    ? getTokenConfigForChain(suckerGroupData, Number(activeCashOutChainId))
    : null;

  // Determine what token to receive from cashout: the native sentinel for
  // native-base projects, else the chain's own accounting token (e.g. USDC).
  const tokenToReceive = selectedChainTokenConfig
    ? isNativeToken(selectedChainTokenConfig.token)
      ? NATIVE_TOKEN
      : selectedChainTokenConfig.token
    : undefined;

  const baseDecimals = baseToken?.decimals ?? 18;

  // Hook-aware quote: previewCashOutFrom runs the real cash-out path (data
  // hook + buyback routing) and returns the exact minimum/metadata to submit.
  const {
    data: cashOutRoute,
    isFetching: isQuoteFetching,
    isError: isQuoteError,
    refetch: refetchCashOutRoute,
  } = useCashOutRoute({
    chainId: activeCashOutChainId ? (Number(activeCashOutChainId) as JBChainId) : undefined,
    projectId: redeemAmountBN ? effectiveProjectId : undefined,
    holder: address,
    cashOutCount: redeemAmountBN || undefined,
    tokenToReclaim: tokenToReceive as `0x${string}` | undefined,
    terminal: cashOutTerminal,
    slippageBps: BigInt(slippageBps),
  });

  const expectedReclaim = cashOutRoute
    ? Number(formatUnits(cashOutRoute.expectedReturn, baseDecimals))
    : 0;
  const minimumReclaim = cashOutRoute
    ? Number(formatUnits(cashOutRoute.minimumReturn, baseDecimals))
    : 0;
  const poolBufferBps = cashOutPoolBufferBps(cashOutRoute);

  const { data: projectTokenAddress } = useQuery({
    queryKey: ["cashOutProjectToken", selectedChainId, effectiveProjectId.toString()],
    enabled: !!publicClient && !!selectedChainId,
    queryFn: () =>
      getTokenAddress(publicClient!, {
        chainId: selectedChainId!,
        projectId: effectiveProjectId,
      }),
  });
  const { data: claimedBalance, refetch: refetchClaimedBalance } = useQuery({
    queryKey: ["cashOutClaimedBalance", selectedChainId, projectTokenAddress, address],
    enabled: !!publicClient && !!projectTokenAddress && !!address,
    queryFn: () =>
      publicClient!.readContract({
        address: projectTokenAddress!,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address!],
      }),
  });
  const { data: directSell, isFetching: directSellLoading } = useQuery({
    queryKey: [
      "directCashOutSell",
      selectedChainId,
      effectiveProjectId.toString(),
      redeemAmountBN.toString(),
      cashOutRoute?.expectedReturn.toString(),
      tokenToReceive,
      slippageBps,
    ],
    enabled:
      !!publicClient &&
      !!selectedChainId &&
      !!projectTokenAddress &&
      !!tokenToReceive &&
      !!cashOutRoute &&
      redeemAmountBN > 0n &&
      (claimedBalance ?? 0n) >= redeemAmountBN,
    retry: false,
    queryFn: async () => {
      const pool = await readPoolSnapshot(selectedChainId!, effectiveProjectId).then(
        (result) => result.pool,
      );
      if (!pool) return null;
      return quoteDirectSellSwap({
        client: publicClient!,
        chainId: selectedChainId!,
        poolKey: pool.key,
        projectToken: projectTokenAddress!,
        tokenToReclaim: tokenToReceive!,
        amount: redeemAmountBN,
        cashOutRoute: cashOutRoute!,
        slippageBps,
      });
    },
  });
  const deployment =
    directSell && selectedChainId ? uniswapV4Deployment(selectedChainId) : undefined;
  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useQuery({
    queryKey: ["cashOutErc20Allowance", selectedChainId, projectTokenAddress, address],
    enabled: !!publicClient && !!directSell && !!projectTokenAddress && !!address,
    queryFn: () =>
      publicClient!.readContract({
        address: projectTokenAddress!,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address!, PERMIT2_ADDRESS],
      }),
  });
  const { data: routerAllowance, refetch: refetchRouterAllowance } = useQuery({
    queryKey: [
      "cashOutRouterAllowance",
      selectedChainId,
      projectTokenAddress,
      deployment?.universalRouter,
      address,
    ],
    enabled:
      !!publicClient &&
      !!directSell &&
      !!projectTokenAddress &&
      !!deployment?.universalRouter &&
      !!address,
    queryFn: () =>
      publicClient!.readContract({
        address: PERMIT2_ADDRESS,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address!, projectTokenAddress!, deployment!.universalRouter as Address],
      }),
  });
  const needsErc20Approval = !!directSell && (erc20Allowance ?? 0n) < redeemAmountBN;
  const needsRouterApproval =
    !!directSell &&
    (!routerAllowance ||
      routerAllowance[0] < redeemAmountBN ||
      Number(routerAllowance[1]) <= Math.floor(Date.now() / 1000) + 1_800);

  // A cleared approval stops being "needed", so the queue is built from the
  // approvals this sale ever required — otherwise a finished step disappears
  // instead of ticking over to done.
  const [requiredApprovals, setRequiredApprovals] = useState<("erc20" | "router")[]>([]);
  useEffect(() => {
    setRequiredApprovals((current) => {
      const next: ("erc20" | "router")[] = directSell
        ? [
            ...(needsErc20Approval || current.includes("erc20") ? (["erc20"] as const) : []),
            ...(needsRouterApproval || current.includes("router") ? (["router"] as const) : []),
          ]
        : [];
      return next.join() === current.join() ? current : next;
    });
  }, [directSell, needsErc20Approval, needsRouterApproval]);

  // Each approval is its own wallet prompt and its own click, so the whole
  // queue is named before the first one.
  const cashOutSteps = [
    ...requiredApprovals.map((kind) =>
      kind === "erc20"
        ? {
            key: "erc20",
            title: "Approve your tokens for the swap router",
            detail: "Permit2 cannot move your tokens without this allowance.",
          }
        : {
            key: "router",
            title: "Authorize the swap router",
            detail: "A capped allowance that expires in 30 days.",
          },
    ),
    { key: "cashout", title: directSell ? "Sell on the pool" : "Cash out" },
  ];
  const cashOutActiveIndex = isSuccess
    ? cashOutSteps.length
    : needsErc20Approval
      ? requiredApprovals.indexOf("erc20")
      : needsRouterApproval
        ? requiredApprovals.indexOf("router")
        : requiredApprovals.length;

  useEffect(() => {
    if (hash) setReview(false);
  }, [hash]);

  useEffect(() => {
    if (!approvalConfirmed) return;
    setIsApproving(false);
    void refetchErc20Allowance();
    void refetchRouterAllowance();
    void refetchClaimedBalance();
  }, [approvalConfirmed, refetchErc20Allowance, refetchRouterAllowance, refetchClaimedBalance]);

  return (
    <Dialog open={disabled === true ? false : undefined}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cash out</DialogTitle>
          <DialogDescription>
            <div className="my-4">
              {isSuccess ? (
                <div>Success! You can close this window.</div>
              ) : (
                <>
                  <div className="mb-5 w-[65%]">
                    <span className="text-sm text-black font-medium"> Your {tokenSymbol}</span>
                    <div className="mt-1 border border-melon-300 p-3 bg-melon-25">
                      {balances?.map((balance) => (
                        <div key={balance.chainId} className="flex justify-between gap-2">
                          {chainDisplayName(balance.chainId as JBChainId)}
                          <span className="font-medium">
                            {balance.balance?.format(6)} {tokenSymbol}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid w-full gap-1.5">
                    <Label htmlFor="amount" className="text-zinc-900">
                      Cash out amount
                    </Label>
                    <div className="grid grid-cols-7 gap-2">
                      <div className="col-span-3">
                        {cashOutableBalances.length === 1 ? (
                          <div className="flex h-10 items-center gap-2 border border-melon-300 bg-melon-25 px-3 text-zinc-700">
                            <ChainLogo chainId={cashOutableBalances[0].chainId as JBChainId} />
                            {JB_CHAINS[cashOutableBalances[0].chainId as JBChainId].name}
                          </div>
                        ) : (
                          <Select
                            value={cashOutChainId}
                            onValueChange={(v) => setCashOutChainId(v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select chain" />
                            </SelectTrigger>
                            <SelectContent>
                              {cashOutableBalances.map((balance) => (
                                <SelectItem
                                  value={balance.chainId.toString()}
                                  key={balance.chainId}
                                >
                                  <div className="flex items-center gap-2">
                                    <ChainLogo chainId={balance.chainId as JBChainId} />
                                    {chainDisplayName(balance.chainId as JBChainId)}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="col-span-4">
                        <div className="relative">
                          <Input
                            id="amount"
                            name="amount"
                            value={redeemAmount}
                            onChange={(e) => setRedeemAmount(e.target.value?.trim())}
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
                              onClick={() => {
                                if (!activeCashOutChainId) {
                                  return toast({
                                    variant: "warning",
                                    description: "Please select a chain first.",
                                  });
                                }
                                setRedeemAmount(
                                  pct === 100
                                    ? maxRedeemAmount
                                    : (Number(maxRedeemAmount) * (pct / 100)).toFixed(8),
                                );
                              }}
                              className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
                            >
                              {pct === 100 ? "Max" : `${pct}%`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {redeemAmount && activeCashOutChainId && !valid ? (
                    <div className="text-red-500 mt-4">
                      Insufficient {tokenSymbol} on{" "}
                      {chainDisplayName(Number(activeCashOutChainId) as JBChainId)}
                    </div>
                  ) : null}

                  {redeemAmount && valid && isQuoteError ? (
                    <div className="text-red-500 mt-4">
                      Couldn't quote this cash out. Cash outs unlock after the revnet's initial
                      delay — if it's still locked, try again later.
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="shrink-0 text-sm text-zinc-700">Max slippage</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {[50, 100, 300].map((bps) => (
                        <button
                          key={bps}
                          type="button"
                          onClick={() => setSlippageBps(bps)}
                          className={
                            slippageBps === bps
                              ? "h-7 px-2 text-sm rounded-md border border-teal-500 bg-teal-500 text-melon-950"
                              : "h-7 px-2 text-sm rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                          }
                        >
                          {bps / 100}%
                        </button>
                      ))}
                      <label className="flex h-7 w-[4.75rem] shrink-0 items-center border border-melon-300 bg-melon-25 px-2 text-sm text-zinc-700 focus-within:border-teal-600">
                        <span className="sr-only">Custom max slippage percent</span>
                        <input
                          type="number"
                          min="0"
                          max="99.99"
                          step="0.1"
                          inputMode="decimal"
                          value={slippageBps / 100}
                          onChange={(event) => {
                            const percent = Number(event.target.value);
                            if (Number.isFinite(percent) && percent >= 0 && percent < 100) {
                              setSlippageBps(Math.round(percent * 100));
                            }
                          }}
                          className="min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-right !shadow-none outline-none !ring-0 focus:!border-0 focus:!shadow-none focus:!ring-0"
                        />
                        <span>%</span>
                      </label>
                    </div>
                  </div>

                  {!directSell && poolBufferBps !== null ? (
                    <div className="mt-2 text-sm text-zinc-500">
                      This pool&apos;s preview already allows about{" "}
                      {(poolBufferBps / 100).toFixed(2).replace(/\.00$/, "")}% for its fee and price
                      impact. Your {slippageBps / 100}% setting additionally covers movement before
                      the transaction lands.
                    </div>
                  ) : null}

                  {redeemAmount && valid && cashOutRoute ? (
                    <div className="text-base mt-4">
                      You'll get ~{" "}
                      <span className="font-medium">
                        {formatDecimals(
                          directSell
                            ? Number(formatUnits(directSell.quotedOutput, baseDecimals))
                            : expectedReclaim,
                          5,
                        )}{" "}
                        {baseToken?.symbol}
                      </span>
                      <div className="text-sm text-zinc-500 mt-1">
                        Reverts below{" "}
                        {formatDecimals(
                          directSell
                            ? Number(formatUnits(directSell.minimumOutput, baseDecimals))
                            : minimumReclaim,
                          5,
                        )}{" "}
                        {baseToken?.symbol}
                        {directSell
                          ? ` | direct pool sale beats ${formatDecimals(expectedReclaim, 5)} ${baseToken?.symbol} from cashing out`
                          : " | best hook-aware cash-out route"}
                      </div>
                    </div>
                  ) : null}

                  {isTxLoading ? <div>Transaction submitted, awaiting confirmation...</div> : null}
                </>
              )}
            </div>
          </DialogDescription>
          <DialogFooter>
            {!isSuccess ? (
              <ButtonWithWallet
                targetChainId={selectedSucker?.peerChainId}
                loading={
                  loading || isApproving || (valid && (isQuoteFetching || directSellLoading))
                }
                disabled={valid && !cashOutRoute}
                onClick={() => {
                  setError(null);
                  setReview(true);
                }}
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                {directSell ? "Sell on pool" : "Cash out"}
              </ButtonWithWallet>
            ) : null}
          </DialogFooter>
        </DialogHeader>
        {review && selectedChainId && cashOutRoute ? (
          <TxConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setReview(false);
            }}
            title="Confirm cash out"
            chainId={selectedChainId}
            steps={cashOutSteps}
            activeIndex={cashOutActiveIndex}
            action={
              isApproving
                ? "Approving..."
                : needsErc20Approval
                  ? "Approve tokens"
                  : needsRouterApproval
                    ? "Authorize swap router"
                    : directSell
                      ? "Sell on pool"
                      : "Cash out"
            }
            busy={loading || isApproving}
            error={error}
            onConfirm={async () => {
              try {
                if (
                  !cashOutTerminal ||
                  !address ||
                  !redeemAmountBN ||
                  !cashOutRoute ||
                  !tokenToReceive ||
                  !writeContractAsync
                ) {
                  console.error("Missing required data for cashout");
                  throw new Error("Please try again");
                }

                if (directSell && projectTokenAddress && selectedChainId && deployment) {
                  setIsApproving(needsErc20Approval || needsRouterApproval);
                  if (needsErc20Approval) {
                    await writeApprovalAsync({
                      abi: erc20Abi,
                      functionName: "approve",
                      chainId: selectedChainId,
                      address: projectTokenAddress,
                      args: [PERMIT2_ADDRESS, redeemAmountBN],
                    });
                    return;
                  }
                  if (needsRouterApproval) {
                    await writeApprovalAsync({
                      abi: permit2Abi,
                      functionName: "approve",
                      chainId: selectedChainId,
                      address: PERMIT2_ADDRESS,
                      args: [
                        projectTokenAddress,
                        deployment.universalRouter!,
                        redeemAmountBN,
                        Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
                      ],
                    });
                    return;
                  }
                  const refreshedCashOut = await refetchCashOutRoute();
                  if (refreshedCashOut.isError || !refreshedCashOut.data) {
                    throw new Error(
                      "The cash-out quote is no longer available. Review and try again.",
                    );
                  }
                  const pool = await readPoolSnapshot(selectedChainId, effectiveProjectId).then(
                    (result) => result.pool,
                  );
                  const fresh = pool
                    ? await quoteDirectSellSwap({
                        client: publicClient!,
                        chainId: selectedChainId,
                        poolKey: pool.key,
                        projectToken: projectTokenAddress,
                        tokenToReclaim: tokenToReceive,
                        amount: redeemAmountBN,
                        cashOutRoute: refreshedCashOut.data,
                        slippageBps,
                      })
                    : null;
                  if (!fresh) {
                    throw new Error(
                      "The pool no longer beats cashing out. Review the refreshed quote.",
                    );
                  }
                  await writeContractAsync(
                    buildDirectSellSwapTx({
                      chainId: selectedChainId,
                      quote: fresh,
                      amount: redeemAmountBN,
                      recipient: address,
                      deadline: BigInt(Math.floor(Date.now() / 1000) + 1_800),
                    }),
                  );
                  return;
                }

                const prepared = await prepareHookAwareCashOut(publicClient!, {
                  chainId: selectedChainId!,
                  projectId: effectiveProjectId,
                  holder: address,
                  cashOutCount: redeemAmountBN,
                  tokenToReclaim: tokenToReceive,
                  terminal: cashOutTerminal,
                  beneficiary: address,
                  slippageBps: BigInt(slippageBps),
                });
                if (prepared.route.expectedReturn <= 0n) {
                  throw new Error(
                    "The cash-out quote is no longer available. Review and try again.",
                  );
                }

                await writeContractAsync(prepared.transaction);
              } catch (err) {
                setIsApproving(false);
                console.error("Cashout failed:", err);
                setError(cashOutExecutionErrorMessage(err) ?? formatWalletError(err));
                toast({
                  variant: "destructive",
                  title: "Cashout Failed",
                  description: cashOutExecutionErrorMessage(err) ?? formatWalletError(err),
                });
              }
            }}
          >
            <SummaryRow label="Cash out">
              {redeemAmount} {tokenSymbol}
            </SummaryRow>
            <SummaryRow label="On">{chainDisplayName(selectedChainId)}</SummaryRow>
            <SummaryRow label="You get">
              ~
              {formatDecimals(
                directSell
                  ? Number(formatUnits(directSell.quotedOutput, baseDecimals))
                  : expectedReclaim,
                5,
              )}{" "}
              {baseToken?.symbol}
              <span className="block text-xs text-zinc-500">
                Reverts below{" "}
                {formatDecimals(
                  directSell
                    ? Number(formatUnits(directSell.minimumOutput, baseDecimals))
                    : minimumReclaim,
                  5,
                )}{" "}
                {baseToken?.symbol}
              </span>
            </SummaryRow>
            <SummaryRow label="Route">
              {directSell ? "Direct pool sale" : "Cash out from the treasury"}
            </SummaryRow>
            <SummaryRow label="Max slippage">{slippageBps / 100}%</SummaryRow>
          </TxConfirmDialog>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
