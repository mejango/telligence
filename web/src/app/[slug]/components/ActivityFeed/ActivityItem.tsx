"use client";

import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { DateRelative } from "@/components/DateRelative";
import EtherscanLink from "@/components/EtherscanLink";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { StickyRecipient } from "@/components/sticky/StickyRecipient";
import { useJBTokenContext } from "@/lib/nana/project";
import type { JBChainId } from "@/lib/nana/types";
import { stickyRecipientLabel } from "@/lib/sticky";
import { formatTokenSymbol } from "@/lib/utils";
import { JB_CHAINS, SPLITS_TOTAL_PERCENT } from "@bananapus/nana-sdk-core";
import { Address } from "viem";
import { formatShopAmount, useShopInventory, useTierMedia } from "../v6/shop/shopLib";

type ActivityEventType =
  | "in"
  | "out"
  | "addToBalance"
  | "mint"
  | "autoIssue"
  | "deployErc20"
  | "projectCreate"
  | "projectTransfer"
  | "operatorPermissionsSet"
  | "rulesetQueued"
  | "swapBuy"
  | "swapSell"
  | "issuance"
  | "swap"
  | "buybackPool"
  | "payout"
  | "reserved"
  | "reservedSplit"
  | "bridgeSend"
  | "bridgeClaim"
  | "borrowLoan"
  | "repayLoan"
  | "liquidateLoan"
  | "mintNft";

const ACTIVITY_LABELS: Record<ActivityEventType, string> = {
  in: "Payment",
  out: "Cash out",
  addToBalance: "Deposit",
  mint: "Minted",
  autoIssue: "Auto issuance",
  deployErc20: "Token deployed",
  projectCreate: "Created",
  projectTransfer: "Ownership",
  operatorPermissionsSet: "Permissions",
  rulesetQueued: "Rules queued",
  swapBuy: "Swap",
  swapSell: "Swap",
  issuance: "Issuance",
  swap: "Swap",
  buybackPool: "Buyback pool",
  payout: "Payout",
  reserved: "Splits",
  reservedSplit: "Splits",
  bridgeSend: "Bridged out",
  bridgeClaim: "Bridged in",
  borrowLoan: "Loan",
  repayLoan: "Loan repaid",
  liquidateLoan: "Loan liquidated",
  mintNft: "Item minted",
};

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  txHash: string;
  timestamp: number;
  beneficiary: Address;
  chainId: JBChainId;
  /** Matching setup on other chains, each with its own original transaction. */
  chains?: { chainId: JBChainId; txHash: string }[];
  baseAmount?: string;
  /** The unabbreviated amount (and raw accounting amount when the headline is USD). */
  exactAmount?: string;
  baseTokenSymbol?: string;
  tokenCount?: string;
  /** Exact whole-token amount retained when the displayed count is abbreviated. */
  exactTokenCount?: string;
  /** The unformatted token count, for ordering same-tx reserved-split receipts. */
  rawTokenCount?: string;
  memo?: string;
  /** Pre-formatted suffix detail, e.g. "ART" for deployErc20 or a truncated address for transfers. */
  detail?: string;
  /** Other events from the same transaction, folded into this row's sentence. */
  also?: ActivityEvent[];
  /** Set on a pay that shares its tx with other pays: who this one was for. */
  payee?: Address;
  /** A 721 mint: which item, what was paid for it, and for which project. */
  item?: { projectId: number; tierId: number; amountPaid: string };
  /** A reserved-split receipt paid to Sticky holders: the group and the Sticky token. */
  sticky?: { projectId: bigint; beneficiary: Address };
}

/** A tx with several pays reads "<total> from <payer>" and names who got what. */
function fansOut(entries: ActivityEvent[]): boolean {
  return entries.filter((entry) => entry.type === "in").length > 1;
}

/**
 * The group members worth describing. A zero-issuance pay's "paid in" adds
 * nothing next to the row's amount and "in" tag, so it contributes no
 * fragment when other actions exist — it still anchors the row's meta.
 */
function describableEntries(event: ActivityEvent): ActivityEvent[] {
  const entries = [event, ...(event.also ?? [])];
  if (entries.length === 1) return entries;
  // A reserved distribution's receipts name who got what — its own
  // "distributed" fragment adds nothing beside them.
  const hasReceipts = entries.some((entry) => entry.type === "reservedSplit");
  // A fan-out's buyback swaps carry the payer, not the payee; the remint each
  // one pairs with already names who got what.
  const fanOut = fansOut(entries);
  const visible = entries.filter((entry) => {
    if (entry.type === "in") return !!entry.tokenCount && entry.tokenCount !== "0";
    if (entry.type === "reserved") return !hasReceipts;
    if (entry.type === "swapBuy") return !fanOut;
    return true;
  });
  return visible.length ? visible : entries;
}

