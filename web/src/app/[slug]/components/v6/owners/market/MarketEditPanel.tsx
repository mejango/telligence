"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TxProgress } from "@/components/ui/TxProgress";
import { useReviewedAction } from "@/hooks/useReviewedAction";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { ACCOUNT_CHANGED, requireProposedOrDone, reviewClosed } from "@/lib/reviewed-call";
import { isSafeConnection, useSafeConnection } from "@/lib/safe-connector";
import { liquidityIntent } from "@bananapus/nana-sdk-core/review";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import { chainName, fmtUnits } from "../settlement/lib";
import {
  addsFunds,
  liquidityShortfall,
  lpBandPrices,
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
  liquidityReviewedCalls,
  parseAmountText,
  safeBatchIntro,
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
  const viaSafe = useSafeConnection(wagmiConfig);
  const chainId = Number(state.chainId);
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
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
    /** Freed funds and any new position go to the account that reviewed the edit. */
    account: Address;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  // The pool is found from the server sucker-group project: an edit that adds funds goes only
  // to a registry-listed pair. Withdrawals of the wallet's own positions stay open.
  const gate = useGroupWriteGate([state]);

  const { run } = useReviewedAction();

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
    setFailure(null);
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
      if (addsFunds(plan) && gate.blocked) {
        throw new Error(gate.line ?? "Still confirming this project's chains onchain. Try again.");
      }
      const held = balances.data ?? (await balances.refetch()).data;
      // A re-fit pays in its whole cap and takes the rest back, so the wallet must hold the cap.
      const paysCap = plan.token?.kind === "move" || plan.pair?.kind === "move";
      const short = liquidityShortfall(plan, paysCap, held);
      if (short === "unread") throw new Error("Could not read your wallet balances.");
      if (short)
        throw new Error(
          `That's more ${short === "token" ? tokenSymbol : pool.pair.symbol} than your balance.`,
        );
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
        account: address,
      });
      const tight = [
        held && plan.tokenFunding > held.token ? tokenSymbol : null,
        held && plan.pairFunding > held.pair ? pool.pair.symbol : null,
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
    const { plan, steps, account } = current;
    if (addsFunds(plan) && gate.blocked) return;
    if (account.toLowerCase() !== address.toLowerCase()) {
      setReviewed(null);
      setStatus(ACCOUNT_CHANGED);
      return;
    }
    // One liquidity action in this pool: its approvals are its steps, its batch is it.
    const lpIntent = liquidityIntent({ chainId, pool: current.pool.poolId, positions: [] });
    setBusy(true);
    setStatus(null);
    setFailure(null);
    try {
      const result = requireProposedOrDone(
        await run({
          account,
          title: "Review market edit",
          confirmLabel: "Agree & edit the market",
          context: editContext,
          description: describeMarketEdit(current.pool, plan, tokenSymbol),
          calls: liquidityReviewedCalls(lpIntent, {
            chainId: state.chainId,
            steps,
            unlockData: plan.unlockData,
            value: plan.value,
            safe: isSafeConnection(wagmiConfig),
          }),
          scope: steps.length > 1 ? lpIntent : undefined,
          // A Safe proposes the approvals and the write as one transaction.
          batch: true,
          // After the review, however long it sat open, a changed position or drift beyond the
          // reviewed maxima still aborts first.
          reverify: async (call) => {
            if (call.functionName === "modifyLiquidities")
              await reverifyMarketEdit(current.pool, plan, account);
          },
          beforeWallet: (_call, step) => setStepIndex(step),
        }),
      );
      setReviewed(null);
      if (result.status === "proposed") {
        setStatus(
          steps.length > 1
            ? "Proposed to Safe as one batch. Both sides show their new state under Your liquidity once it executes."
            : "The edit was proposed to Safe and awaits approvals and execution.",
        );
        onDone(null);
        return;
      }
      setStepIndex(steps.length);
      await queryClient.invalidateQueries({ queryKey: ["revnetPoolLpProviders"] });
      onDone(result.hashes.at(-1) ?? null);
    } catch (cause) {
      if (reviewClosed(cause)) setReviewed(null);
      else setFailure(txMessage(cause, "Could not edit this market."));
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

  const editContext = !current
    ? []
    : [
        { label: "Market", value: `${ids} on ${chainName(state.chainId)}` },
        // Without a re-fit the bands keep their ticks, which the current corridor may not describe.
        current.plan.refit
          ? {
              label: "Corridor",
              value: `${
                corridor
                  ? `${formatPrice(corridor.floor)} – ${formatPrice(corridor.ceiling)} ${pool.pair.symbol}/${tokenSymbol}`
                  : "None"
              } (re-fit)`,
            }
          : { label: "Bands", value: "Kept as they are" },
        ...(current.plan.token
          ? [{ label: `${tokenSymbol} side`, value: String(sideLine(current.plan.token, "token")) }]
          : []),
        ...(current.plan.pair
          ? [
              {
                label: `${pool.pair.symbol} side`,
                value: String(sideLine(current.plan.pair, "pair")),
              },
            ]
          : []),
        ...(current.plan.tokenFlow > 0n || current.plan.pairFlow > 0n
          ? [
              {
                label: "From your wallet",
                value: amountsText(
                  positive(current.plan.tokenFlow),
                  positive(current.plan.pairFlow),
                ),
              },
            ]
          : []),
        {
          label: "Back to your wallet",
          value:
            current.plan.tokenFlow < 0n || current.plan.pairFlow < 0n
              ? `${amountsText(positive(-current.plan.tokenFlow), positive(-current.plan.pairFlow))} + unclaimed fees`
              : "Unclaimed fees",
        },
        ...(current.plan.tokenFunding > 0n || current.plan.pairFunding > 0n
          ? [
              {
                label: "Authorizes up to",
                value: `${amountsText(current.plan.tokenFunding, current.plan.pairFunding)} (1% price headroom)`,
              },
            ]
          : []),
        ...(current.plan.tokenMinimum > 0n || current.plan.pairMinimum > 0n
          ? [
              {
                label: "Enforced onchain",
                value: `Removed liquidity pays at least ${amountsText(current.plan.tokenMinimum, current.plan.pairMinimum)} (95% floors)`,
              },
            ]
          : []),
      ];
  return (
    <div className="mt-2 border border-zinc-200 p-2 text-xs text-zinc-700 max-sm:border-x-0 max-sm:px-0">
      <p className="font-medium">
        Edit market {ids} on {chainName(state.chainId)}
      </p>
      <p className="mt-1 text-zinc-500">
        {tokenSymbol} sells above the current price and {pool.pair.symbol} buys below it. Anything
        added comes from your wallet. Anything freed returns to it with unclaimed fees.
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
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-zinc-600">
          {tokenSymbol} to sell above the price
          <Input
            className="mt-1"
            type="number"
            min="0"
            placeholder="0"
            value={tokenText}
            disabled={editing}
            onChange={(event) => setTokenText(event.target.value)}
          />
          {inWallet(balances.data?.token, 18, tokenSymbol)}
        </label>
        <label className="text-xs text-zinc-600">
          {pool.pair.symbol} to buy with below the price
          <Input
            className="mt-1"
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
        <label className="mt-2 flex items-start gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0"
            checked={refit}
            disabled={editing}
            onChange={(event) => setRefit(event.target.checked)}
          />
          <span>
            Match both sides to the current floor and ceiling ({formatPrice(corridor.floor)} –{" "}
            {formatPrice(corridor.ceiling)} {pool.pair.symbol}/{tokenSymbol}).
            {moved
              ? " They moved since these positions were made."
              : " Not needed: the positions already match."}
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
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
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
        <TxProgress
          open
          onClose={() => setReviewed(null)}
          title="Confirm market edit"
          preparing={!current}
          steps={current?.steps ?? []}
          activeIndex={busy ? stepIndex : -1}
          stepsIntro={
            viaSafe && (current?.steps.length ?? 0) > 1 ? safeBatchIntro(current!.steps) : undefined
          }
          start={() => void execute()}
          busy={busy}
          status={status}
          error={failure}
          rows={editContext}
        />
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
