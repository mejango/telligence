"use client";

import { ParticipantsPieChart } from "@/app/[slug]/owners/components/ParticipantsPieChart";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { ExternalLink } from "@/components/ExternalLink";
import { Revalidating } from "@/components/ui/Revalidating";
import { SkeletonLines } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useAllowance } from "@/hooks/useAllowance";
import {
  isSafeConnection,
  proposeSafeBatch,
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { cachedQuery } from "@/lib/query-persist";
import { explorerBaseUrl } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  uniswapV4AmountsForLiquidity,
  uniswapV4DefaultPriceRange,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import {
  chainName,
  ChainProject,
  chainProjectsKey,
  explorerAddressUrl,
  fmtUnits,
} from "../settlement/lib";
import { EditPositionPanel } from "./EditPositionPanel";
import { liquidityFormView, type LiquidityFormMode, type LiquidityFormSide } from "./formView";
import {
  AmmChainState,
  fetchAmmStates,
  fetchPoolComposition,
  groupMarketPositions,
  lpBandPrices,
  lpDeadline,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  permit2ApprovalArgs,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
  prepareAddLiquidity,
  prepareCollectLpFees,
  prepareCollectMarketFees,
  prepareMarketLiquidity,
  prepareRemoveLiquidity,
  readLpPositionFees,
  readPoolLpPositions,
  readUserLpPositions,
  refreshUserLpPosition,
  reverifyAddLiquidity,
  reverifyMarketLiquidity,
  type AddLiquidityPlan,
  type MarketLiquidityPlan,
  type MarketSides,
  type PoolComposition,
  type PoolSnapshot,
  type PositionGroup,
  type UserLpPosition,
} from "./lib";
import { LiquidityRangePreview } from "./LiquidityRangePreview";
import {
  approvalStepsFor,
  runApprovalStep,
  SummaryRow,
  type LiquidityStep,
} from "./liquidityWrite";
import { MarketEditPanel } from "./MarketEditPanel";

/** A plan's band on the display axis, "min – max PAIR/TOKEN". */
function bandLabel(
  pool: PoolSnapshot,
  tokenSymbol: string,
  plan: { tickLower: number; tickUpper: number },
): string {
  const band = lpBandPrices(pool, plan.tickLower, plan.tickUpper);
  return `${formatPrice(band.minimumPrice)} – ${formatPrice(band.maximumPrice)} ${pool.pair.symbol}/${tokenSymbol}`;
}

function formatPrice(price: number): string {
  if (!isFinite(price) || price <= 0) return "—";
  if (price < 0.0001) return price.toExponential(2);
  return Intl.NumberFormat("en", { maximumFractionDigits: price >= 1 ? 4 : 8 }).format(price);
}

function MarketChainRow({
  state,
  tokenSymbol,
  pending = false,
}: {
  state: AmmChainState;
  tokenSymbol: string;
  /** Restored from a previous read and still confirming. */
  pending?: boolean;
}) {
  const { pool } = state;
  const explorer = pool ? explorerAddressUrl(state.chainId, pool.poolManager) : null;
  const inverse = pool?.price ? 1 / pool.price : null;
  const { issuance, cashOut } = state.reference;
  return (
    <div className="border-b border-zinc-50 py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
        <ChainLogo chainId={state.chainId} width={16} height={16} />
        {chainName(state.chainId)}
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-normal text-zinc-400 underline decoration-dotted hover:text-zinc-600"
          >
            PoolManager ↗
          </a>
        ) : null}
      </div>
      {!state.hook ? (
        <p className="text-sm text-zinc-400 mt-1">No buyback hook configured on this chain.</p>
      ) : !pool ? (
        <p className="text-sm text-zinc-400 mt-1">
          Buyback hook configured, but its pool is not initialized yet.
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg font-medium text-zinc-900">
            1 {tokenSymbol} = {formatPrice(pool.price ?? 0)} {pool.pair.symbol}
          </p>
          <p className="text-sm text-zinc-500">
            1 {pool.pair.symbol} = {inverse ? formatPrice(inverse) : "—"} {tokenSymbol}
          </p>
          {issuance || cashOut ? (
            <dl className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3 text-sm">
              {issuance ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-zinc-500">Current issuance price</dt>
                  <dd className="font-medium text-zinc-900">
                    <Revalidating pending={pending}>
                      {formatPrice(issuance)} {pool.pair.symbol}
                    </Revalidating>
                  </dd>
                </div>
              ) : null}
              {cashOut ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-zinc-500">Current cash out price</dt>
                  <dd className="font-medium text-zinc-900">
                    <Revalidating pending={pending}>
                      {formatPrice(cashOut)} {pool.pair.symbol}
                    </Revalidating>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <p className="mt-3 text-xs text-zinc-400">
            Uniswap V4 pool, {pool.key.fee / 10_000}% fee.
          </p>
        </>
      )}
    </div>
  );
}

const DEPTH_WIDTH = 320;
const DEPTH_BANDS = 48;

/** Inverse of {@link tickPrice}: the raw tick at a pair/token price. */
function priceTick(pool: PoolSnapshot, price: number): number {
  const decimalScale = 10 ** (18 - pool.pair.decimals);
  const rawPrice = pool.pairIsC0 ? decimalScale / price : price / decimalScale;
  return Math.log(rawPrice) / Math.log(1.0001);
}

function tickPrice(pool: PoolSnapshot, tick: number): number {
  const decimalScale = 10 ** (18 - pool.pair.decimals);
  const rawPrice = 1.0001 ** tick;
  return (pool.pairIsC0 ? 1 / rawPrice : rawPrice) * decimalScale;
}

/**
 * Who supplies this pool: the owner breakdown's own pie and table, sized by the
 * pair-token value of each provider's positions, so the two read as one family.
 * The positions come from the index where it has them and the onchain scan
 * otherwise, which is why this can render before the depth chart resolves.
 */
function LiquidityProviders({ pool, tokenSymbol }: { pool: PoolSnapshot; tokenSymbol: string }) {
  const positions = useQuery({
    queryKey: ["revnetPoolLpProviders", pool.chainId, pool.poolId],
    retry: 0,
    staleTime: 60_000,
    queryFn: () => readPoolLpPositions(pool),
  });

  const owners = useMemo(() => {
    const byOwner = new Map<
      string,
      { address: Address; pair: bigint; token: bigint; positions: number; value: number }
    >();
    for (const position of positions.data ?? []) {
      const key = position.owner.toLowerCase();
      const current = byOwner.get(key) ?? {
        address: position.owner,
        pair: 0n,
        token: 0n,
        positions: 0,
        value: 0,
      };
      current.pair += position.pairAmount;
      current.token += position.tokenAmount;
      current.positions += 1;
      current.value =
        Number(formatUnits(current.pair, pool.pair.decimals)) +
        (pool.price ?? 0) * Number(formatUnits(current.token, 18));
      byOwner.set(key, current);
    }
    return [...byOwner.values()].sort((a, b) => b.value - a.value);
  }, [positions.data, pool]);

  if (positions.isLoading) {
    return <p className="mt-2 text-sm text-zinc-400">Reading liquidity providers…</p>;
  }
  if (!owners.length) return null;

  const total = owners.reduce((sum, owner) => sum + owner.value, 0);
  // The pie is the owner chart's, fed the providers' pair-token value as its
  // balance so the slices are sized the same way.
  const participants = owners.map((owner) => ({
    address: owner.address,
    balance: owner.pair.toString(),
    volume: "0",
    chains: [Number(pool.chainId)],
  }));
  const totalPair = owners.reduce((sum, owner) => sum + owner.pair, 0n);

  return (
    <div className="mb-6 @container">
      <div className="grid items-start gap-8 @2xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div className="min-w-0">
          <ParticipantsPieChart
            participants={participants}
            totalSupply={totalPair}
            token={null}
            showOwnerCount
          />
        </div>
        <div className="w-full min-w-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">{pool.pair.symbol}</TableHead>
                <TableHead className="text-right">{tokenSymbol}</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((owner) => (
                <TableRow key={owner.address}>
                  <TableCell>
                    <EthereumAddress address={owner.address} short withEnsAvatar withEnsName />
                    {owner.positions > 1 ? (
                      <span className="block text-xs text-zinc-500">
                        {owner.positions} positions
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUnits(owner.pair, pool.pair.decimals)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUnits(owner.token, 18)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {total > 0 ? `${((owner.value / total) * 100).toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function LiquidityVisualization({
  pool,
  composition,
  tokenSymbol,
}: {
  pool: PoolSnapshot;
  composition: PoolComposition;
  tokenSymbol: string;
}) {
  const model = useMemo(() => {
    const pairAmount = Number(formatUnits(composition.pairAmount, pool.pair.decimals));
    const tokenAmount = Number(formatUnits(composition.tokenAmount, 18));
    const tokenValue = pool.price == null ? 0 : tokenAmount * pool.price;
    const totalValue = pairAmount + tokenValue;
    const pairPercent = totalValue > 0 ? (pairAmount / totalValue) * 100 : 0;
    const tokenPercent = totalValue > 0 ? (tokenValue / totalValue) * 100 : 0;

    const ranges = composition.ranges
      .map((range) => {
        const a = tickPrice(pool, range.tickLower);
        const b = tickPrice(pool, range.tickUpper);
        return {
          tickLower: range.tickLower,
          tickUpper: range.tickUpper,
          liquidityRaw: range.liquidity,
          low: Math.min(a, b),
          high: Math.max(a, b),
          liquidity: Number(range.liquidity),
        };
      })
      .filter(
        (range) =>
          range.low > 0 &&
          range.high > range.low &&
          Number.isFinite(range.low) &&
          Number.isFinite(range.high) &&
          Number.isFinite(range.liquidity),
      );

    if (ranges.length === 0 || pool.price == null || pool.price <= 0) {
      return { pairAmount, tokenAmount, pairPercent, tokenPercent, depth: null };
    }

    const low = Math.min(...ranges.map((range) => range.low), pool.price);
    const high = Math.max(...ranges.map((range) => range.high), pool.price);
    if (!(high > low)) {
      return { pairAmount, tokenAmount, pairPercent, tokenPercent, depth: null };
    }

    const logLow = Math.log(low);
    const logHigh = Math.log(high);
    const span = logHigh - logLow;
    const bands = Array.from({ length: DEPTH_BANDS }, (_, index) => {
      const mid = Math.exp(logLow + ((index + 0.5) / DEPTH_BANDS) * span);
      const bandLow = Math.exp(logLow + (index / DEPTH_BANDS) * span);
      const bandHigh = Math.exp(logLow + ((index + 1) / DEPTH_BANDS) * span);
      // Pair/token price falls with tick when the pair is currency0 and rises
      // when it is currency1, so normalize both orientations before
      // intersecting a band with a position's range.
      const bandTicks = [priceTick(pool, bandLow), priceTick(pool, bandHigh)];
      const bandTickLow = Math.min(...bandTicks);
      const bandTickHigh = Math.max(...bandTicks);

      let liquidity = 0;
      let pair = 0n;
      let token = 0n;
      for (const range of ranges) {
        if (mid >= range.low && mid <= range.high) liquidity += range.liquidity;
        const overlapLow = Math.max(bandTickLow, range.tickLower);
        const overlapHigh = Math.min(bandTickHigh, range.tickUpper);
        if (overlapLow >= overlapHigh) continue;
        const amounts = uniswapV4AmountsForLiquidity(
          pool.sqrtP,
          uniswapV4SqrtPriceX96AtTick(Math.round(overlapLow)),
          uniswapV4SqrtPriceX96AtTick(Math.round(overlapHigh)),
          range.liquidityRaw,
        );
        pair += pool.pairIsC0 ? amounts.amount0 : amounts.amount1;
        token += pool.pairIsC0 ? amounts.amount1 : amounts.amount0;
      }
      return { mid, liquidity, pair, token };
    });
    const maxLiquidity = Math.max(...bands.map((band) => band.liquidity), 1);
    const priceX = ((Math.log(pool.price) - logLow) / span) * DEPTH_WIDTH;

    return {
      pairAmount,
      tokenAmount,
      pairPercent,
      tokenPercent,
      depth: { bands, maxLiquidity, low, high, priceX },
    };
  }, [composition, pool]);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // With nothing hovered, report the band holding the current price.
  const priceIndex = useMemo(() => {
    const bands = model.depth?.bands;
    if (!bands?.length || pool.price == null) return null;
    let nearest = 0;
    bands.forEach((band, index) => {
      if (Math.abs(band.mid - pool.price!) < Math.abs(bands[nearest].mid - pool.price!)) {
        nearest = index;
      }
    });
    return nearest;
  }, [model.depth, pool.price]);
  const shownIndex = hoverIndex ?? priceIndex;
  const shownBand = shownIndex == null ? null : (model.depth?.bands[shownIndex] ?? null);

  return (
    <div className="mt-3 space-y-5">
      <div>
        <div className="text-xs text-zinc-500">Composition</div>
        {model.pairPercent + model.tokenPercent > 0 ? (
          <>
            <div
              className="mt-2 flex h-3 w-full overflow-hidden bg-teal-100"
              aria-label={`${pool.pair.symbol} ${model.pairPercent.toFixed(1)}%, ${tokenSymbol} ${model.tokenPercent.toFixed(1)}%`}
            >
              <div className="bg-teal-400" style={{ width: `${model.pairPercent}%` }} />
              <div className="bg-amber-400" style={{ width: `${model.tokenPercent}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-teal-400" aria-hidden="true" />
                {pool.pair.symbol} {fmtUnits(composition.pairAmount, pool.pair.decimals)} (
                {model.pairPercent.toFixed(1)}%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-amber-400" aria-hidden="true" />
                {tokenSymbol} {fmtUnits(composition.tokenAmount, 18)} (
                {model.tokenPercent.toFixed(1)}%)
              </span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-zinc-400">The pool has no active reserves.</p>
        )}
      </div>

      {model.depth ? (
        <div>
          <div className="text-xs text-zinc-500">Depth</div>
          <svg
            viewBox={`0 0 ${DEPTH_WIDTH} 128`}
            className="mt-2 h-auto w-full cursor-crosshair touch-none"
            role="img"
            aria-label={`${tokenSymbol} liquidity depth from ${formatPrice(model.depth.low)} to ${formatPrice(model.depth.high)} ${pool.pair.symbol}`}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * DEPTH_WIDTH;
              const index = Math.floor(x / (DEPTH_WIDTH / DEPTH_BANDS));
              setHoverIndex(index >= 0 && index < DEPTH_BANDS ? index : null);
            }}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {model.depth.bands.map((band, index) => {
              if (band.liquidity <= 0) return null;
              const width = DEPTH_WIDTH / DEPTH_BANDS;
              const height = (band.liquidity / model.depth!.maxLiquidity) * 78;
              return (
                <rect
                  key={index}
                  x={(index * width).toFixed(1)}
                  y={(98 - height).toFixed(1)}
                  width={Math.max(0.5, width - 0.6).toFixed(1)}
                  height={height.toFixed(1)}
                  fill={band.mid < pool.price! ? "#99f6e4" : "#fcd34d"}
                  opacity={index === shownIndex ? 0.95 : 0.6}
                />
              );
            })}
            <line x1="1" y1="20" x2="1" y2="98" stroke="#71717a" strokeDasharray="3 2" />
            <line
              x1={model.depth.priceX.toFixed(1)}
              y1="20"
              x2={model.depth.priceX.toFixed(1)}
              y2="98"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
            <line x1="319" y1="20" x2="319" y2="98" stroke="#14b8a6" strokeDasharray="3 2" />
            <text x="1" y="13" fontSize="8" fill="#71717a">
              floor
            </text>
            {/* ponytail: measured at 8px in the page font, "floor" and the
                centered "price" are 24.3 wide and "ceiling" 34.1 — so the
                centered label collides with an end label outside this band.
                Drop it there rather than print over them: the amber line still
                marks the price and the readout below the chart names it. */}
            {model.depth.priceX > 42 && model.depth.priceX < DEPTH_WIDTH - 52 ? (
              <text
                x={model.depth.priceX.toFixed(1)}
                y="13"
                fontSize="8"
                fill="#71717a"
                textAnchor="middle"
              >
                price
              </text>
            ) : null}
            <text x="319" y="13" fontSize="8" fill="#71717a" textAnchor="end">
              ceiling
            </text>
            <text x="1" y="119" fontSize="8" fill="#71717a">
              {formatPrice(model.depth.low)}
            </text>
            <text x="319" y="119" fontSize="8" fill="#71717a" textAnchor="end">
              {formatPrice(model.depth.high)}
            </text>
          </svg>
          <p className="mt-1 text-xs text-zinc-600" aria-live="polite">
            {shownBand ? (
              <>
                <span className="font-medium text-zinc-900">
                  ~{formatPrice(shownBand.mid)} {pool.pair.symbol}/{tokenSymbol}
                </span>{" "}
                | {shownBand.mid < pool.price! ? "buy-side" : "sell-side"} —{" "}
                {fmtUnits(shownBand.token, 18)} {tokenSymbol} +{" "}
                {fmtUnits(shownBand.pair, pool.pair.decimals)} {pool.pair.symbol}
              </>
            ) : (
              <>
                ~{formatPrice(pool.price!)} {pool.pair.symbol}/{tokenSymbol}
              </>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function LiquidityChainRow({ state, tokenSymbol }: { state: AmmChainState; tokenSymbol: string }) {
  const { pool } = state;
  const compositionQuery = useQuery({
    queryKey: ["v6PoolComposition", state.chainId, pool?.poolId],
    enabled: !!pool,
    staleTime: 60_000,
    queryFn: () => fetchPoolComposition(pool!),
  });
  const composition = compositionQuery.data ?? null;
  return (
    <div className="border-b border-zinc-50 py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
        <ChainLogo chainId={state.chainId} width={16} height={16} />
        {chainName(state.chainId)}
      </div>
      {!state.hook ? (
        <p className="mt-1 text-sm text-zinc-400">No buyback hook configured on this chain.</p>
      ) : !pool ? (
        <p className="mt-1 text-sm text-zinc-400">This pool is not initialized yet.</p>
      ) : (
        <>
          {/* The provider table has its own (fast) source; only the depth
              bands wait on the composition. */}
          <LiquidityProviders pool={pool} tokenSymbol={tokenSymbol} />
          {compositionQuery.isLoading ? (
            <SkeletonLines lines={3} className="mt-2" />
          ) : composition == null ? (
            <p className="mt-2 text-sm text-zinc-400">
              The RPC could not return the complete pool history, so liquidity is unavailable.
            </p>
          ) : (
            <LiquidityVisualization
              pool={pool}
              composition={composition}
              tokenSymbol={tokenSymbol}
            />
          )}
        </>
      )}
    </div>
  );
}

// Viem stuffs the whole request envelope into `message`; `shortMessage` is the
// one sentence a reader can act on.
function txMessage(cause: unknown, fallback: string): string {
  const error = cause as { shortMessage?: string; message?: string } | null;
  return error?.shortMessage || error?.message || fallback;
}

/** What a review froze: one position, or the two sides of a market. */
type ReviewedPlan =
  { kind: "single"; plan: AddLiquidityPlan } | { kind: "market"; plan: MarketLiquidityPlan };

export function AddLiquidityForm({
  state,
  tokenSymbol,
}: {
  state: AmmChainState;
  tokenSymbol: string;
}) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = Number(state.chainId);
  const publicClient = usePublicClient({ chainId });
  const { ensureAllowance, isApproving } = useAllowance(chainId);
  const { writeContractAsync, isPending } = useWriteContract();
  // Revnets have a corridor to make a market in; anything without both edges
  // falls back to the solved single band.
  const [mode, setMode] = useState<LiquidityFormMode>(
    state.reference.cashOut && state.reference.issuance ? "market" : "amounts",
  );
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [pairText, setPairText] = useState("");
  const [tokenText, setTokenText] = useState("");
  const [driver, setDriver] = useState<LiquidityFormSide>("token");
  const [reviewed, setReviewed] = useState<{
    reviewed: ReviewedPlan;
    steps: LiquidityStep[];
    snapshot: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [minted, setMinted] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const pool = state.pool;

  // Seed the range-mode inputs once from the economic corridor (cash-out
  // floor → issuance ceiling) rather than an arbitrary band; never clobber a
  // range the user already touched.
  useEffect(() => {
    const price = pool?.price;
    if (!price || price <= 0) return;
    setMinText((current) => {
      if (current !== "") return current;
      const seeded = uniswapV4DefaultPriceRange(
        price,
        state.reference.cashOut ?? 0,
        state.reference.issuance ?? 0,
      );
      setMaxText((max) => (max === "" ? String(Number(seeded.max.toPrecision(6))) : max));
      return String(Number(seeded.min.toPrecision(6)));
    });
  }, [pool?.poolId, pool?.price, state.reference.cashOut, state.reference.issuance]);

  const tokenBalance = useQuery({
    queryKey: ["v6LpTokenBalance", chainId, pool?.projectToken, address],
    enabled: !!address && !!pool && !!publicClient,
    queryFn: () =>
      publicClient!.readContract({
        address: pool!.projectToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address!],
      }),
  });

  if (!pool || !POSITION_MANAGER_BY_CHAIN[chainId]) return null;

  const view = liquidityFormView({
    mode,
    tokenText,
    pairText,
    minText,
    maxText,
    driver,
    price: pool.price ?? 0,
    reference: state.reference,
    tokenSymbol,
    pairSymbol: pool.pair.symbol,
  });

  const snapshot = [mode, minText, maxText, pairText, tokenText, driver].join("|");
  const review = reviewed?.snapshot === snapshot ? reviewed.reviewed : null;
  const reviewSteps = reviewed?.snapshot === snapshot ? reviewed.steps : [];

  // Typed amounts submit from their exact text; derived ones from the solved
  // float (their on-chain amounts are recomputed from liquidity anyway).
  const sideUnits = (side: LiquidityFormSide): bigint => {
    const decimals = side === "token" ? 18 : pool.pair.decimals;
    const amount = side === "token" ? view.tokenAmount : view.pairAmount;
    if (amount == null || amount <= 0) return 0n;
    const text = (side === "token" ? tokenText : pairText).trim();
    const typed = mode === "amounts" || view.derived !== side;
    return typed && text
      ? parseUnits(text, decimals)
      : parseUnits(amount.toFixed(decimals), decimals);
  };

  const amountsText = (token: bigint, pair: bigint) =>
    [
      token > 0n ? `${fmtUnits(token, 18)} ${tokenSymbol}` : null,
      pair > 0n ? `${fmtUnits(pair, pool.pair.decimals)} ${pool.pair.symbol}` : null,
    ]
      .filter(Boolean)
      .join(" + ");

  // The derived side displays its computed counterpart; everything else shows
  // what the user typed.
  const amountValue = (side: LiquidityFormSide): string => {
    if (mode !== "amounts" && view.disabled[side]) return "";
    if (mode !== "amounts" && view.derived === side) {
      const amount = side === "token" ? view.tokenAmount : view.pairAmount;
      return amount == null ? "" : String(Number(amount.toPrecision(6)));
    }
    return side === "token" ? tokenText : pairText;
  };

  const prepare = async () => {
    if (!address || !publicClient) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!view.ready || view.minPrice == null || view.maxPrice == null) {
      setStatus(view.note ?? "Finish the amounts first.");
      return;
    }
    setBusy(true);
    setStepIndex(0);
    setMinted(null);
    setStatus("Reading fresh pool and wallet balances…");
    try {
      const amounts = { pairAmount: sideUnits("pair"), tokenAmount: sideUnits("token") };
      const built: ReviewedPlan =
        mode === "market"
          ? {
              kind: "market",
              plan: prepareMarketLiquidity(
                pool,
                amounts,
                { floor: view.minPrice, ceiling: view.maxPrice },
                address,
              ),
            }
          : {
              kind: "single",
              plan: prepareAddLiquidity(
                pool,
                amounts,
                { minimumPrice: view.minPrice, maximumPrice: view.maxPrice },
                address,
              ),
            };
      const plan = built.plan;
      const [tokenBalance, pairBalance] = await Promise.all([
        publicClient.readContract({
          address: pool.projectToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        pool.pair.addr === zeroAddress
          ? publicClient.getBalance({ address })
          : publicClient.readContract({
              address: pool.pair.addr,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            }),
      ]);
      // Gate on what the pool actually pulls, not on the plan's maxima: those
      // carry 1% price headroom that only gets spent if the price moves, so
      // blocking on them rejects an entry that comfortably fits.
      const enteredToken = sideUnits("token");
      const enteredPair = sideUnits("pair");
      if (enteredToken > tokenBalance) {
        throw new Error(`That's more ${tokenSymbol} than your balance.`);
      }
      if (enteredPair > pairBalance) {
        throw new Error(`That's more ${pool.pair.symbol} than your balance.`);
      }
      const symbolOf = (currency: Address) =>
        currency.toLowerCase() === pool.projectToken.toLowerCase() ? tokenSymbol : pool.pair.symbol;
      const approvals = await approvalStepsFor({
        publicClient: publicClient as PublicClient,
        chainId: state.chainId,
        address,
        erc20Sides: plan.erc20Sides,
        symbolOf,
      });
      setReviewed({
        reviewed: built,
        steps: [
          ...approvals,
          built.kind === "market"
            ? {
                title: "Mint the market",
                detail: "Two positions, one on each side of the current price.",
              }
            : {
                title: "Mint the position",
                detail: "Deposits both sides into your chosen price range.",
              },
        ],
        snapshot,
      });
      // The headroom is still worth naming when it outruns the balance — the
      // mint reverts if the price moves against the position before it lands.
      const tight = [
        plan.tokenMaximum > tokenBalance ? tokenSymbol : null,
        plan.pairMaximum > pairBalance ? pool.pair.symbol : null,
      ].filter((symbol): symbol is string => symbol != null);
      setStatus(
        tight.length
          ? `Heads up: your ${tight.join(" and ")} balance does not cover the 1% price headroom, ` +
              `so this mint reverts if the price moves against it. Lower the amount to be safe.`
          : null,
      );
    } catch (cause) {
      setReviewed(null);
      setStatus(txMessage(cause, "Could not prepare liquidity."));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!address || !publicClient || !reviewed || reviewed.snapshot !== snapshot) return;
    const { reviewed: built, steps } = reviewed;
    const plan = built.plan;
    setBusy(true);
    setStatus(null);
    try {
      // ponytail: Safe app only; other EIP-5792 wallets keep the sequential path.
      if (isSafeConnection(wagmiConfig) && steps.length > 1) {
        if (built.kind === "market") await reverifyMarketLiquidity(pool, built.plan);
        else await reverifyAddLiquidity(pool, built.plan);
        const calls = steps.map((step) =>
          step.approval?.kind === "erc20"
            ? {
                address: step.approval.currency,
                abi: erc20Abi,
                functionName: "approve",
                args: [PERMIT2_ADDRESS, step.approval.max],
              }
            : step.approval
              ? {
                  address: PERMIT2_ADDRESS,
                  abi: PERMIT2_ABI,
                  functionName: "approve",
                  args: permit2ApprovalArgs(
                    state.chainId,
                    step.approval.currency,
                    step.approval.max,
                  ),
                }
              : {
                  address: POSITION_MANAGER_BY_CHAIN[chainId]!,
                  abi: POSITION_MANAGER_ABI,
                  functionName: "modifyLiquidities",
                  args: [plan.unlockData, lpDeadline(true)],
                  value: plan.value,
                  dependsOnPrior: true,
                },
        );
        await proposeSafeBatch(
          wagmiConfig,
          chainId,
          built.kind === "market" ? "Make the market" : "Add liquidity",
          calls,
        );
        setStatus(
          "Proposed to Safe as one batch. Once its signers approve and it executes, the position shows under Your liquidity.",
        );
        setReviewed(null);
        return;
      }
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
              "Permit2 authorization was proposed to Safe. Execute it, then review liquidity again.",
            );
            setReviewed(null);
            return;
          }
          continue;
        }
        if (built.kind === "market") await reverifyMarketLiquidity(pool, built.plan);
        else await reverifyAddLiquidity(pool, built.plan);
        const hash = await writeContractAsync({
          chainId,
          address: POSITION_MANAGER_BY_CHAIN[chainId]!,
          abi: POSITION_MANAGER_ABI,
          functionName: "modifyLiquidities",
          args: [plan.unlockData, lpDeadline(isSafeConnection(wagmiConfig))],
          value: plan.value,
        });
        if (submittedViaSafe(hash)) {
          setStatus("Liquidity mint was proposed to Safe and awaits approvals and execution.");
          setReviewed(null);
          return;
        }
        const receipt = await waitForReceiptWithRetry(publicClient, hash);
        if (receipt.status !== "success") throw new Error(`Liquidity mint ${hash} reverted.`);
        setStepIndex(steps.length);
        setMinted(hash);
      }
      setReviewed(null);
      setPairText("");
      setTokenText("");
      // The position list below this form is a sibling query: without this it
      // keeps claiming the wallet owns nothing right after a successful mint.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["revnetWalletLpPositions"] }),
        queryClient.invalidateQueries({ queryKey: ["revnetPoolLpProviders"] }),
      ]);
    } catch (cause) {
      setStatus(txMessage(cause, "Could not add liquidity."));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || isApproving || isPending;
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-zinc-600">Add liquidity</div>
        <span className="text-[11px] text-zinc-400">
          Current ~{pool.price?.toPrecision(6) ?? "—"} {pool.pair.symbol}/{tokenSymbol}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
        {(
          [
            ["market", "Make the market"],
            ["amounts", "By amounts"],
            ["range", "By price range"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={
              mode === id
                ? "bg-zinc-900 px-2 py-1 text-white"
                : "border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
            }
            disabled={disabled}
            onClick={() => {
              if (mode === id) return;
              if (id === "amounts") {
                // Materialize the derived amount so it stays editable text.
                if (view.derived === "pair" && view.pairAmount != null) {
                  setPairText(String(Number(view.pairAmount.toPrecision(6))));
                } else if (view.derived === "token" && view.tokenAmount != null) {
                  setTokenText(String(Number(view.tokenAmount.toPrecision(6))));
                }
              }
              if (id === "range") {
                // Carry the solved band over so fine-tuning starts from it; the
                // market's corridor is no single band, so re-seed the economic
                // corridor instead.
                if (mode === "market") {
                  if (pool.price && pool.price > 0) {
                    const seeded = uniswapV4DefaultPriceRange(
                      pool.price,
                      state.reference.cashOut ?? 0,
                      state.reference.issuance ?? 0,
                    );
                    setMinText(String(Number(seeded.min.toPrecision(6))));
                    setMaxText(String(Number(seeded.max.toPrecision(6))));
                  }
                } else if (view.minPrice != null && view.maxPrice != null) {
                  setMinText(String(Number(view.minPrice.toPrecision(6))));
                  setMaxText(String(Number(view.maxPrice.toPrecision(6))));
                }
              }
              setMode(id);
              setReviewed(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <LiquidityRangePreview
        floor={state.reference.cashOut}
        ceiling={state.reference.issuance}
        current={pool.price}
        minimum={view.minPrice ?? 0}
        maximum={view.maxPrice ?? 0}
        pairSymbol={pool.pair.symbol}
        tokenSymbol={tokenSymbol}
        onRangeChange={
          mode === "range" && !disabled
            ? (edge, value) => {
                (edge === "minimum" ? setMinText : setMaxText)(String(value));
                setReviewed(null);
              }
            : undefined
        }
      />
      {mode === "range" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-500">
            Min price
            <input
              className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
              type="number"
              min="0"
              value={minText}
              disabled={disabled}
              onChange={(event) => {
                setMinText(event.target.value);
                setReviewed(null);
              }}
            />
          </label>
          <label className="text-[11px] text-zinc-500">
            Max price
            <input
              className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
              type="number"
              min="0"
              value={maxText}
              disabled={disabled}
              onChange={(event) => {
                setMaxText(event.target.value);
                setReviewed(null);
              }}
            />
          </label>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">
          <span className="flex items-center justify-between">
            {mode === "market" ? `${tokenSymbol} to sell above the price` : tokenSymbol}
            {mode !== "amounts" && view.derived === "token" ? (
              <span className="text-zinc-400">≈ auto</span>
            ) : null}
          </span>
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={amountValue("token")}
            disabled={disabled || (mode !== "amounts" && view.disabled.token)}
            onChange={(event) => {
              setTokenText(event.target.value);
              setDriver("token");
              setReviewed(null);
            }}
          />
          {tokenBalance.data != null ? (
            <span className="mt-1 block text-right text-zinc-400">
              {fmtUnits(tokenBalance.data, 18)} {tokenSymbol} in wallet
            </span>
          ) : null}
        </label>
        <label className="text-[11px] text-zinc-500">
          <span className="flex items-center justify-between">
            {mode === "market"
              ? `${pool.pair.symbol} to buy with below the price`
              : pool.pair.symbol}
            {mode !== "amounts" && view.derived === "pair" ? (
              <span className="text-zinc-400">≈ auto</span>
            ) : null}
          </span>
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={amountValue("pair")}
            disabled={disabled || (mode !== "amounts" && view.disabled.pair)}
            onChange={(event) => {
              setPairText(event.target.value);
              setDriver("pair");
              setReviewed(null);
            }}
          />
        </label>
      </div>
      {view.summary ? <p className="mt-2 text-xs text-zinc-600">{view.summary}</p> : null}
      {view.note ? <p className="mt-1 text-[11px] text-zinc-500">{view.note}</p> : null}
      <div className="mt-3 flex justify-end">
        <ButtonWithWallet
          targetChainId={state.chainId}
          loading={disabled}
          disabled={disabled || !view.ready}
          onClick={() => void prepare()}
          connectWalletText="Connect Wallet"
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          {mode === "market" ? "Make the market" : "Add liquidity"}
        </ButtonWithWallet>
      </div>
      {review || (busy && !review) ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewed(null);
          }}
          title={mode === "market" ? "Confirm market" : "Confirm liquidity"}
          chainId={state.chainId}
          preparing={!review}
          steps={reviewSteps}
          activeIndex={busy ? stepIndex : -1}
          stepsIntro={
            isSafeConnection(wagmiConfig) && reviewSteps.length > 1
              ? `Goes to your Safe as one batch of ${reviewSteps.length} calls: approved once, executed together.`
              : undefined
          }
          action={mode === "market" ? "Make the market" : "Add liquidity"}
          onConfirm={() => void execute()}
          busy={disabled}
          status={status}
        >
          {!review ? null : review.kind === "market" ? (
            <>
              {review.plan.tokenSide ? (
                <SummaryRow label="Sells above the price">
                  {amountsText(sideUnits("token"), 0n)}
                  <span className="block text-xs text-zinc-500">
                    {bandLabel(pool, tokenSymbol, review.plan.tokenSide)}
                  </span>
                </SummaryRow>
              ) : null}
              {review.plan.pairSide ? (
                <SummaryRow label="Buys below the price">
                  {amountsText(0n, sideUnits("pair"))}
                  <span className="block text-xs text-zinc-500">
                    {bandLabel(pool, tokenSymbol, review.plan.pairSide)}
                  </span>
                </SummaryRow>
              ) : null}
            </>
          ) : (
            <SummaryRow label="Adds">
              {amountsText(sideUnits("token"), sideUnits("pair"))}
              <span className="block text-xs text-zinc-500">
                {bandLabel(pool, tokenSymbol, review.plan)}
              </span>
            </SummaryRow>
          )}
          {review ? (
            <>
              <SummaryRow label="On">{chainName(state.chainId)}</SummaryRow>
              <SummaryRow label="Authorizes up to">
                {amountsText(review.plan.tokenMaximum, review.plan.pairMaximum)}
                <span className="block text-xs text-zinc-500">
                  1% price headroom, spent only if the price moves before the mint lands
                  {pool.pair.addr === zeroAddress ? `. Unused ${pool.pair.symbol} is refunded` : ""}
                </span>
              </SummaryRow>
            </>
          ) : null}
        </TxConfirmDialog>
      ) : null}
      {minted ? (
        <div className="mt-2 border border-teal-300 bg-teal-50 p-2 text-xs" role="status">
          <p className="font-medium text-teal-800">Liquidity added.</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            The position is yours and now earns fees. It is listed under &ldquo;Your
            liquidity&rdquo; below.
          </p>
          {explorerBaseUrl(chainId) ? (
            <ExternalLink
              className="mt-1 inline-block text-[11px] underline"
              href={`${explorerBaseUrl(chainId)}/tx/${minted}`}
            >
              View the transaction
            </ExternalLink>
          ) : null}
        </div>
      ) : null}
      {status && !review ? (
        <p className="mt-2 wrap-anywhere text-xs text-zinc-500" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Every LP position the connected wallet holds across the project's chains, in
 * one table (the same hierarchy juicescan and juicebox.money use): Chain |
 * Position | Holdings | Unclaimed fees | Lifetime fees | actions. Each chain
 * contributes its own row group so one slow or failing RPC never blanks the
 * others; the aggregate "no positions" note only appears once every chain has
 * reported an empty scan.
 */
export function LiquidityManager({
  states,
  tokenSymbol,
  heading = "Your liquidity",
}: {
  states: AmmChainState[];
  tokenSymbol: string;
  /** Section heading; null when a dialog title already names the view. */
  heading?: string | null;
}) {
  const { address } = useAccount();
  const pooled = states.filter(
    (state) => state.pool && POSITION_MANAGER_BY_CHAIN[Number(state.chainId)],
  );
  // Per-chain scan outcomes reported up by the row groups, so the aggregate
  // empty state is knowable without lifting each chain's queries out of them.
  const [scan, setScan] = useState<Record<number, number | "loading" | "error">>({});
  // The edit/remove panels portal here, BELOW the scroll wrapper — inside the
  // table they'd inherit its full scrollable width and get cut off.
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const onStatus = useCallback((chainId: number, status: number | "loading" | "error") => {
    setScan((current) =>
      current[chainId] === status ? current : { ...current, [chainId]: status },
    );
  }, []);

  if (!pooled.length) return null;
  const allEmpty = pooled.length > 0 && pooled.every((state) => scan[Number(state.chainId)] === 0);

  return (
    // min-w-0: as a grid item of the dialog panel this must be allowed to
    // shrink, or the table's intrinsic width inflates the whole dialog.
    <div className={heading ? "mt-3 min-w-0 border-t border-zinc-100 pt-3" : "min-w-0"}>
      {heading ? <div className="text-xs font-medium text-zinc-600">{heading}</div> : null}
      {!address ? (
        <p className="mt-1 text-xs text-zinc-400">Connect a wallet to manage its LP positions.</p>
      ) : (
        <>
          {allEmpty ? (
            <p className="mt-1 text-xs text-zinc-400">
              No positions owned by this wallet on any chain.
            </p>
          ) : null}
          {/* Hidden rather than unmounted while empty so the per-chain queries
              keep watching for a position minted from the form above. */}
          <div className={allEmpty ? "hidden" : "mt-2 w-full min-w-0 overflow-auto"}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chain</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead className="text-right">Holdings</TableHead>
                  <TableHead className="text-right">Unclaimed fees</TableHead>
                  <TableHead className="text-right">Lifetime fees</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pooled.map((state) => (
                  <ChainPositionRows
                    key={state.chainId}
                    state={state}
                    tokenSymbol={tokenSymbol}
                    onStatus={onStatus}
                    panelHost={panelHost}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <div ref={setPanelHost} className="min-w-0" />
        </>
      )}
    </div>
  );
}

/**
 * One chain's row group in the spanning positions table: the wallet's
 * positions in that chain's pool, each with claim/move/remove. The move and
 * remove flows render as full-width panel rows anchored under their position.
 */
function ChainPositionRows({
  state,
  tokenSymbol,
  onStatus,
  panelHost,
}: {
  state: AmmChainState;
  tokenSymbol: string;
  onStatus: (chainId: number, status: number | "loading" | "error") => void;
  /** Where the edit/remove panels render, below the table's scroll wrapper. */
  panelHost: HTMLDivElement | null;
}) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = Number(state.chainId);
  const pool = state.pool;
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  const [reviewed, setReviewed] = useState<{
    position: UserLpPosition;
    plan: ReturnType<typeof prepareRemoveLiquidity>;
  } | null>(null);
  // The position whose holdings/band are being edited in the panel below, or
  // the market (two sides) being edited or removed.
  const [editing, setEditing] = useState<UserLpPosition | null>(null);
  const [editingMarket, setEditingMarket] = useState<{
    sides: MarketSides;
    startEmpty: boolean;
  } | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<bigint | null>(null);
  const [claiming, setClaiming] = useState<bigint | null>(null);
  const [claimReview, setClaimReview] = useState<UserLpPosition[] | null>(null);
  const client = usePublicClient({ chainId }) as PublicClient | undefined;
  const {
    writeContractAsync,
    data: hash,
    isPending,
  } = useWriteContract({
    transactionReview: {
      title: "Review liquidity removal",
      description:
        "Burn this Uniswap V4 position and return both currencies to the connected wallet. The reviewed minimum returns are enforced onchain.",
      confirmLabel: "Agree & remove liquidity",
    },
  });
  const receipt = useWaitForTransactionReceipt({ hash });
  const positions = useQuery({
    queryKey: ["revnetWalletLpPositions", state.chainId, pool?.poolId, address?.toLowerCase()],
    enabled: Boolean(pool && positionManager && address),
    retry: 0,
    staleTime: 30_000,
    queryFn: () => readUserLpPositions(pool!, address!),
  });

  // Unclaimed fees per position — the reason an LP opens this panel. Read
  // separately so the position list is not held up by two extra calls each.
  const fees = useQuery({
    queryKey: [
      "revnetWalletLpFees",
      state.chainId,
      pool?.poolId,
      (positions.data ?? []).map((position) => position.tokenId.toString()).join(","),
    ],
    enabled: Boolean(pool && positions.data?.length && client),
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => {
      const entries = await Promise.all(
        (positions.data ?? []).map(async (position) => {
          const owed = await readLpPositionFees(client!, pool!, position).catch(() => null);
          return [position.tokenId.toString(), owed] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });

  useEffect(() => {
    onStatus(
      chainId,
      positions.isLoading ? "loading" : positions.isError ? "error" : (positions.data?.length ?? 0),
    );
  }, [chainId, onStatus, positions.isLoading, positions.isError, positions.data?.length]);

  useEffect(() => {
    if (receipt.isSuccess) {
      setReviewed(null);
      void positions.refetch();
      void fees.refetch();
    }
    // Refetch only on the receipt transition; the query object changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  if (!pool || !positionManager || !address) return null;

  const beginReview = async (position: UserLpPosition) => {
    setError(null);
    setRefreshing(position.tokenId);
    try {
      const fresh = await refreshUserLpPosition(pool, position.tokenId, address);
      setReviewed({
        position: fresh,
        plan: prepareRemoveLiquidity(pool, fresh, address, isSafeConnection(wagmiConfig)),
      });
    } catch (cause) {
      setError(txMessage(cause, "Could not refresh this position."));
    } finally {
      setRefreshing(null);
    }
  };

  // Claim fees only. Nothing is swapped and the position is untouched, so
  // there is no reviewed amount to re-verify — only the wallet's ownership,
  // which the PositionManager enforces itself.
  const claimFees = async (positions: UserLpPosition[]) => {
    setError(null);
    setClaiming(positions[0].tokenId);
    try {
      const unlockData =
        positions.length === 1
          ? prepareCollectLpFees(pool, positions[0], address, isSafeConnection(wagmiConfig))
              .unlockData
          : prepareCollectMarketFees(
              pool,
              positions.map((position) => position.tokenId),
              address,
            ).unlockData;
      await writeContractAsync({
        chainId,
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "modifyLiquidities",
        args: [unlockData, lpDeadline(isSafeConnection(wagmiConfig))],
      });
      setClaimReview(null);
    } catch (cause) {
      setError(txMessage(cause, "Could not claim fees."));
    } finally {
      setClaiming(null);
    }
  };

  const remove = async () => {
    if (!reviewed) return;
    setError(null);
    try {
      const fresh = await refreshUserLpPosition(pool, reviewed.position.tokenId, address);
      if (fresh.liquidity < reviewed.position.liquidity) {
        throw new Error("This position changed. Review its current return before removing it.");
      }
      await writeContractAsync({
        chainId,
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "modifyLiquidities",
        // The reviewed minimums live in `unlockData` and stay frozen; only the
        // deadline is re-stamped, so a slow review can't ship an already-expired
        // window.
        args: [reviewed.plan.unlockData, lpDeadline(isSafeConnection(wagmiConfig))],
      });
    } catch (cause) {
      setError(txMessage(cause, "Could not remove liquidity."));
    }
  };

  const chainCell = (
    <TableCell className="whitespace-nowrap">
      <span className="inline-flex items-center gap-1.5">
        <ChainLogo chainId={state.chainId} width={14} height={14} />
        {chainName(state.chainId)}
      </span>
    </TableCell>
  );

  if (positions.isLoading) {
    return (
      <TableRow>
        {chainCell}
        <TableCell colSpan={5} className="text-xs text-zinc-400">
          Reading your positions…
        </TableCell>
      </TableRow>
    );
  }
  // An incomplete log scan must not read as "you have no positions".
  if (positions.isError) {
    return (
      <TableRow>
        {chainCell}
        <TableCell colSpan={5} className="text-xs text-red-600">
          Could not verify the complete position history. Nothing has been hidden as an empty
          result.
        </TableCell>
      </TableRow>
    );
  }
  if (!positions.data?.length) return null;

  const groups = groupMarketPositions(pool, positions.data);
  const anyBusy =
    isPending ||
    claiming !== null ||
    refreshing !== null ||
    reviewed !== null ||
    editing !== null ||
    editingMarket !== null;

  const renderSingle = (position: UserLpPosition) => {
    const owed = fees.data?.[position.tokenId.toString()];
    const nothingOwed = !owed || (owed.pairFees <= 0n && owed.tokenFees <= 0n);
    const busy =
      isPending ||
      claiming !== null ||
      refreshing !== null ||
      reviewed !== null ||
      editing !== null ||
      editingMarket !== null;
    return (
      <TableRow key={position.tokenId.toString()} className="align-top">
        {chainCell}
        <TableCell className="font-mono text-xs">#{position.tokenId.toString()}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">
          {fmtUnits(position.tokenAmount, 18)} {tokenSymbol}
          <span className="block text-xs text-zinc-500">
            {fmtUnits(position.pairAmount, pool.pair.decimals)} {pool.pair.symbol}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">
          {fees.isLoading || owed === undefined ? (
            <span className="text-zinc-400">Reading…</span>
          ) : !owed ? (
            <span className="text-zinc-400">Unavailable</span>
          ) : nothingOwed ? (
            <span className="text-zinc-400">None yet</span>
          ) : (
            <>
              {fmtUnits(owed.tokenFees, 18)} {tokenSymbol}
              <span className="block text-xs text-zinc-500">
                {fmtUnits(owed.pairFees, pool.pair.decimals)} {pool.pair.symbol}
              </span>
            </>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">
          {(() => {
            // The pool forgets what a position already took, so lifetime is
            // only knowable where the index has been accumulating it.
            if (position.claimedPairFees === undefined || !owed) {
              return <span className="text-zinc-400">—</span>;
            }
            const lifetimeToken = position.claimedTokenFees! + owed.tokenFees;
            const lifetimePair = position.claimedPairFees + owed.pairFees;
            if (lifetimeToken <= 0n && lifetimePair <= 0n) {
              return <span className="text-zinc-400">None yet</span>;
            }
            return (
              <>
                {fmtUnits(lifetimeToken, 18)} {tokenSymbol}
                <span className="block text-xs text-zinc-500">
                  {fmtUnits(lifetimePair, pool.pair.decimals)} {pool.pair.symbol}
                </span>
              </>
            );
          })()}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right">
          <span className="inline-flex gap-2">
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
              disabled={busy || nothingOwed}
              onClick={() => {
                setError(null);
                setClaimReview([position]);
              }}
            >
              {claiming === position.tokenId ? "Claiming…" : "Claim fees"}
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setError(null);
                setEdited(null);
                setEditing(position);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => void beginReview(position)}
            >
              {refreshing === position.tokenId ? "Refreshing…" : "Remove"}
            </button>
          </span>
        </TableCell>
      </TableRow>
    );
  };

  // A market: two positions that meet at the price. Holdings and fees are the
  // two sides added up; every action covers both.
  const renderMarket = (group: Extract<PositionGroup, { kind: "market" }>) => {
    const sides = [group.tokenSide, group.pairSide];
    const owedSides = sides.map((side) => fees.data?.[side.tokenId.toString()]);
    const feesKnown = owedSides.every((owed) => owed !== undefined);
    const feesUsable = owedSides.every((owed) => !!owed);
    const owedToken = owedSides.reduce((sum, owed) => sum + (owed?.tokenFees ?? 0n), 0n);
    const owedPair = owedSides.reduce((sum, owed) => sum + (owed?.pairFees ?? 0n), 0n);
    const nothingOwed = !feesUsable || (owedToken <= 0n && owedPair <= 0n);
    const tokenHeld = sides.reduce((sum, side) => sum + side.tokenAmount, 0n);
    const pairHeld = sides.reduce((sum, side) => sum + side.pairAmount, 0n);
    const lifetimeKnown = feesUsable && sides.every((side) => side.claimedPairFees !== undefined);
    const lifetimeToken = lifetimeKnown
      ? sides.reduce((sum, side) => sum + side.claimedTokenFees!, 0n) + owedToken
      : 0n;
    const lifetimePair = lifetimeKnown
      ? sides.reduce((sum, side) => sum + side.claimedPairFees!, 0n) + owedPair
      : 0n;
    const key = `market:${group.tokenSide.tokenId.toString()}:${group.pairSide.tokenId.toString()}`;
    const pending = sides.some((side) => claiming === side.tokenId);
    return (
      <TableRow key={key} className="align-top">
        {chainCell}
        <TableCell className="whitespace-nowrap font-mono text-xs">
          Market
          <span className="block text-zinc-500">
            #{group.tokenSide.tokenId.toString()} · #{group.pairSide.tokenId.toString()}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">
          {fmtUnits(tokenHeld, 18)} {tokenSymbol}
          <span className="block text-xs text-zinc-500">
            {fmtUnits(pairHeld, pool.pair.decimals)} {pool.pair.symbol}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">
          {fees.isLoading || !feesKnown ? (
            <span className="text-zinc-400">Reading…</span>
          ) : !feesUsable ? (
            <span className="text-zinc-400">Unavailable</span>
          ) : nothingOwed ? (
            <span className="text-zinc-400">None yet</span>
          ) : (
            <>
              {fmtUnits(owedToken, 18)} {tokenSymbol}
              <span className="block text-xs text-zinc-500">
                {fmtUnits(owedPair, pool.pair.decimals)} {pool.pair.symbol}
              </span>
            </>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">
          {!lifetimeKnown ? (
            <span className="text-zinc-400">—</span>
          ) : lifetimeToken <= 0n && lifetimePair <= 0n ? (
            <span className="text-zinc-400">None yet</span>
          ) : (
            <>
              {fmtUnits(lifetimeToken, 18)} {tokenSymbol}
              <span className="block text-xs text-zinc-500">
                {fmtUnits(lifetimePair, pool.pair.decimals)} {pool.pair.symbol}
              </span>
            </>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right">
          <span className="inline-flex gap-2">
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
              disabled={anyBusy || nothingOwed}
              onClick={() => {
                setError(null);
                setClaimReview(sides);
              }}
            >
              {pending ? "Claiming…" : "Claim fees"}
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
              disabled={anyBusy}
              onClick={() => {
                setError(null);
                setEdited(null);
                setEditingMarket({ sides: group, startEmpty: false });
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
              disabled={anyBusy}
              onClick={() => {
                setError(null);
                setEdited(null);
                setEditingMarket({ sides: group, startEmpty: true });
              }}
            >
              Remove
            </button>
          </span>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <>
      {groups.map((group) =>
        group.kind === "single" ? renderSingle(group.position) : renderMarket(group),
      )}
      {claimReview ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setClaimReview(null);
          }}
          title="Confirm fee claim"
          chainId={state.chainId}
          steps={[
            {
              title: "Claim fees",
              detail: "The positions stay open; only the fees move to your wallet.",
            },
          ]}
          activeIndex={isPending ? 0 : -1}
          action="Claim fees"
          onConfirm={() => void claimFees(claimReview)}
          busy={isPending || claiming !== null}
          error={error}
        >
          <SummaryRow label={claimReview.length === 1 ? "Position" : "Positions"}>
            {claimReview.map((position) => `#${position.tokenId.toString()}`).join(" · ")}
          </SummaryRow>
          <SummaryRow label="On">{chainName(state.chainId)}</SummaryRow>
          <SummaryRow label="To your wallet">
            {fmtUnits(
              claimReview.reduce(
                (sum, position) =>
                  sum + (fees.data?.[position.tokenId.toString()]?.tokenFees ?? 0n),
                0n,
              ),
              18,
            )}{" "}
            {tokenSymbol}
            <span className="block text-xs text-zinc-500">
              {fmtUnits(
                claimReview.reduce(
                  (sum, position) =>
                    sum + (fees.data?.[position.tokenId.toString()]?.pairFees ?? 0n),
                  0n,
                ),
                pool.pair.decimals,
              )}{" "}
              {pool.pair.symbol}
            </span>
          </SummaryRow>
        </TxConfirmDialog>
      ) : null}
      {reviewed || refreshing !== null ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewed(null);
          }}
          title="Confirm removal"
          chainId={state.chainId}
          preparing={!reviewed}
          status={reviewed ? null : "Reading the live position…"}
          steps={[
            {
              title: "Remove the position",
              detail: "Burns it and returns both sides to your wallet.",
            },
          ]}
          activeIndex={isPending ? 0 : -1}
          action="Remove the position"
          onConfirm={() => void remove()}
          busy={isPending}
          error={error}
        >
          {reviewed ? (
            <>
              <SummaryRow label="Position">
                #{reviewed.position.tokenId.toString()} on {chainName(state.chainId)}
              </SummaryRow>
              <SummaryRow label="Back to your wallet">
                ~{fmtUnits(reviewed.position.tokenAmount, 18)} {tokenSymbol} +{" "}
                {fmtUnits(reviewed.position.pairAmount, pool.pair.decimals)} {pool.pair.symbol} +
                unclaimed fees
              </SummaryRow>
              <SummaryRow label="Enforced onchain">
                At least {fmtUnits(reviewed.plan.tokenMinimum, 18)} {tokenSymbol} +{" "}
                {fmtUnits(reviewed.plan.pairMinimum, pool.pair.decimals)} {pool.pair.symbol} back
                (95% floors)
              </SummaryRow>
            </>
          ) : null}
        </TxConfirmDialog>
      ) : null}
      {/* The panels live OUTSIDE the scroll wrapper — as table rows they would
          inherit the table's full scrollable width and get cut off. */}
      {panelHost
        ? createPortal(
            <>
              {editingMarket ? (
                <MarketEditPanel
                  key={`${editingMarket.sides.tokenSide?.tokenId ?? "-"}:${editingMarket.sides.pairSide?.tokenId ?? "-"}`}
                  state={state}
                  pool={pool}
                  sides={editingMarket.sides}
                  tokenSymbol={tokenSymbol}
                  startEmpty={editingMarket.startEmpty}
                  onClose={() => setEditingMarket(null)}
                  onDone={(hash) => {
                    setEditingMarket(null);
                    setEdited(
                      hash
                        ? "Market updated. The table above reflects it."
                        : "Market edit proposed to Safe. The table updates once it executes.",
                    );
                    void positions.refetch();
                    void fees.refetch();
                  }}
                />
              ) : null}
              {editing ? (
                <EditPositionPanel
                  key={editing.tokenId.toString()}
                  state={state}
                  pool={pool}
                  position={editing}
                  tokenSymbol={tokenSymbol}
                  onClose={() => setEditing(null)}
                  onDone={(hash) => {
                    setEditing(null);
                    setEdited(
                      hash
                        ? "Position updated. The table above reflects it."
                        : "Position edit proposed to Safe. The table updates once it executes.",
                    );
                    void positions.refetch();
                    void fees.refetch();
                  }}
                />
              ) : null}
              {receipt.isSuccess ? (
                <p className="mt-2 text-xs text-green-700">Liquidity removal confirmed.</p>
              ) : null}
              {edited ? <p className="mt-2 text-xs text-green-700">{edited}</p> : null}
              {error && !reviewed && !claimReview ? (
                <p className="mt-2 wrap-anywhere text-xs text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
            </>,
            panelHost,
          )
        : null}
    </>
  );
}

/**
 * The project's buyback-hook Uniswap V4 pool per chain: live price, exact pool
 * reserves (net LP ranges valued at the current price), and the PoolManager
 * explorer link. The pool is keyed by (projectId, PAIR/accounting token) — a
 * USDC project's pool is only found by passing its USDC context, never a
 * hardcoded native token.
 */
export function AmmCard({ chains, tokenSymbol }: { chains: ChainProject[]; tokenSymbol: string }) {
  const { data, isLoading, isError, isFetching } = useQuery(
    cachedQuery({
      queryKey: ["v6AmmStates", chainProjectsKey(chains)],
      enabled: chains.length > 0,
      staleTime: 60_000,
      queryFn: () => fetchAmmStates(chains),
    }),
  );

  const anyHook = data?.some((s) => s.hook) ?? false;

  const content = (kind: "market" | "liquidity") => {
    if (isLoading) return <SkeletonLines lines={Math.max(chains.length, 2)} className="py-3" />;
    if (isError || !data) {
      return <div className="py-3 text-sm text-zinc-500">Could not read the buyback pool.</div>;
    }
    if (!anyHook) {
      return (
        <div className="py-3 text-sm text-zinc-400">
          No buyback hook configured — there is no project-owned AMM pool to show.
        </div>
      );
    }
    return data.map((state) =>
      kind === "market" ? (
        <MarketChainRow
          key={state.chainId}
          state={state}
          tokenSymbol={tokenSymbol}
          pending={isFetching}
        />
      ) : (
        <LiquidityChainRow key={state.chainId} state={state} tokenSymbol={tokenSymbol} />
      ),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-teal-200 bg-teal-50 p-4">
        <h3 className="font-medium text-zinc-900">
          Pool <span className="ml-1 text-xs uppercase tracking-wide text-zinc-400">AMM</span>
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          The market fills orders that would give payers more {tokenSymbol} than issuance. Arbitrage
          keeps its price between the issuance ceiling and the cash-out floor.
        </p>
        <div className="mt-2">{content("market")}</div>
      </div>

      <div className="border border-teal-200 bg-teal-50 p-4">
        <h3 className="font-medium text-zinc-900">Liquidity</h3>
        <p className="mt-1 text-sm text-zinc-500">
          The tokens currently pooled across the market&apos;s active price ranges.
        </p>
        <div className="mt-2">{content("liquidity")}</div>
      </div>
    </div>
  );
}