/** Whether the row's transaction distributed reserved tokens — its receipts then read "to <recipient>". */
function distributesReserved(event: ActivityEvent): boolean {
  return event.type === "reserved" || !!event.also?.some((entry) => entry.type === "reserved");
}

/** One sentence for a row and its same-tx companions: "bought …, and received …". */
export function combinedDescription(event: ActivityEvent, projectTokenSymbol: string): string {
  const distributed = distributesReserved(event);
  const fanOut = fansOut([event, ...(event.also ?? [])]);
  const fragments = describableEntries(event).map((entry) =>
    eventDescription(entry, projectTokenSymbol, distributed, fanOut),
  );
  if (fragments.length === 1) return fragments[0];
  if (fragments.length === 2) return `${fragments[0]} and ${fragments[1]}`;
  return `${fragments.slice(0, -1).join(", ")}, and ${fragments[fragments.length - 1]}`;
}

type DescriptionParts = {
  /** An address the sentence opens with ("<who> got …"), rendered as a profile link. */
  lead?: Address;
  pre: string;
  /** The token amount, slightly emphasized when rendered (same color, heavier weight). */
  strong?: string;
  post?: string;
  /** An address the sentence ends on, rendered as a profile link. */
  recipient?: Address;
  /** Sticky holders the sentence ends on, named by group and token. */
  sticky?: { projectId: bigint; beneficiary: Address };
};

function descriptionParts(
  event: ActivityEvent,
  projectTokenSymbol: string,
  distributed = false,
  fanOut = false,
): DescriptionParts {
  const count = `${event.tokenCount} ${projectTokenSymbol}`;
  switch (event.type) {
    case "in":
      // Acquisitions read "bought <amount> <token> <source>", matching the
      // buyback fragment. A buyback-routed pay issues nothing itself — the
      // same-tx remint row carries the payer's receipt, so "bought 0" would
      // misread.
      if (fanOut && event.tokenCount && event.tokenCount !== "0") {
        return { lead: event.payee, pre: " got ", strong: count };
      }
      return event.tokenCount && event.tokenCount !== "0"
        ? { pre: "bought ", strong: count, post: " from issuance" }
        : { pre: "paid in" };
    case "out":
      return { pre: "cashed out ", strong: count };
    case "addToBalance":
      return { pre: "added to balance" };
    case "mint":
      // `detail` marks the reserved-rate remint of a same-tx buyback swap.
      if (fanOut) {
        return {
          lead: event.beneficiary,
          pre: " got ",
          strong: count,
          post: event.detail ? ` ${event.detail}` : undefined,
        };
      }
      return event.detail
        ? { pre: "received ", strong: count, post: ` ${event.detail}` }
        : { pre: "minted ", strong: count };
    case "autoIssue":
      return { pre: "auto-issued ", strong: count };
    case "deployErc20":
      return { pre: `deployed the ${event.detail ?? projectTokenSymbol} token` };
    case "projectCreate":
      return { pre: "created the project" };
    case "projectTransfer":
      return { pre: `transferred the project${event.detail ? ` to ${event.detail}` : ""}` };
    case "operatorPermissionsSet":
      return { pre: "updated permissions" };
    case "rulesetQueued":
      return { pre: "queued a ruleset" };
    case "swapBuy":
      return { pre: "bought ", strong: count, post: " via the buyback pool" };
    case "swapSell":
      return { pre: "sold ", strong: count, post: " via the buyback pool" };
    case "issuance":
      return { pre: "bought ", strong: count, post: " from issuance" };
    case "swap":
      return { pre: "swapped ", strong: count, post: " via the buyback pool" };
    case "buybackPool":
      return { pre: "set the buyback pool" };
    case "payout":
      return { pre: "sent payouts" };
    case "bridgeSend":
      return { pre: "sending ", strong: count, post: ` to ${event.detail}` };
    case "bridgeClaim":
      return { pre: "claimed ", strong: count, post: ` from ${event.detail}` };
    case "borrowLoan":
      return { pre: "borrowed against ", strong: count };
    case "repayLoan":
      return { pre: "repaid a loan" };
    case "liquidateLoan":
      return { pre: "liquidated a loan" };
    case "reserved":
      return { pre: "distributed reserved ", strong: count };
    case "mintNft":
      return { pre: `minted item #${event.item?.tierId ?? ""}` };
    case "reservedSplit":
      // Under its distribution a receipt names who got what; on its own it
      // is what the account received.
      if (!distributed) return { pre: "received ", strong: count, post: " from a reserved split" };
      if (event.sticky) return { pre: "", strong: count, post: " to ", sticky: event.sticky };
      return event.detail
        ? { pre: "", strong: count, post: ` to ${event.detail}` }
        : { pre: "", strong: count, post: " to ", recipient: event.beneficiary };
  }
}

