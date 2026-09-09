"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useAllowance } from "@/hooks/useAllowance";
import {
  isSafeConnection,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits, zeroAddress, type Hex, type PublicClient } from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import { chainName, fmtUnits } from "../settlement/lib";
import {
  lpBandPrices,
  lpDeadline,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
  prepareMarketEdit,
  refreshPoolAndPosition,
  reverifyMarketEdit,
  type AmmChainState,
  type MarketCorridor,
  type MarketEditPlan,
  type MarketSideEdit,
  type MarketSides,
  type PoolSnapshot,
} from "./lib";
import { LiquidityRangePreview } from "./LiquidityRangePreview";
import {
  approvalStepsFor,
  parseAmountText,
  runApprovalStep,
  SummaryRow,
  type LiquidityStep,
} from "./liquidityWrite";

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  return String(Number(price.toPrecision(6)));
}

function txMessage(cause: unknown, fallback: string): string {
  const error = cause as { shortMessage?: string; message?: string } | null;
  return error?.shortMessage || error?.message || fallback;
}

const SIDE_VERB: Record<MarketSideEdit["kind"], string> = {
  increase: "tops up",
  decrease: "frees part of",
  remove: "removes",
  move: "re-fits",
  mint: "mints",
  keep: "keeps",
};

/**
 * Whether either side's band no longer matches the corridor: the stage moved
 * the ceiling (issuance cut) or the floor (cash-outs), so the edges are stale.
 */
function corridorMoved(pool: PoolSnapshot, sides: MarketSides, corridor: MarketCorridor): boolean {
  const off = (actual: number, expected: number) => Math.abs(actual - expected) / expected > 0.005;
  if (sides.tokenSide) {
    const band = lpBandPrices(pool, sides.tokenSide.tickLower, sides.tokenSide.tickUpper);
    if (off(band.maximumPrice, corridor.ceiling)) return true;
  }
  if (sides.pairSide) {
    const band = lpBandPrices(pool, sides.pairSide.tickLower, sides.pairSide.tickUpper);
    if (off(band.minimumPrice, corridor.floor)) return true;
  }
  return false;
}

/**
 * Edit a market: what each side holds, and whether both sides get re-fit to
 * the corridor as it stands now. Each side is its own position, so a change
 * on one side never burns the other. Approvals a top-up needs are queued
 * ahead of the edit, the plan is sized from a fresh pool and position read
 * at review time, and it is re-checked right before the wallet asks.
 */
