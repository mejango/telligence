import { V6PayMode, V6PayTokenOption } from "@/lib/v6/pay";
import { parseUnits } from "viem";

/**
 * Keep the established pay-panel height while a thumbnail strip is present,
 * or while the initial inventory request may still reveal one. Once the
 * request resolves without tiers, let the panel shrink to its natural height.
 */
export function payPanelLayoutClasses({
  mode,
  shopTierCount,
}: {
  mode: V6PayMode;
  shopTierCount: number | undefined;
}) {
  // Deliberately blind to whether the inventory is still loading. Reserving
  // the taller layout up front meant the card shrank on every project without
  // a shop, which is most of them — a settled card that jumps is worse than
  // one that grows to fit something it turned out to have.
  return mode === "pay" && (shopTierCount ?? 0) > 0 ? "h-30 py-4" : "py-0";
}

/**
 * Whether the token menu should open on "$" rather than on a token.
 *
 * A wallet holding none of the tokens a project accepts cannot pay in any of them, so offering
 * one as the default asks the payer to go and acquire it before the card does anything. Their
 * own choice always wins — this only decides where the menu starts.
 */
export function defaultsToDollars({
  isConnected,
  balances,
}: {
  isConnected: boolean;
  /**
   * One balance per accepted token, undefined for one unread or failed. Empty while they are
   * still being read. An unknown balance is never "nothing".
   */
  balances: readonly (bigint | undefined)[];
}): boolean {
  if (!isConnected || balances.length === 0) return false;
  return balances.every((balance) => balance === 0n);
}

/**
 * A typed dollar amount in token units, given JBPrices' price of one dollar in that token at the
 * token's decimals. Zero for anything that is not a positive number.
 */
export function tokensForDollars(dollars: string, tokensPerDollar: bigint): bigint {
  try {
    const trimmed = dollars.trim();
    if (!trimmed || Number(trimmed) <= 0) return 0n;
    return (parseUnits(trimmed, 18) * tokensPerDollar) / 10n ** 18n;
  } catch {
    return 0n;
  }
}

/**
 * Where a picked token sits in a re-resolved list. Addresses differ across chains, so a token
 * absent by key is looked for by symbol. -1 when this list does not have it.
 */
export function pickedTokenIndex(
  tokens: readonly V6PayTokenOption[],
  key: string,
  symbol: string,
  keyOf: (token: V6PayTokenOption) => string,
): number {
  const byKey = tokens.findIndex((token) => keyOf(token) === key);
  return byKey >= 0 ? byKey : tokens.findIndex((token) => token.symbol === symbol);
}

/** What pressing the pay button does, given who is here and what they picked. */
export function payButtonAction({
  isConnected,
  payWithDollars,
}: {
  isConnected: boolean;
  payWithDollars: boolean;
}): "signIn" | "buyFirst" | "confirm" {
  if (!isConnected) return "signIn";
  // Dollars are not a token this project can be paid in; pressing Pay says so and offers the
  // purchase, rather than starting a payment that cannot settle.
  return payWithDollars ? "buyFirst" : "confirm";
}

/**
 * The ONE asset a payer should buy to pay this project.
 *
 * Not a list: "ETH or USDC" asks someone to make a choice the project has already made, and on
 * a project that takes only one of them it invites buying the half that cannot pay it. The
 * token they are already looking at wins; otherwise whichever the project accepts.
 */
export function buyableAsset({
  accepted,
  preferred,
}: {
  /** Symbols of every token the project accepts. */
  accepted: string[];
  /** The token currently selected in the pay card, if any. */
  preferred?: string;
}): "ETH" | "USDC" {
  const onRampable = ["ETH", "USDC"] as const;
  const has = (asset: string) => accepted.some((symbol) => symbol.toUpperCase() === asset);
  const chosen = onRampable.find((asset) => asset === preferred?.toUpperCase() && has(asset));
  return chosen ?? onRampable.find(has) ?? "ETH";
}