function eventDescription(
  event: ActivityEvent,
  projectTokenSymbol: string,
  distributed = false,
  fanOut = false,
): string {
  const parts = descriptionParts(event, projectTokenSymbol, distributed, fanOut);
  const shortAddress = (address?: Address) =>
    address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  return `${shortAddress(parts.lead)}${parts.pre}${parts.strong ?? ""}${parts.post ?? ""}${shortAddress(parts.recipient)}${parts.sticky ? stickyRecipientLabel(parts.sticky) : ""}`;
}

/** Hand-rolled markers: the dot sits flush left while wrapped lines keep hanging-indent alignment with the first line's text. */
const BULLET_CLASS =
  "relative break-words pl-3.5 before:absolute before:left-0 before:top-[5px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-zinc-300 before:content-['']";

/**
 * "minted item #2" grows into the item's name and, when the tier splits its
 * sales, a second bullet for the share of this payment that went to the split
 * recipients — the part of the price the buyer's token count does not account for.
 */
function ItemMintBullets({
  chainId,
  item,
}: {
  chainId: JBChainId;
  item: NonNullable<ActivityEvent["item"]>;
}) {
  const shop = useShopInventory(chainId, BigInt(item.projectId));
  const tier = shop.data?.tiers.find((entry) => entry.id === item.tierId);
  const media = useTierMedia(
    chainId,
    tier && shop.data
      ? {
          hook: shop.data.hook,
          store: shop.data.store,
          tiers: [tier],
          hasResolver: shop.data.tiers.some((entry) => entry.resolvedUri),
        }
      : null,
  );
  const name = media.data[item.tierId]?.name;
  const split =
    tier && shop.data && tier.splitPercent > 0
      ? {
          amount: `${formatShopAmount(
            (BigInt(item.amountPaid) * BigInt(tier.splitPercent)) / BigInt(SPLITS_TOTAL_PERCENT),
            shop.data.pricing.decimals,
          )} ${shop.data.pricing.symbol}`,
          percent: `${tier.splitPercent / 1e7}%`,
        }
      : null;
  return (
    <>
      <li className={BULLET_CLASS}>
        minted item #{item.tierId}
        {name ? ` (${name})` : ""}
      </li>
      {split ? (
        <li className={BULLET_CLASS}>
          <span className="font-medium">{split.amount}</span>
          {` (${split.percent}) sent to item recipients`}
        </li>
      ) : null}
    </>
  );
}

/** Project-page wrapper: reads the project token context for the symbol. */
export function ActivityItem({ event }: { event: ActivityEvent }) {
  const { token } = useJBTokenContext();

  if (!token?.data) return null;

  return (
    <ActivityItemRow event={event} projectTokenSymbol={formatTokenSymbol(token.data.symbol)} />
  );
}

/**
 * Context-free row renderer, usable outside a ProjectProvider (e.g. the
 * account view). When the symbol is unknown, amounts render without one.
 */