export function MarketEditPanel({
  state,
  pool,
  sides,
  tokenSymbol,
  startEmpty = false,
  onClose,
  onDone,
}: {
  state: AmmChainState;
  pool: PoolSnapshot;
  sides: MarketSides;
  tokenSymbol: string;
  /** Open with both sides at 0 — the market's Remove action. */
  startEmpty?: boolean;
  onClose: () => void;
  /** Called once the edit has landed (or been proposed to a Safe). */
  onDone: (hash: Hex | null) => void;
}) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = Number(state.chainId);
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const { ensureAllowance } = useAllowance(chainId);
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId]!;
  const corridor = useMemo<MarketCorridor | null>(
    () =>
      state.reference.cashOut && state.reference.issuance
        ? { floor: state.reference.cashOut, ceiling: state.reference.issuance }
        : null,
    [state.reference.cashOut, state.reference.issuance],
  );

  const [tokenText, setTokenText] = useState(
    startEmpty ? "0" : formatUnits(sides.tokenSide?.tokenAmount ?? 0n, 18),
  );
  const [pairText, setPairText] = useState(
    startEmpty ? "0" : formatUnits(sides.pairSide?.pairAmount ?? 0n, pool.pair.decimals),
  );
  const moved = corridor ? corridorMoved(pool, sides, corridor) : false;
  const [refit, setRefit] = useState(moved);
  const [reviewed, setReviewed] = useState<{
    pool: PoolSnapshot;
    sides: MarketSides;
    plan: MarketEditPlan;
    steps: LiquidityStep[];
    snapshot: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const review = useRef({
    title: "Review market edit",
    confirmLabel: "Agree & edit the market",
    description: "",
  });
  const activePlan = useRef<{ pool: PoolSnapshot; plan: MarketEditPlan } | null>(null);
  const { writeContractAsync } = useWriteContract({
    transactionReview: review.current,
    // Runs AFTER the confirm modal, so however long it sat open, a changed
    // position or drift beyond the reviewed maxima still aborts first.
    reverify: async () => {
      if (activePlan.current && address) {
        await reverifyMarketEdit(activePlan.current.pool, activePlan.current.plan, address);
      }
    },
  });

  const balances = useQuery({
    queryKey: ["v6LpEditBalances", chainId, pool.projectToken, pool.pair.addr, address],
    enabled: !!address && !!publicClient,
    queryFn: async () => {
      const [token, pair] = await Promise.all([
        publicClient!.readContract({
          address: pool.projectToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        }),
        pool.pair.addr === zeroAddress
          ? publicClient!.getBalance({ address: address! })
          : publicClient!.readContract({
              address: pool.pair.addr,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address!],
            }),
      ]);
      return { token, pair };
    },
  });

  const snapshot = [tokenText, pairText, refit].join("|");
  const current = reviewed?.snapshot === snapshot ? reviewed : null;
  const editing = busy || current !== null;

  // What the typed targets produce, computed locally as they type.
  const preview = useMemo(() => {
    if (!corridor) return null;
    try {
      const tokenAmount = parseAmountText(tokenText, 18, tokenSymbol);
      const pairAmount = parseAmountText(pairText, pool.pair.decimals, pool.pair.symbol);
      return prepareMarketEdit(
        pool,
        sides,
        { tokenAmount, pairAmount },
        corridor,
        refit,
        address ?? zeroAddress,
      );
    } catch {
      return null;
    }
  }, [corridor, tokenText, pairText, refit, pool, sides, address, tokenSymbol]);

  const prepare = async () => {
    if (!address || !publicClient) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!corridor) {
      setStatus("This revnet has no floor and ceiling to fit a market to.");
      return;
    }
    setBusy(true);
    setStepIndex(0);
    setStatus("Reading the live pool, positions and wallet balances…");
    try {
      const tokenAmount = parseAmountText(tokenText, 18, tokenSymbol);
      const pairAmount = parseAmountText(pairText, pool.pair.decimals, pool.pair.symbol);
      // Both sides re-read against one fresh price, so neither is sized stale.
      let freshPool = pool;
      const freshSides: MarketSides = { tokenSide: null, pairSide: null };
      for (const side of ["tokenSide", "pairSide"] as const) {
        const position = sides[side];
        if (!position) continue;
        const fresh = await refreshPoolAndPosition(freshPool, position.tokenId, address);
        freshPool = fresh.pool;
        freshSides[side] = fresh.position;
      }
      const plan = prepareMarketEdit(
        freshPool,
        freshSides,
        { tokenAmount, pairAmount },
        corridor,
        refit,
        address,
      );
      const held = balances.data ?? (await balances.refetch()).data;
      if (!held) throw new Error("Could not read your wallet balances.");
      if (plan.tokenFlow > held.token) {
        throw new Error(`That's more ${tokenSymbol} than your balance.`);
      }
      if (plan.pairFlow > held.pair) {
        throw new Error(`That's more ${pool.pair.symbol} than your balance.`);
      }
      const steps = await approvalStepsFor({
        publicClient: publicClient as PublicClient,
        chainId: state.chainId,
        address,
        erc20Sides: plan.erc20Sides,
        symbolOf: (currency) =>
          currency.toLowerCase() === pool.projectToken.toLowerCase()
            ? tokenSymbol
            : pool.pair.symbol,
      });
      setReviewed({
        pool: freshPool,
        sides: freshSides,
        plan,
        steps: [
          ...steps,
          {
            title: "Edit the market",
            detail: "Every side's change lands in a single transaction.",
          },
        ],
        snapshot,
      });
      const tight = [
        plan.tokenFunding > held.token ? tokenSymbol : null,
        plan.pairFunding > held.pair ? pool.pair.symbol : null,
      ].filter((symbol): symbol is string => symbol != null);
      setStatus(
        tight.length
          ? `Heads up: your ${tight.join(" and ")} balance does not cover the 1% price headroom, ` +
              `so this edit reverts if the price moves against it. Lower the amount to be safe.`
          : null,
      );
    } catch (cause) {
      setReviewed(null);
      setStatus(txMessage(cause, "Could not prepare this edit."));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!address || !publicClient || !current) return;
    const { plan, steps } = current;
    setBusy(true);
    setStatus(null);
    try {
      for (const [index, step] of steps.entries()) {
        setStepIndex(index);
        if (step.approval) {
          const outcome = await runApprovalStep(step, {
            chainId: state.chainId,
            address,
            publicClient: publicClient as PublicClient,
            ensureAllowance,
            approvePermit2: (args) =>
              writeContractAsync({
                chainId,
                address: PERMIT2_ADDRESS,
                abi: PERMIT2_ABI,
                functionName: "approve",
                args,
              }),
          });
          if (outcome === "safe-proposed") {
            setStatus(
              "Permit2 authorization was proposed to Safe. Execute it, then review the edit again.",
            );
            setReviewed(null);
            return;
          }
          continue;
        }
        activePlan.current = { pool: current.pool, plan };
        review.current.description = describeMarketEdit(current.pool, plan, tokenSymbol);
        const hash = await writeContractAsync({
          chainId,
          address: positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: "modifyLiquidities",
          args: [plan.unlockData, lpDeadline(isSafeConnection(wagmiConfig))],
          value: plan.value,
        });
        if (submittedViaSafe(hash)) {
          setStatus("The edit was proposed to Safe and awaits approvals and execution.");
          setReviewed(null);
          onDone(null);
          return;
        }
        const receipt = await waitForReceiptWithRetry(publicClient, hash);
        if (receipt.status !== "success") throw new Error(`Market edit ${hash} reverted.`);
        setStepIndex(steps.length);
        await queryClient.invalidateQueries({ queryKey: ["revnetPoolLpProviders"] });
        onDone(hash);
      }
    } catch (cause) {
      setStatus(txMessage(cause, "Could not edit this market."));
    } finally {
      setBusy(false);
    }
  };

  const amountsText = (token: bigint, pair: bigint) =>
    [
      token > 0n ? `${fmtUnits(token, 18)} ${tokenSymbol}` : null,
      pair > 0n ? `${fmtUnits(pair, pool.pair.decimals)} ${pool.pair.symbol}` : null,
    ]
      .filter(Boolean)
      .join(" + ");
  const positive = (amount: bigint) => (amount > 0n ? amount : 0n);
  const inWallet = (amount: bigint | undefined, decimals: number, symbol: string) =>
    amount == null ? null : (
      <span className="mt-1 block text-right text-zinc-400">
        {fmtUnits(amount, decimals)} {symbol} in wallet
      </span>
    );
  const sideLine = (side: MarketSideEdit | null, own: "token" | "pair") => {
    if (!side) return null;
    const symbol = own === "token" ? tokenSymbol : pool.pair.symbol;
    const decimals = own === "token" ? 18 : pool.pair.decimals;
    const id = side.tokenId !== null ? ` #${side.tokenId.toString()}` : "";
    return `${SIDE_VERB[side.kind]}${id}, holds ~${fmtUnits(side.holding, decimals)} ${symbol}`;
  };
  const ids = [sides.tokenSide, sides.pairSide]
    .filter((side) => side !== null)
    .map((side) => `#${side!.tokenId.toString()}`)
    .join(" + ");

  return (
    <div className="mt-2 border border-zinc-200 p-2 text-xs text-zinc-700">
      <p className="font-medium">
        Edit market {ids} on {chainName(state.chainId)}
      </p>
      <p className="mt-1 text-zinc-500">
        {tokenSymbol} sells from the current price up to the ceiling; {pool.pair.symbol} buys from
        the current price down to the floor. Each side is its own position, so each amount is used
        in full and a change on one side never touches the other. Anything added comes from your
        wallet and anything freed returns to it, with unclaimed fees, in one transaction.
      </p>
      <LiquidityRangePreview
        floor={state.reference.cashOut}
        ceiling={state.reference.issuance}
        current={pool.price}
        minimum={corridor?.floor ?? 0}
        maximum={corridor?.ceiling ?? 0}
        pairSymbol={pool.pair.symbol}
        tokenSymbol={tokenSymbol}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">
          {tokenSymbol} to sell above the price
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={tokenText}
            disabled={editing}
            onChange={(event) => setTokenText(event.target.value)}
          />
          {inWallet(balances.data?.token, 18, tokenSymbol)}
        </label>
        <label className="text-[11px] text-zinc-500">
          {pool.pair.symbol} to buy with below the price
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={pairText}
            disabled={editing}
            onChange={(event) => setPairText(event.target.value)}
          />
          {inWallet(balances.data?.pair, pool.pair.decimals, pool.pair.symbol)}
        </label>
      </div>
      {corridor ? (
        <label className="mt-2 flex items-start gap-2 text-[11px] text-zinc-600">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={refit}
            disabled={editing}
            onChange={(event) => setRefit(event.target.checked)}
          />
          <span>
            Re-fit both sides to the current corridor ({formatPrice(corridor.floor)} –{" "}
            {formatPrice(corridor.ceiling)} {pool.pair.symbol}/{tokenSymbol}).
            {moved
              ? " The floor or ceiling moved since these positions were minted, so their edges are stale."
              : " Not needed right now — the positions already match it."}
          </span>
        </label>
      ) : (
        <p className="mt-2 text-[11px] text-zinc-500">
          This revnet has no floor and ceiling to fit a market to, so the sides can only be topped
          up, freed or removed as they are.
        </p>
      )}
      {preview ? (
        <p className="mt-1 text-[11px] text-zinc-600" role="status">
          {[sideLine(preview.token, "token"), sideLine(preview.pair, "pair")]
            .filter(Boolean)
            .map((line, index) => `${index === 0 ? tokenSymbol : pool.pair.symbol} side ${line}`)
            .join(". ")}
          .
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-zinc-500">
        Set a side to 0 to remove that position. Both at 0 removes the market.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <ButtonWithWallet
          targetChainId={state.chainId}
          loading={busy}
          disabled={busy || !corridor}
          onClick={() => void prepare()}
          connectWalletText="Connect Wallet"
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          Edit the market
        </ButtonWithWallet>
      </div>
      {current || busy ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewed(null);
          }}
          title="Confirm market edit"
          chainId={state.chainId}
          preparing={!current}
          steps={current?.steps ?? []}
          activeIndex={busy ? stepIndex : -1}
          action="Edit the market"
          onConfirm={() => void execute()}
          busy={busy}
          status={status}
        >
          {current ? (
            <>
              <SummaryRow label="Market">
                {ids} on {chainName(state.chainId)}
              </SummaryRow>
              <SummaryRow label="Corridor">
                {corridor
                  ? `${formatPrice(corridor.floor)} – ${formatPrice(corridor.ceiling)} ${pool.pair.symbol}/${tokenSymbol}`
                  : "—"}
                {current.plan.refit ? " (re-fit)" : " (kept)"}
              </SummaryRow>
              {current.plan.token ? (
                <SummaryRow label={`${tokenSymbol} side`}>
                  {sideLine(current.plan.token, "token")}
                </SummaryRow>
              ) : null}
              {current.plan.pair ? (
                <SummaryRow label={`${pool.pair.symbol} side`}>
                  {sideLine(current.plan.pair, "pair")}
                </SummaryRow>
              ) : null}
              {current.plan.tokenFlow > 0n || current.plan.pairFlow > 0n ? (
                <SummaryRow label="From your wallet">
                  {amountsText(positive(current.plan.tokenFlow), positive(current.plan.pairFlow))}
                </SummaryRow>
              ) : null}
              <SummaryRow label="Back to your wallet">
                {current.plan.tokenFlow < 0n || current.plan.pairFlow < 0n
                  ? `${amountsText(positive(-current.plan.tokenFlow), positive(-current.plan.pairFlow))} + unclaimed fees`
                  : "Unclaimed fees"}
              </SummaryRow>
              {current.plan.tokenFunding > 0n || current.plan.pairFunding > 0n ? (
                <SummaryRow label="Authorizes up to">
                  {amountsText(current.plan.tokenFunding, current.plan.pairFunding)} (1% price
                  headroom)
                </SummaryRow>
              ) : null}
              {current.plan.tokenMinimum > 0n || current.plan.pairMinimum > 0n ? (
                <SummaryRow label="Enforced onchain">
                  At least {amountsText(current.plan.tokenMinimum, current.plan.pairMinimum)} back
                  (95% floors)
                </SummaryRow>
              ) : null}
            </>
          ) : null}
        </TxConfirmDialog>
      ) : null}
      {status && !current ? (
        <p className="mt-2 wrap-anywhere text-[11px] text-zinc-600" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

/** The safety-check description: each side's change in one line, then the wallet flows. */
function describeMarketEdit(pool: PoolSnapshot, plan: MarketEditPlan, tokenSymbol: string): string {
  const side = (edit: MarketSideEdit | null, own: "token" | "pair") => {
    if (!edit) return null;
    const symbol = own === "token" ? tokenSymbol : pool.pair.symbol;
    const decimals = own === "token" ? 18 : pool.pair.decimals;
    const id = edit.tokenId !== null ? ` position #${edit.tokenId.toString()}` : " a new position";
    return `${symbol} side: ${SIDE_VERB[edit.kind]}${id}, holding about ${fmtUnits(edit.holding, decimals)} ${symbol} afterwards.`;
  };
  const pulls = [
    plan.tokenFlow > 0n ? `${fmtUnits(plan.tokenFlow, 18)} ${tokenSymbol}` : null,
    plan.pairFlow > 0n
      ? `${fmtUnits(plan.pairFlow, pool.pair.decimals)} ${pool.pair.symbol}`
      : null,
  ].filter(Boolean);
  const returns = [
    plan.tokenFlow < 0n ? `${fmtUnits(-plan.tokenFlow, 18)} ${tokenSymbol}` : null,
    plan.pairFlow < 0n
      ? `${fmtUnits(-plan.pairFlow, pool.pair.decimals)} ${pool.pair.symbol}`
      : null,
  ].filter(Boolean);
  return [
    side(plan.token, "token"),
    side(plan.pair, "pair"),
    pulls.length ? `Your wallet pays about ${pulls.join(" + ")}.` : null,
    `${returns.length ? `About ${returns.join(" + ")} and ` : ""}unclaimed fees return to your wallet in the same transaction.`,
    "If the price moves too far before it lands, the whole edit reverts and every position stays as it is.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
