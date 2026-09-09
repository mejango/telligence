"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SkeletonLines } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WalletConnectButton } from "@/components/WalletButton";
import { useBorrowableAmountFrom } from "@/hooks/useBorrowableAmountFrom";
import { useReclaimableSurplus } from "@/hooks/useReclaimableSurplus";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { formatShortDateTime } from "@/lib/date";
import { netLoanProceeds } from "@/lib/feeHelpers";
import { useJBChainId, useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import { useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { getTokenConfigForChain, getTokenSymbolFromAddress, TokenConfig } from "@/lib/tokenUtils";
import { formatTokenSymbol } from "@/lib/utils";
import {
  formatUnits,
  getRevnetLoanContract,
  JB_CHAINS,
  JBCoreContracts,
  jbMultiTerminalAbi,
  jbTokensAbi,
  RevnetCoreContracts,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ProjectItem } from "../../shared";
import { AddLiquidityForm, LiquidityManager } from "../market/AmmCard";
import {
  fetchAmmPresence,
  fetchAmmReferences,
  readUserLpPositions,
  type AmmPresence,
} from "../market/lib";
import { chainName, chainProjectsKey, toChainProjects } from "../settlement/lib";
import { BurnRow, V6BurnTokensDialog } from "./V6BurnTokensDialog";
import { CreditRow, V6ClaimCreditsDialog } from "./V6ClaimCreditsDialog";

const BorrowDialog = dynamic(() =>
  import("../../../Value/BorrowDialog").then((module) => module.BorrowDialog),
);
const BridgeDialog = dynamic(() =>
  import("../../../Value/BridgeDialog").then((module) => module.BridgeDialog),
);
const RedeemDialog = dynamic(() =>
  import("../../../Value/RedeemDialog").then((module) => module.RedeemDialog),
);

type ChainQuote = { cashout: bigint | undefined; maxLoan: bigint | undefined };

/**
 * "You" card (website/ parity: renderYouCard + fetchYouPosition): the connected
 * wallet's per-chain position — Chain | Your balance (credits labeled) | Cash
 * out value | Max loan — plus the action buttons (Cash out, Get a loan, Move
 * between chains, Claim credits). While the revnet's cash out delay is active,
 * cash out values still compute (pure bonding-curve math) and are shown marked
 * "locked"; loans read 0 from the contract, so the would-be loan is estimated
 * by the cash out value, also marked locked.
 */
export function V6YouCard({ projects }: { projects: ProjectItem[] }) {
  const { address } = useViewedAccount();
  const chainId = useJBChainId();
  const {
    projectId,
    contractAddress,
    contracts: { primaryNativeTerminal },
  } = useJBContractContext();
  const { token } = useJBTokenContext();
  const tokenSymbol = formatTokenSymbol(token);
  const projectTokenDecimals = token?.data?.decimals ?? 18;
  const ammChains = useMemo(() => toChainProjects(projects), [projects]);
  // Gate the LP affordances on the cheap pool-existence probe. The heavy
  // reference quotes load lazily once the dialog opens; the composition log
  // scan is never paid here.
  const { data: ammPresence } = useQuery({
    queryKey: ["v6AmmPresence", chainProjectsKey(ammChains)],
    enabled: ammChains.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchAmmPresence(ammChains),
  });
  const pooledAmmStates = useMemo(
    () => ammPresence?.filter((state) => state.pool) ?? [],
    [ammPresence],
  );
  // The chain whose liquidity form the dialog shows, or null while closed.
  // Network selection comes first so a wallet on Base never lands on a
  // Mainnet form by default.
  const [liquidityChain, setLiquidityChain] = useState<JBChainId | null>(null);
  // The positions-first view the You table's LP cell opens — the same
  // hierarchy as juicebox.money's "Your liquidity" modal.
  const [positionsOpen, setPositionsOpen] = useState(false);
  const { chainId: walletChainId, address: connectedAddress } = useAccount();
  const openLiquidity = useCallback(
    (target?: JBChainId) => {
      const pooled = pooledAmmStates.find((state) => state.chainId === (target ?? walletChainId));
      setLiquidityChain(pooled?.chainId ?? pooledAmmStates[0]?.chainId ?? null);
    },
    [pooledAmmStates, walletChainId],
  );
  const { data: dialogAmmStates } = useQuery({
    queryKey: ["v6AmmReferences", chainProjectsKey(ammChains)],
    enabled: (liquidityChain != null || positionsOpen) && pooledAmmStates.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchAmmReferences(pooledAmmStates),
  });

  const { data: balances, isLoading: isLoadingBalances } = useSuckersUserTokenBalance();

  // Full per-chain project rows (currency/decimals/token) for quotes.
  const { data: projectData } = useBendystrawQuery(
    ProjectOperation,
    { projectId: Number(projectId), chainId: Number(chainId), version: 6 },
    { enabled: !!chainId && !!projectId },
  );
  const suckerGroupId = projectData?.project?.suckerGroupId;
  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, chainId: Number(chainId) },
  );
  // Unclaimed credits per chain — drives the "Credits"/"Credits & ERC-20s"
  // balance subtext and the Claim credits flow.
  const creditContracts = useMemo(
    () =>
      address && balances
        ? balances.map((b) => ({
            chainId: b.chainId,
            abi: jbTokensAbi,
            address: contractAddress(JBCoreContracts.JBTokens, b.chainId),
            functionName: "creditBalanceOf" as const,
            args: [address, b.projectId] as const,
          }))
        : [],
    [address, balances, contractAddress],
  );
  const { data: creditsData } = useReadContracts({
    contracts: creditContracts,
    query: { enabled: creditContracts.length > 0 },
  });
  const creditByChain = useMemo(() => {
    const map = new Map<number, bigint>();
    balances?.forEach((b, i) => {
      const result = creditsData?.[i]?.result;
      if (typeof result === "bigint") map.set(b.chainId, result);
    });
    return map;
  }, [balances, creditsData]);

  // Per-chain accounting contexts read on-chain from the canonical
  // JBMultiTerminal — the authoritative (token, currency, decimals) for cash
  // out and loan quotes (e.g. Artizen's USDC context: currency
  // uint32(token) = 3181390099, 6 decimals). The indexer's sucker-group rows
  // are only a fallback: quoting in anything but the accounting currency
  // reverts (no price feed) and rendered every quote as "—".
  const contextContracts = useMemo(
    () =>
      balances
        ? balances.map((b) => ({
            chainId: b.chainId,
            abi: jbMultiTerminalAbi,
            address: contractAddress(JBCoreContracts.JBMultiTerminal, b.chainId),
            functionName: "accountingContextsOf" as const,
            args: [b.projectId] as const,
          }))
        : [],
    [balances, contractAddress],
  );
  const { data: contextsData } = useReadContracts({
    contracts: contextContracts,
    query: { enabled: contextContracts.length > 0 },
  });
  const accountingContextByChain = useMemo(() => {
    const map = new Map<number, TokenConfig>();
    balances?.forEach((b, i) => {
      const contexts = contextsData?.[i]?.result as
        readonly { token: `0x${string}`; decimals: number; currency: number }[] | undefined;
      if (!contexts?.length) return;
      // Projects can hold several contexts; prefer the one for the indexed
      // accounting token, else the first. The indexed config can be null while
      // the sucker-group data loads — the on-chain contexts stay authoritative.
      const indexed = getTokenConfigForChain(suckerGroupData, b.chainId);
      const context =
        (indexed
          ? contexts.find((c) => c.token.toLowerCase() === indexed.token.toLowerCase())
          : undefined) ?? contexts[0];
      map.set(b.chainId, {
        token: context.token,
        currency: Number(context.currency),
        decimals: Number(context.decimals),
        symbol: indexed?.symbol,
      });
    });
    return map;
  }, [balances, contextsData, suckerGroupData]);

  // The revnet's cash out delay gates BOTH direct cash outs and loans.
  const { data: cashOutDelay } = useReadContract({
    abi: revOwnerAbi,
    functionName: "cashOutDelayOf",
    chainId,
    address: contractAddress(RevnetCoreContracts.REVOwner),
    args: [projectId],
    query: { enabled: !!chainId },
  });
  const locked =
    cashOutDelay != null && cashOutDelay > 0n && Number(cashOutDelay) > Date.now() / 1000;

  // Per-chain quotes are read inside each row (hooks); rows report them up so
  // the footer can total.
  const [quotes, setQuotes] = useState<Record<number, ChainQuote>>({});
  const reportQuote = useCallback((rowChainId: number, quote: ChainQuote) => {
    setQuotes((prev) => {
      const existing = prev[rowChainId];
      if (existing && existing.cashout === quote.cashout && existing.maxLoan === quote.maxLoan) {
        return prev;
      }
      return { ...prev, [rowChainId]: quote };
    });
  }, []);

  const held = useMemo(() => (balances ?? []).filter((b) => b.balance.value > 0n), [balances]);
  const totalBalance = held.reduce((acc, b) => acc + b.balance.value, 0n);

  const creditRows: CreditRow[] = useMemo(
    () =>
      held.flatMap((b) => {
        const credit = creditByChain.get(b.chainId);
        return credit && credit > 0n
          ? [{ chainId: b.chainId as JBChainId, projectId: b.projectId, credit }]
          : [];
      }),
    [held, creditByChain],
  );
  const burnRows: BurnRow[] = held.map((b) => ({
    chainId: b.chainId as JBChainId,
    projectId: b.projectId,
    balance: b.balance.value,
  }));
  const hasErc20 = !!token?.data?.symbol;

  if (!address) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-md text-black font-light italic">
          Connect a wallet to see your {tokenSymbol} across chains, their cash out value, and your
          max loan.
        </p>
        <WalletConnectButton />
      </div>
    );
  }

  // Cross-chain monetary totals are only honest when every held chain produced
  // a value in the same accounting token. A null config (sucker-group data
  // still loading) counts as unresolved — never assumed to be ETH.
  const heldConfigs = held.map(
    (b) =>
      accountingContextByChain.get(b.chainId) ?? getTokenConfigForChain(suckerGroupData, b.chainId),
  );
  const firstConfig = heldConfigs[0] ?? null;
  const homogeneous =
    !!firstConfig &&
    heldConfigs.every(
      (c) =>
        !!c &&
        c.decimals === firstConfig.decimals &&
        (c.symbol ?? getTokenSymbolFromAddress(c.token)) ===
          (firstConfig.symbol ?? getTokenSymbolFromAddress(firstConfig.token)),
    );
  const baseSymbol = firstConfig
    ? (firstConfig.symbol ?? getTokenSymbolFromAddress(firstConfig.token))
    : "";
  const baseDecimals = firstConfig?.decimals ?? 18;
  const cashComplete = homogeneous && held.every((b) => quotes[b.chainId]?.cashout !== undefined);
  const loanComplete = homogeneous && held.every((b) => quotes[b.chainId]?.maxLoan !== undefined);
  const totalCashout = held.reduce((acc, b) => acc + (quotes[b.chainId]?.cashout ?? 0n), 0n);
  const totalMaxLoan = held.reduce((acc, b) => acc + (quotes[b.chainId]?.maxLoan ?? 0n), 0n);
  const anyCredit = held.some((b) => (creditByChain.get(b.chainId) ?? 0n) > 0n);
  const anyErc20 = held.some((b) => {
    const credit = creditByChain.get(b.chainId);
    return credit != null && b.balance.value > credit;
  });

  const fmtBase = (value: bigint) =>
    `${formatUnits(value, baseDecimals, { fractionDigits: 5 })} ${baseSymbol}`;

  return (
    <div>
      {held.length === 0 ? (
        isLoadingBalances ? (
          <TableSkeleton rows={Math.max(projects.length, 2)} columns={4} />
        ) : (
          <p className="text-md text-black font-light italic">
            You don&apos;t hold any {tokenSymbol} yet.
          </p>
        )
      ) : (
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chain</TableHead>
                <TableHead className="text-right">Your balance</TableHead>
                <TableHead className="text-right">Cash out value</TableHead>
                <TableHead
                  className="text-right"
                  title="Estimated proceeds after the protocol, REV, and minimum source fees"
                >
                  Max loan
                </TableHead>
                <TableHead className="text-right">LP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {held.map((b) => (
                <YouChainRow
                  key={b.chainId}
                  chainId={b.chainId as JBChainId}
                  chainProjectId={b.projectId}
                  balanceValue={b.balance.value}
                  credit={creditByChain.get(b.chainId)}
                  locked={locked}
                  tokenSymbol={tokenSymbol}
                  projectTokenDecimals={projectTokenDecimals}
                  accountingContext={accountingContextByChain.get(b.chainId)}
                  suckerGroupData={suckerGroupData}
                  isRevnet={projectData?.project?.isRevnet ?? undefined}
                  onQuote={reportQuote}
                  ammState={ammPresence?.find((state) => state.chainId === b.chainId)}
                  onManage={() => setPositionsOpen(true)}
                />
              ))}
            </TableBody>
            {held.length > 1 && (
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <CellWithSub
                      main={`${formatUnits(totalBalance, projectTokenDecimals, {
                        fractionDigits: 2,
                      })} ${tokenSymbol}`}
                      sub={subFor(anyCredit, anyErc20)}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cashComplete ? (
                      <CellWithSub
                        main={fmtBase(totalCashout)}
                        sub={locked ? "locked" : undefined}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {locked ? "Locked" : loanComplete ? fmtBase(totalMaxLoan) : "—"}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}

      {locked && cashOutDelay != null && (
        <p className="text-sm text-zinc-500 mt-2">
          Cash outs and loans unlock {formatShortDateTime(Number(cashOutDelay) * 1000)}. The cash
          out value estimates what you could redeem then; net loan proceeds appear once loans
          unlock.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <RedeemDialog projectId={projectId} tokenSymbol={tokenSymbol}>
          <Button
            variant="outline"
            disabled={totalBalance === 0n || !hasErc20 || !primaryNativeTerminal.data}
            className="border-teal-500 bg-teal-500 text-melon-950 hover:bg-teal-600 hover:text-melon-950"
          >
            Cash out
          </Button>
        </RedeemDialog>

        <BorrowDialog projectId={projectId} tokenSymbol={tokenSymbol}>
          <Button
            variant="outline"
            disabled={totalBalance === 0n || !hasErc20 || !primaryNativeTerminal.data}
            className="border-teal-500 bg-teal-500 text-melon-950 hover:bg-teal-600 hover:text-melon-950"
          >
            Get a loan
          </Button>
        </BorrowDialog>

        {projects.length > 1 && (
          <BridgeDialog projects={projects}>
            <Button
              variant="outline"
              disabled={totalBalance === 0n}
              className="border-teal-500 bg-teal-500 text-melon-950 hover:bg-teal-600 hover:text-melon-950"
            >
              Move between chains
            </Button>
          </BridgeDialog>
        )}

        {hasErc20 && (
          <V6ClaimCreditsDialog
            creditRows={creditRows}
            tokenSymbol={tokenSymbol}
            batchScope={projects
              .map((project) => `${project.chainId}:${project.projectId}`)
              .sort()
              .join("|")}
          >
            <Button
              variant="outline"
              className="border-teal-500 bg-teal-500 text-melon-950 hover:bg-teal-600 hover:text-melon-950"
            >
              Claim credits
            </Button>
          </V6ClaimCreditsDialog>
        )}

        {ammChains.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            // Rendered from the start and only enabled once the pool probe
            // resolves, so the row never gains a button mid-load.
            disabled={pooledAmmStates.length === 0}
            className="border-teal-500 bg-teal-500 text-melon-950 hover:bg-teal-600 hover:text-melon-950"
            onClick={() => openLiquidity()}
          >
            Add liquidity
          </Button>
        ) : null}

        {burnRows.length > 0 && (
          <V6BurnTokensDialog rows={burnRows} tokenSymbol={tokenSymbol}>
            <Button variant="secondary">Burn</Button>
          </V6BurnTokensDialog>
        )}
      </div>

      {positionsOpen && pooledAmmStates.length > 0 ? (
        <Dialog open onOpenChange={(next) => !next && setPositionsOpen(false)}>
          <DialogContent className="max-w-2xl">
            <DialogTitle className="text-base font-medium">Your liquidity</DialogTitle>
            <p className="text-sm text-zinc-500">
              Positions owned by{" "}
              {connectedAddress ? (
                <EthereumAddress address={connectedAddress} short withEnsName />
              ) : (
                "your connected wallet"
              )}{" "}
              in the project&apos;s market pools.
            </p>
            {dialogAmmStates ? (
              <LiquidityManager states={dialogAmmStates} tokenSymbol={tokenSymbol} heading={null} />
            ) : (
              <SkeletonLines lines={3} />
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {liquidityChain != null && pooledAmmStates.length > 0 ? (
        <Dialog open onOpenChange={(next) => !next && setLiquidityChain(null)}>
          <DialogContent className="max-w-lg">
            <DialogTitle className="text-base font-medium">Market liquidity</DialogTitle>
            <p className="text-sm text-zinc-500">Add liquidity from your connected wallet.</p>
            <div className="flex flex-wrap gap-1">
              {pooledAmmStates.map((state) => (
                <LiquidityChainPill
                  key={state.chainId}
                  state={state}
                  selected={state.chainId === liquidityChain}
                  onSelect={() => setLiquidityChain(state.chainId)}
                />
              ))}
            </div>
            {(() => {
              const state = dialogAmmStates?.find(
                (candidate) => candidate.chainId === liquidityChain && candidate.pool,
              );
              if (!state) return <SkeletonLines lines={4} />;
              return (
                <div key={state.chainId}>
                  <AddLiquidityForm state={state} tokenSymbol={tokenSymbol} />
                </div>
              );
            })()}
            {/* Existing positions live in the positions-first "Your liquidity"
                dialog (the You table's LP cell); this dialog only adds. */}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** "Credits" (all unclaimed), "Credits & ERC-20s" (both), or none (all claimed). */
function subFor(hasCredit: boolean, hasErc20: boolean) {
  if (hasCredit && hasErc20) return "Credits & ERC-20s";
  if (hasCredit) return "Credits";
  return undefined;
}

function CellWithSub({ main, sub }: { main: string; sub?: string }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span>{main}</span>
      {sub && <span className="text-xs text-zinc-400">{sub}</span>}
    </span>
  );
}

/**
 * One network tab in the liquidity dialog. The dot marks chains where the
 * connected wallet already holds LP positions (same query the LP column
 * runs, so the cache is shared).
 */
function LiquidityChainPill({
  state,
  selected,
  onSelect,
}: {
  state: AmmPresence;
  selected: boolean;
  onSelect: () => void;
}) {
  // The whole card reads the VIEWED account, so the LP dot must too — under
  // "View as" the connected wallet is not the account being shown.
  const { address } = useViewedAccount();
  const pool = state.pool;
  const positions = useQuery({
    queryKey: ["revnetWalletLpPositions", pool?.chainId, pool?.poolId, address?.toLowerCase()],
    enabled: Boolean(pool && address),
    retry: 0,
    staleTime: 30_000,
    queryFn: () => readUserLpPositions(pool!, address!),
  });
  const hasLiquidity = (positions.data?.length ?? 0) > 0;
  return (
    <button
      type="button"
      className={
        selected
          ? "flex items-center gap-1.5 bg-zinc-900 px-2.5 py-1.5 text-xs text-white"
          : "flex items-center gap-1.5 border border-zinc-300 px-2.5 py-1.5 text-xs hover:bg-zinc-50"
      }
      onClick={onSelect}
    >
      <ChainLogo chainId={state.chainId} width={14} height={14} />
      {chainName(state.chainId)}
      {hasLiquidity ? (
        <span
          className="h-1.5 w-1.5 rounded-full bg-teal-400"
          title="You have liquidity on this network"
          aria-label="You have liquidity on this network"
        />
      ) : null}
    </button>
  );
}

/**
 * The wallet's LP standing on one chain: how many positions it owns, revealing
 * the card's own Market liquidity section to see earned fees, claim,
 * or exit. "—" where the chain has no pool or the wallet has no position; an
 * unreadable scan says so rather than reading as "none".
 */
function YourLpCell({
  ammState,
  onManage,
}: {
  ammState: AmmPresence | undefined;
  onManage: () => void;
}) {
  const { address } = useViewedAccount();
  const pool = ammState?.pool ?? null;

  const positions = useQuery({
    queryKey: ["revnetWalletLpPositions", pool?.chainId, pool?.poolId, address?.toLowerCase()],
    enabled: Boolean(pool && address),
    retry: 0,
    staleTime: 30_000,
    queryFn: () => readUserLpPositions(pool!, address!),
  });

  if (!address || !pool) return <>—</>;
  if (positions.isLoading) return <span className="text-zinc-400">…</span>;
  if (positions.isError) {
    return (
      <span
        className="text-zinc-400"
        title="Could not verify the complete LP history on this chain."
      >
        Unavailable
      </span>
    );
  }
  if (!positions.data?.length) return <>—</>;

  return (
    <button
      type="button"
      onClick={onManage}
      className="underline decoration-dotted underline-offset-2 hover:text-zinc-900"
    >
      {positions.data.length} {positions.data.length === 1 ? "position" : "positions"}
    </button>
  );
}

function YouChainRow({
  chainId,
  chainProjectId,
  balanceValue,
  credit,
  locked,
  tokenSymbol,
  projectTokenDecimals,
  accountingContext,
  suckerGroupData,
  isRevnet,
  onQuote,
  ammState,
  onManage,
}: {
  chainId: JBChainId;
  chainProjectId: bigint;
  balanceValue: bigint;
  credit: bigint | undefined;
  locked: boolean;
  tokenSymbol: string;
  projectTokenDecimals: number;
  accountingContext: TokenConfig | undefined;
  suckerGroupData: any;
  /** Only a revnet pays the revnet cash-out fee; undefined while it loads. */
  isRevnet: boolean | undefined;
  onQuote: (chainId: number, quote: ChainQuote) => void;
  ammState: AmmPresence | undefined;
  onManage: () => void;
}) {
  // Null while the accounting context is unresolved — the quotes stay gated
  // (rows show "—") instead of being asked in ETH/18 by default.
  const config = accountingContext ?? getTokenConfigForChain(suckerGroupData, chainId);
  const baseSymbol = config ? (config.symbol ?? getTokenSymbolFromAddress(config.token)) : "";

  // v6 currentReclaimableSurplusOf takes empty (terminals, tokens) arrays,
  // meaning "across all of them"; the hook applies the protocol fees. Both
  // quotes are asked in the accounting context's own currency and decimals —
  // any other currency needs a price feed the project may not have.
  const { data: cashout } = useReclaimableSurplus({
    chainId,
    projectId: chainProjectId,
    tokenAmount: config ? balanceValue : undefined,
    decimals: config?.decimals ?? 18,
    currencyId: config?.currency ?? 0,
    token: config?.token,
    // Only a revnet pays the revnet cash-out fee (REVOwner is its data hook).
    isRevnet,
  });

  // v6 borrowableAmountFrom returns a (borrowableNow, capacity) tuple; the hook
  // returns borrowableNow. Reads 0 while the cash out delay is active.
  const { data: grossMaxLoan } = useBorrowableAmountFrom({
    address: getRevnetLoanContract(6, chainId),
    chainId,
    args: config
      ? [chainProjectId, balanceValue, BigInt(config.decimals), BigInt(config.currency)]
      : undefined,
  });

  const maxLoan = grossMaxLoan === undefined ? undefined : netLoanProceeds(grossMaxLoan);

  useEffect(() => {
    onQuote(chainId, { cashout, maxLoan });
  }, [chainId, cashout, maxLoan, onQuote]);

  const fmtBase = (value: bigint) =>
    config ? `${formatUnits(value, config.decimals, { fractionDigits: 5 })} ${baseSymbol}` : "—";

  const loanCell = () => {
    if (maxLoan === undefined) return "—";
    if (maxLoan > 0n) return fmtBase(maxLoan);
    // `borrowableAmountFrom` deliberately returns 0 while loans are locked.
    // Do not substitute the cash-out quote: it does not include the same fee
    // path, so it cannot honestly describe net loan proceeds.
    return locked ? "Locked" : fmtBase(0n);
  };

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-2">
          <ChainLogo chainId={chainId} width={15} height={15} />
          <span>{JB_CHAINS[chainId]?.name ?? chainId}</span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">
        <CellWithSub
          main={`${formatUnits(balanceValue, projectTokenDecimals, {
            fractionDigits: 2,
          })} ${tokenSymbol}`}
          sub={credit != null ? subFor(credit > 0n, balanceValue > credit) : undefined}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">
        {cashout != null ? (
          <CellWithSub main={fmtBase(cashout)} sub={locked ? "locked" : undefined} />
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">{loanCell()}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <YourLpCell ammState={ammState} onManage={onManage} />
      </TableCell>
    </TableRow>
  );
}