export function ActivityItemRow({
  event,
  projectTokenSymbol: symbol,
}: {
  event: ActivityEvent;
  projectTokenSymbol?: string;
}) {
  const chain = JB_CHAINS[event.chainId].chain;

  const projectTokenSymbol = symbol ?? "tokens";
  const isPayEvent = event.type === "in";
  const isInflow =
    isPayEvent ||
    event.type === "addToBalance" ||
    event.type === "swapBuy" ||
    event.type === "issuance";
  const isOutflow = event.type === "out" || event.type === "swapSell";
  // These rows identify the recipient, which need not be the caller.
  const isRecipient =
    event.type === "mint" ||
    event.type === "autoIssue" ||
    event.type === "reservedSplit" ||
    event.type === "mintNft";
  // A reserved distribution leads with the count the way value flows lead
  // with the amount: "3.6M ART" tagged "reserved distro".
  const isReserved = event.type === "reserved";
  const hasFlowTitle = !!event.baseAmount || isInflow || isOutflow || isReserved;
  const distributed = distributesReserved(event);
  const fanOut = fansOut([event, ...(event.also ?? [])]);
  // One fragment per same-tx event: a lone one reads inline, several read as bullets.
  const fragments = describableEntries(event).map((entry, index) => {
    if (entry.type === "mintNft" && entry.item) {
      return <ItemMintBullets key={index} chainId={entry.chainId} item={entry.item} />;
    }
    const parts = descriptionParts(entry, projectTokenSymbol, distributed, fanOut);
    return (
      <li key={index} className={BULLET_CLASS}>
        {parts.lead ? <ProfileAvatar address={parts.lead} short chain={chain} /> : null}
        {parts.pre}
        {parts.strong ? (
          <span
            className="font-medium"
            title={
              entry.exactTokenCount ? `${entry.exactTokenCount} ${projectTokenSymbol}` : undefined
            }
          >
            {parts.strong}
          </span>
        ) : null}
        {parts.post}
        {parts.recipient ? <ProfileAvatar address={parts.recipient} short chain={chain} /> : null}
        {parts.sticky ? <StickyRecipient split={parts.sticky} chainId={entry.chainId} /> : null}
      </li>
    );
  });
  const description = combinedDescription(event, projectTokenSymbol);

  const handleShare = async () => {
    const embedUrl = typeof window !== "undefined" ? window.location.href : "";
    const handle = `${event.beneficiary.slice(0, 6)}…`;
    const shareText = isPayEvent
      ? `⏩ ${handle} paid ${event.baseAmount} ${event.baseTokenSymbol} and received ${event.tokenCount} ${projectTokenSymbol} — "${event.memo}"`
      : event.type === "out"
        ? `⏩ ${handle} cashed out ${event.tokenCount} ${projectTokenSymbol} for ${event.baseAmount} ${event.baseTokenSymbol}`
        : `⏩ ${handle} ${description}`;
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: embedUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    const composer = new URL("https://farcaster.xyz/~/compose");
    composer.searchParams.set("text", shareText);
    composer.searchParams.append("embeds[]", embedUrl);
    window.open(composer, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="py-3 border-b border-zinc-200 last:border-b-0 flex gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          {/* One shape for every row: the flow cluster left with "time on
              <chain>" right, the prefixed actor below, then the memo headline
              and the actions as fine-print bullets. The exact value is one
              hover away — `title` has no open delay, so an abbreviated or
              USD-denominated headline never hides the real number. */}
          <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-500">
            {event.baseAmount && (
              <span className="truncate font-semibold text-zinc-800" title={event.exactAmount}>
                {event.baseTokenSymbol
                  ? `${event.baseAmount} ${event.baseTokenSymbol}`
                  : event.baseAmount}
              </span>
            )}
            {isReserved && (
              <span className="truncate font-semibold text-zinc-800">
                {event.tokenCount} {projectTokenSymbol}
              </span>
            )}
            {isInflow && (
              <span className="inline-flex h-5 min-w-7 items-center justify-center border border-teal-600 bg-teal-50 px-1 text-center text-[10px] leading-none text-teal-600">
                in
              </span>
            )}
            {isOutflow && (
              <span className="inline-flex h-5 min-w-7 items-center justify-center border border-orange-500 bg-orange-50 px-1 text-center text-[10px] leading-none text-orange-500">
                out
              </span>
            )}
            {isReserved && (
              <span className="inline-flex h-5 min-w-7 items-center justify-center border border-violet-600 bg-violet-50 px-1 text-center text-[10px] leading-none text-violet-600">
                reserved distro
              </span>
            )}
            {!hasFlowTitle && (
              <span className="inline-flex h-5 items-center border border-zinc-300 px-1.5 text-[10px] font-medium leading-none text-zinc-600">
                {ACTIVITY_LABELS[event.type]}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <EtherscanLink type="tx" value={event.txHash} chain={chain}>
              <DateRelative timestamp={event.timestamp} insideLink />
            </EtherscanLink>
            {event.chains ? (
              <span className="isolate inline-flex items-center">
                {event.chains.map((entry, index, chains) => (
                  <span
                    key={entry.chainId}
                    className="relative -ml-1.5 inline-flex first:ml-0"
                    style={{ zIndex: chains.length - index }}
                  >
                    <EtherscanLink
                      type="tx"
                      value={entry.txHash}
                      chain={JB_CHAINS[entry.chainId].chain}
                      className="inline-flex items-center justify-center rounded-full hover:opacity-70"
                    >
                      <span className="sr-only">
                        View transaction on {chainDisplayName(entry.chainId)}
                      </span>
                      <ChainLogo chainId={entry.chainId} width={18} height={18} />
                    </EtherscanLink>
                  </span>
                ))}
              </span>
            ) : (
              <ChainLogo chainId={event.chainId} width={18} height={18} standalone />
            )}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-zinc-500">
          {isOutflow || isRecipient ? "to" : isInflow ? "from" : "by"}{" "}
          <span className="min-w-0 truncate">
            <ProfileAvatar address={event.beneficiary} short chain={chain} />
          </span>
        </div>
        {event.memo && (
          <p className="text-sm text-zinc-700 break-all mt-3">
            <button
              type="button"
              onClick={() => void handleShare()}
              className="text-left hover:underline"
              title="Share this activity"
              aria-label={`Share activity: ${event.memo}`}
            >
              “{event.memo}”
            </button>
          </p>
        )}
        <ul className={`${event.memo ? "mt-1" : "mt-3"} space-y-0.5 text-xs text-zinc-500`}>
          {fragments}
        </ul>
      </div>
    </div>
  );
}
