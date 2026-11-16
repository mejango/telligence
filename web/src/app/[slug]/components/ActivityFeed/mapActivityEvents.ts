import { chainDisplayName } from "@/app/constants";
import type { ActivityEventsQuery, EventToken } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { commaNumber, exactNumber, formatCompact, prettyNumber } from "@/lib/number";
import { isStickyHook } from "@/lib/sticky";
import { getTokenSymbolFromAddress, groupMixesTokens } from "@/lib/tokenUtils";
import { JBProjectToken, mergeCrossChainActivityGroups } from "@bananapus/nana-sdk-core";
import { Address, formatUnits } from "viem";
import { formatUsd, usdFromScaled } from "../v6/extras/projectPayers";
import type { ActivityEvent } from "./ActivityItem";

export type ActivityEventItem = ActivityEventsQuery["activityEvents"]["items"][number];

/**
 * The symbol and decimals of the token an event names: null when unknown or
 * unresolved, undefined when the query did not select the field.
 */
function ownToken(asset: EventToken): { symbol: string; decimals: number } | null | undefined {
  if (asset.token === undefined) return undefined;
  const symbol = asset.token
    ? asset.tokenSymbol || getTokenSymbolFromAddress(asset.token)
    : "TOKEN";
  return symbol !== "TOKEN" && asset.decimals != null ? { symbol, decimals: asset.decimals } : null;
}

/** Holder permission grants are account history, not project activity. */
export function isProjectFeedActivityEvent(event: ActivityEventItem): boolean {
  return !event.operatorPermissionsSetEvent;
}

/**
 * The token denomination for one event's amounts. Return null to skip the row
 * entirely (the project feed's behavior for chains it can't denominate);
 * return a context without a tokenSymbol to keep the row and omit the symbol
 * gracefully (the account feed's behavior for arbitrary projects).
 */
export type ActivityTokenContext = {
  tokenSymbol?: string | null;
  decimals?: number | null;
  /**
   * Denominate flow amounts that name no known token in the indexer's 18-decimal
   * USD figures instead of the chain's accounting token. The ecosystem
   * convention: accounting-token amounts only when the project has exactly one
   * accounting-token kind across its chains.
   */
  denominateInUsd?: boolean;
} | null;

/**
 * Project-feed denomination policy over the sucker group's per-chain rows:
 * token amounts when every chain shares one accounting-token kind, USD when
 * the chains disagree on symbol or decimals.
 */
export function projectFeedTokenContext(
  projects: ReadonlyArray<{
    chainId: number;
    tokenSymbol: string | null;
    decimals: number | null;
    accountingTokenCount?: number | null;
  }>,
): (item: ActivityEventItem) => ActivityTokenContext {
  const denominateInUsd = groupMixesTokens(projects);

  return (event) => {
    const projectForChain = projects.find((project) => project.chainId === event.chainId);
    // No accounting context for this chain — the project exists but has no ruleset/terminal
    // there, or the row wasn't fetched. The activity still HAPPENED, so keep the row and let
    // `flowAmount` decide what it can honestly show; dropping it silently denied the event.
    if (!projectForChain?.tokenSymbol) {
      return { tokenSymbol: undefined, decimals: undefined, denominateInUsd: true };
    }
    return {
      tokenSymbol: projectForChain.tokenSymbol,
      decimals: projectForChain.decimals,
      denominateInUsd,
    };
  };
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * "40" or "12.5" when the mint count reads as the reserved-rate remint of the
 * swap output (0 < mint < swap); null when the pair doesn't fit that shape.
 */
function reservePercentLabel(
  swapRaw: string | number | undefined,
  mintRaw: string | number,
): string | null {
  if (swapRaw == null) return null;
  try {
    const swap = BigInt(swapRaw);
    const mint = BigInt(mintRaw);
    if (swap <= 0n || mint <= 0n || mint >= swap) return null;
    const tenths = Number(((swap - mint) * 1000n) / swap);
    return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
  } catch {
    return null;
  }
}

/**
 * Reading order for a same-tx group: the first type present becomes the row's
 * primary event (actor, amount, in/out tag, avatar); the rest fold into the
 * sentence via `also`. A buyback pay reads as one row: "paid …, bought … via
 * the buyback pool".
 */
const SAME_TX_ORDER: ActivityEvent["type"][] = [
  "projectCreate",
  // A loan or a bridge claim moves money and tokens in its own transaction: it is the row, by
  // its own account, and the deposit or mint inside it reads after it.
  "borrowLoan",
  "repayLoan",
  "liquidateLoan",
  "bridgeClaim",
  "in",
  "addToBalance",
  "out",
  "swapBuy",
  "swapSell",
  "issuance",
  "swap",
  "mint",
  "mintNft",
  "autoIssue",
  "reserved",
  "reservedSplit",
  "bridgeSend",
];

function sameTxRank(type: ActivityEvent["type"]): number {
  const rank = SAME_TX_ORDER.indexOf(type);
  return rank === -1 ? SAME_TX_ORDER.length : rank;
}

function rawTokenCount(event: ActivityEvent): bigint {
  try {
    return BigInt(event.rawTokenCount ?? "0");
  } catch {
    return 0n;
  }
}

/**
 * Collapse rows that belong to one transaction (on one chain) into a single
 * row. Order is preserved: a group sits where its first row sat.
 */
export function groupSameTxEvents(events: ActivityEvent[]): ActivityEvent[] {
  const groups = new Map<string, ActivityEvent[]>();
  const order: ActivityEvent[][] = [];
  for (const event of events) {
    const key = `${event.chainId}:${event.txHash}`;
    const group = groups.get(key);
    if (group) group.push(event);
    else {
      const fresh = [event];
      groups.set(key, fresh);
      order.push(fresh);
    }
  }
  return order.map(foldSameTxActivities);
}

/** Project-feed pool setup repeats across chains, with every original tx retained. */
export function groupCrossChainPoolEvents(events: ActivityEvent[]): ActivityEvent[] {
  return mergeCrossChainActivityGroups(
    events.map((event) => ({
      value: event,
      // Group standalone pool setup only. Financial and mixed-action rows keep
      // their own amounts and descriptions rather than a representative.
      signature:
        event.type === "buybackPool" && !event.also?.length
          ? `buybackPool:${event.beneficiary.toLowerCase()}`
          : `transaction:${event.chainId}:${event.txHash}`,
      chainId: event.chainId,
      txHash: event.txHash,
      timestamp: event.timestamp,
    })),
  ).map(({ value, chains }) =>
    chains.length > 1
      ? {
          ...value,
          chains: chains.map((chain) => ({ ...chain, chainId: chain.chainId as JBChainId })),
        }
      : value,
  );
}

/** Fold one same-tx group into its primary row, the rest carried in `also`. */
export function foldSameTxActivities(group: ActivityEvent[]): ActivityEvent {
  if (group.length === 1) return group[0];
  const ordered = [...group].sort((a, b) => {
    const byRank = sameTxRank(a.type) - sameTxRank(b.type);
    if (byRank) return byRank;
    // Reserved-split receipts read largest first.
    const left = rawTokenCount(a);
    const right = rawTokenCount(b);
    return left < right ? 1 : left > right ? -1 : 0;
  });
  const amountSource = ordered.find((entry) => entry.baseAmount) ?? ordered[0];
  return {
    ...ordered[0],
    baseAmount: amountSource.baseAmount,
    exactAmount: amountSource.exactAmount,
    baseTokenSymbol: amountSource.baseTokenSymbol,
    memo: ordered.find((entry) => entry.memo)?.memo,
    also: ordered.slice(1),
  };
}

/**
 * Maps raw bendystraw activity-event rows to renderable ActivityEvent rows.
 * Extracted from the project ActivityFeed so it also works without a sucker
 * group: `tokenContextFor` decides each row's denomination (and whether the
 * row is kept at all).
 */
export function mapActivityEvents(
  items: ReadonlyArray<ActivityEventItem | null | undefined>,
  tokenContextFor: (item: ActivityEventItem) => ActivityTokenContext,
): ActivityEvent[] {
  // A cash out can also buy fee-project tokens. Keep each project's totals
  // and receipt matching separate even when those actions share a transaction.
  const projectTxKey = (event: ActivityEventItem) =>
    `${event.chainId}:${event.project?.version ?? ""}:${event.project?.projectId ?? ""}:${event.txHash}`;
  // mintTokensOf fires alongside pays, manual mints, and auto-issuance, each of which
  // already gets its own row — only surface mintTokensEvent rows for txs none of those
  // cover. A pay that issued NOTHING itself (the buyback route: the terminal minted
  // zero, the hook reminted the swap output) does not cover its tx's mint — that mint
  // is the payer's actual receipt. Same idea for manual mints inside auto-issue txs.
  const mintCoveredTxs = new Set<string>();
  const autoIssueTxs = new Set<string>();
  // Every buy swap in the tx: a tx with two pays has two swaps and two
  // remints, and each mint pairs with its own swap, not the last one. The
  // indexer returns a tx's events in no particular order, so pairing goes by
  // amount rank (largest swap ↔ largest remint): one reserve rate applies to
  // every pay in a tx, which keeps the ranks aligned.
  const buySwapAmountsByTx = new Map<string, bigint[]>();
  // Leftover issuance joins the bought tokens in ONE beneficiary remint;
  // sells can also remint internally. Neither shape supports per-buy matching.
  const mixedSwapTxs = new Set<string>();
  // A cash out that sells through the buyback pool: the terminal burns the
  // holder's tokens, the hook remints them to itself and sells. That mint is
  // plumbing, not anyone's receipt.
  const sellSwapTxs = new Set<string>();
  const cashOutTxs = new Set<string>();
  // A sucker cashes out its own tokens inside a bridge send; the send's row says what happened,
  // so that cash out makes no row.
  const bridgeSends = new Set<string>();
  const mintCountsByTx = new Map<string, bigint[]>();
  const manualMintCountsByTx = new Map<string, bigint[]>();
  const pushSorted = (map: Map<string, bigint[]>, key: string, value: bigint) => {
    const list = map.get(key) ?? [];
    list.push(value);
    list.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    map.set(key, list);
  };
  // Several pays in one tx (a payer contract fanning out) read as one payment:
  // the payer's total, then who got what.
  const payTotalsByTx = new Map<
    string,
    { count: number; amount: bigint; usd: bigint; asset: EventToken }
  >();
  for (const event of items) {
    if (!event) continue;
    const key = projectTxKey(event);
    if (event.payEvent) {
      const { token, decimals, tokenSymbol } = event.payEvent;
      const total = payTotalsByTx.get(key) ?? {
        count: 0,
        amount: 0n,
        usd: 0n,
        asset: { token, decimals, tokenSymbol },
      };
      // A fan-out's total has a token only when every pay was in the same one.
      if (
        total.asset.token?.toLowerCase() !== token?.toLowerCase() ||
        total.asset.decimals !== decimals
      ) {
        total.asset = { token: null, decimals: null };
      }
      total.count += 1;
      total.amount += BigInt(event.payEvent.amount);
      total.usd += BigInt(event.payEvent.amountUsd ?? 0);
      payTotalsByTx.set(key, total);
    }
    const payIssued = event.payEvent && BigInt(event.payEvent.newlyIssuedTokenCount) > 0n;
    if (payIssued || event.manualMintTokensEvent || event.autoIssueEvent) {
      mintCoveredTxs.add(key);
    }
    if (event.autoIssueEvent) autoIssueTxs.add(key);
    if (event.cashOutTokensEvent) cashOutTxs.add(key);
    if (event.bridgeToOutboxEvent) {
      bridgeSends.add(`${key}:${event.bridgeToOutboxEvent.sucker.toLowerCase()}`);
    }
    if (event.swapEvent) {
      if (event.swapEvent.direction.toLowerCase() === "buy") {
        pushSorted(buySwapAmountsByTx, key, BigInt(event.swapEvent.projectTokenAmount));
      } else {
        mixedSwapTxs.add(key);
        if (event.swapEvent.direction.toLowerCase() === "sell") sellSwapTxs.add(key);
      }
    }
    if (event.mintTokensEvent) {
      pushSorted(mintCountsByTx, key, BigInt(event.mintTokensEvent.beneficiaryTokenCount));
    }
    if (event.manualMintTokensEvent) {
      pushSorted(
        manualMintCountsByTx,
        key,
        BigInt(event.manualMintTokensEvent.beneficiaryTokenCount),
      );
    }
  }
  /** The buy swap whose output this remint is the reserved-rate share of, by amount rank. */
  const pairedSwapAmount = (key: string, counts: Map<string, bigint[]>, count: bigint) => {
    if (mixedSwapTxs.has(key)) return undefined;
    const rank = (counts.get(key) ?? []).indexOf(count);
    return rank < 0 ? undefined : buySwapAmountsByTx.get(key)?.[rank]?.toString();
  };

  const isHookRemint = (key: string) => cashOutTxs.has(key) && sellSwapTxs.has(key);
  // With no reserve cut, the remint is the pool output the swap row already
  // names. A fan-out hides its swaps, so its remints stay: they say who got what.
  const restatesSwap = (key: string, swapAmount: string | undefined, count: bigint) =>
    swapAmount === count.toString() && (payTotalsByTx.get(key)?.count ?? 0) < 2;

  const events: ActivityEvent[] = [];
  for (const event of items) {
    if (!event) continue;

    const chainId = event.chainId as JBChainId;
    const tokenContext = tokenContextFor(event);
    if (!tokenContext) continue;

    const txKey = projectTxKey(event);

    // In USD mode a missing/zero indexed figure falls back to the chain's
    // token so the row still shows a meaningful amount. A terminal event names
    // its own token: a project accepting ETH and USDC is labeled per event,
    // never by the chain's last-set context, and an unknown or unresolved
    // token shows USD (or nothing) instead.
    const flowAmount = (
      tokenAmount: string | number,
      usdAmount?: string | number | null,
      asset?: EventToken,
    ) => {
      const own = asset && ownToken(asset);
      const baseTokenSymbol =
        own === undefined ? (tokenContext.tokenSymbol ?? undefined) : own?.symbol;
      const contextDecimals = own === undefined ? tokenContext.decimals : (own?.decimals ?? null);
      const baseTokenDecimals = contextDecimals ?? 18;
      // An event that names a known token is shown in it; USD is for the rest.
      const usd =
        !own && (tokenContext.denominateInUsd || contextDecimals == null)
          ? usdFromScaled(usdAmount)
          : null;
      if (usd) {
        // USD is the headline; the raw accounting amount is what a hover reveals. It can
        // only be shown when the context's decimals are known.
        const exact =
          contextDecimals == null
            ? undefined
            : `${exactNumber(formatUnits(BigInt(tokenAmount), baseTokenDecimals))}${
                baseTokenSymbol ? ` ${baseTokenSymbol}` : ""
              }`;
        return { baseAmount: formatUsd(usd), baseTokenSymbol: undefined, exactAmount: exact };
      }
      // Without the accounting context's decimals the raw amount cannot be scaled — showing
      // it at an assumed 18 would be off by 1e12 on a 6-decimal token. Keep the row and omit
      // the amount rather than invent a magnitude.
      if (contextDecimals == null) {
        return { baseAmount: undefined, baseTokenSymbol: undefined, exactAmount: undefined };
      }
      const whole = formatUnits(BigInt(tokenAmount), baseTokenDecimals);
      return {
        baseAmount: formatCompact(whole),
        baseTokenSymbol,
        exactAmount: `${exactNumber(whole)}${baseTokenSymbol ? ` ${baseTokenSymbol}` : ""}`,
      };
    };

    if (event.payEvent) {
      const tokenCount = prettyNumber(
        new JBProjectToken(BigInt(event.payEvent.newlyIssuedTokenCount)).format(6),
      );
      const payTotal = payTotalsByTx.get(txKey);
      const fanOut = !!payTotal && payTotal.count > 1;

      events.push({
        id: event.id,
        type: "in",
        txHash: event.payEvent.txHash,
        timestamp: event.payEvent.timestamp,
        beneficiary: (fanOut ? event.payEvent.from : event.payEvent.beneficiary) as Address,
        chainId,
        ...(fanOut
          ? flowAmount(payTotal.amount.toString(), payTotal.usd.toString(), payTotal.asset)
          : flowAmount(event.payEvent.amount, event.payEvent.amountUsd, event.payEvent)),
        payee: fanOut ? (event.payEvent.beneficiary as Address) : undefined,
        tokenCount,
        memo: event.payEvent.memo || undefined,
      });
    } else if (event.bridgeToOutboxEvent) {
      const send = event.bridgeToOutboxEvent;
      events.push({
        id: event.id,
        type: "bridgeSend",
        txHash: send.txHash,
        timestamp: send.timestamp,
        beneficiary: send.caller as Address,
        chainId,
        tokenCount: new JBProjectToken(BigInt(send.projectTokenCount)).format(6),
        detail: chainDisplayName(send.peerChainId),
      });
    } else if (
      event.cashOutTokensEvent?.holder &&
      bridgeSends.has(`${txKey}:${event.cashOutTokensEvent.holder.toLowerCase()}`)
    ) {
      continue;
    } else if (event.cashOutTokensEvent) {
      const tokenCount = new JBProjectToken(BigInt(event.cashOutTokensEvent.cashOutCount)).format(
        6,
      );
      // Sold through the buyback pool, the terminal reclaims nothing: the
      // same-tx sale carries the amount the holder got.
      const soldInPool =
        sellSwapTxs.has(txKey) && BigInt(event.cashOutTokensEvent.reclaimAmount) === 0n;

      events.push({
        id: event.id,
        type: "out",
        txHash: event.cashOutTokensEvent.txHash,
        timestamp: event.cashOutTokensEvent.timestamp,
        beneficiary: event.cashOutTokensEvent.beneficiary as Address,
        chainId,
        ...(soldInPool
          ? {}
          : flowAmount(
              event.cashOutTokensEvent.reclaimAmount,
              event.cashOutTokensEvent.reclaimAmountUsd,
              event.cashOutTokensEvent,
            )),
        tokenCount,
      });
    } else if (event.addToBalanceEvent) {
      const e = event.addToBalanceEvent;
      events.push({
        id: event.id,
        type: "addToBalance",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
        ...flowAmount(e.amount, e.amountUsd, e),
        memo: e.memo || undefined,
      });
    } else if (event.mintTokensEvent) {
      if (mintCoveredTxs.has(txKey) || isHookRemint(txKey)) continue;
      const e = event.mintTokensEvent;
      const count = BigInt(e.beneficiaryTokenCount);
      const swapAmount = pairedSwapAmount(txKey, mintCountsByTx, count);
      if (restatesSwap(txKey, swapAmount, count)) continue;
      // Paired with a same-tx buyback swap, this mint is the reserved-rate
      // remint of the swap output — name the reserve instead of "minted".
      const reservePercent = reservePercentLabel(swapAmount, e.beneficiaryTokenCount);
      events.push({
        id: event.id,
        type: "mint",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: prettyNumber(new JBProjectToken(BigInt(e.beneficiaryTokenCount)).format(6)),
        memo: e.memo || undefined,
        detail: reservePercent ? `after the ${reservePercent}% split` : undefined,
      });
    } else if (event.manualMintTokensEvent) {
      if (autoIssueTxs.has(txKey) || isHookRemint(txKey)) continue;
      const e = event.manualMintTokensEvent;
      const count = BigInt(e.beneficiaryTokenCount);
      const swapAmount = pairedSwapAmount(txKey, manualMintCountsByTx, count);
      if (restatesSwap(txKey, swapAmount, count)) continue;
      // The buyback remint arrives as a manual mint (a direct mintTokensOf
      // call) — same reserved-rate story as the mintTokensEvent branch.
      const reservePercent = reservePercentLabel(swapAmount, e.beneficiaryTokenCount);
      events.push({
        id: event.id,
        type: "mint",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: prettyNumber(new JBProjectToken(BigInt(e.beneficiaryTokenCount)).format(6)),
        memo: e.memo || undefined,
        detail: reservePercent ? `after the ${reservePercent}% split` : undefined,
      });
    } else if (event.mintNftEvent) {
      const e = event.mintNftEvent;
      events.push({
        id: event.id,
        type: "mintNft",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        item: event.project
          ? {
              projectId: event.project.projectId,
              tierId: e.tierId,
              amountPaid: String(e.totalAmountPaid),
            }
          : undefined,
      });
    } else if (event.autoIssueEvent) {
      const e = event.autoIssueEvent;
      const count = formatUnits(BigInt(e.count), 18);
      events.push({
        id: event.id,
        type: "autoIssue",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: prettyNumber(count),
        exactTokenCount: commaNumber(count),
      });
    } else if (event.deployErc20Event) {
      const e = event.deployErc20Event;
      events.push({
        id: event.id,
        type: "deployErc20",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
        detail: e.symbol.replace(/^\$+/, ""),
      });
    } else if (event.projectCreateEvent) {
      const e = event.projectCreateEvent;
      events.push({
        id: event.id,
        type: "projectCreate",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.projectTransferEvent) {
      const e = event.projectTransferEvent;
      events.push({
        id: event.id,
        type: "projectTransfer",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.previousOwner as Address,
        chainId,
        detail: truncateAddress(e.owner),
      });
    } else if (event.operatorPermissionsSetEvent) {
      const e = event.operatorPermissionsSetEvent;
      events.push({
        id: event.id,
        type: "operatorPermissionsSet",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.rulesetQueuedEvent) {
      const e = event.rulesetQueuedEvent;
      events.push({
        id: event.id,
        type: "rulesetQueued",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.swapEvent) {
      const e = event.swapEvent;
      const direction = e.direction.toLowerCase();
      events.push({
        id: event.id,
        type:
          direction === "sell"
            ? "swapSell"
            : direction === "buy"
              ? "swapBuy"
              : direction === "mint"
                ? "issuance"
                : "swap",
        txHash: e.txHash,
        timestamp: e.timestamp,
        // PoolManager is the indexed caller; `from` is the payer/seller whose
        // wallet should be attributed in the human activity feed.
        beneficiary: e.from as Address,
        chainId,
        ...flowAmount(e.terminalTokenAmount),
        tokenCount: prettyNumber(new JBProjectToken(BigInt(e.projectTokenAmount)).format(6)),
      });
    } else if (event.buybackPoolEvent) {
      const e = event.buybackPoolEvent;
      events.push({
        id: event.id,
        type: "buybackPool",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.bridgeClaimEvent) {
      const e = event.bridgeClaimEvent;
      events.push({
        id: event.id,
        type: "bridgeClaim",
        txHash: e.txHash,
        timestamp: e.timestamp,
        // The index can hold the sucker leaf's 32-byte beneficiary: its last 20 bytes are the account.
        beneficiary: `0x${e.beneficiary.slice(-40)}` as Address,
        chainId,
        tokenCount: new JBProjectToken(BigInt(e.projectTokenCount)).format(6),
        detail: chainDisplayName(e.peerChainId),
      });
    } else if (event.borrowLoanEvent) {
      const e = event.borrowLoanEvent;
      events.push({
        id: event.id,
        type: "borrowLoan",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: new JBProjectToken(BigInt(e.collateral)).format(6),
      });
    } else if (event.repayLoanEvent || event.liquidateLoanEvent) {
      const e = (event.repayLoanEvent ?? event.liquidateLoanEvent)!;
      events.push({
        id: event.id,
        type: event.repayLoanEvent ? "repayLoan" : "liquidateLoan",
        txHash: e.txHash,
        timestamp: e.timestamp,
        // Who called the loans contract: a Safe here, not the account that executed for it.
        beneficiary: e.caller as Address,
        chainId,
      });
    } else if (event.sendPayoutsEvent) {
      const e = event.sendPayoutsEvent;
      events.push({
        id: event.id,
        type: "payout",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
        ...flowAmount(e.amountPaidOut, e.amountPaidOutUsd, e),
      });
    } else if (event.sendReservedTokensToSplitsEvent) {
      const e = event.sendReservedTokensToSplitsEvent;
      events.push({
        id: event.id,
        type: "reserved",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
        tokenCount: prettyNumber(new JBProjectToken(BigInt(e.tokenCount)).format(6)),
      });
    } else if (event.sendReservedTokensToSplitEvent) {
      const e = event.sendReservedTokensToSplitEvent;
      events.push({
        id: event.id,
        type: "reservedSplit",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: prettyNumber(new JBProjectToken(BigInt(e.tokenCount)).format(6)),
        rawTokenCount: String(e.tokenCount),
        ...(e.hook && isStickyHook(e.hook, chainId)
          ? {
              sticky: {
                projectId: BigInt(e.splitProjectId),
                beneficiary: e.beneficiary as Address,
              },
            }
          : { detail: e.splitProjectId > 0 ? `project #${e.splitProjectId}` : undefined }),
      });
    }
  }
  return events;
}
