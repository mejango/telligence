import { uniswapV4CounterpartAmount } from "@bananapus/nana-sdk-core/v6";

import { fmtUnits } from "../settlement/lib";
import { solveRangeFromAmounts, type MarketReferencePrices } from "./lib";

/**
 * "market": two single-sided positions spanning the revnet's corridor — the
 * project token sold from spot up to the issuance ceiling, the pair token
 * buying from spot down to the cash-out floor — with independent amounts.
 * "amounts": one position whose band is solved from both amounts.
 * "range": one position with a typed band; the amounts follow its ratio.
 */
export type LiquidityFormMode = "market" | "amounts" | "range";
export type LiquidityFormSide = "token" | "pair";

export interface LiquidityFormViewInputs {
  mode: LiquidityFormMode;
  tokenText: string;
  pairText: string;
  minText: string;
  maxText: string;
  /** The amount field the user touched last; the other one follows. */
  driver: LiquidityFormSide;
  price: number;
  reference: MarketReferencePrices;
  tokenSymbol: string;
  pairSymbol: string;
}

export interface LiquidityFormViewResult {
  minPrice: number | null;
  maxPrice: number | null;
  tokenAmount: number | null;
  pairAmount: number | null;
  /** The amount shown as computed rather than typed (range mode). */
  derived: LiquidityFormSide | null;
  disabled: { token: boolean; pair: boolean };
  anchor: "floor" | "ceiling" | null;
  note: string | null;
  summary: string | null;
  ready: boolean;
}

const EMPTY_VIEW: LiquidityFormViewResult = {
  minPrice: null,
  maxPrice: null,
  tokenAmount: null,
  pairAmount: null,
  derived: null,
  disabled: { token: false, pair: false },
  anchor: null,
  note: null,
  summary: null,
  ready: false,
};

const trim = (value: number) => String(Number(value.toPrecision(6)));

/** "" parses as 0 (single-sided); junk and negatives parse as NaN. */
function parseAmountText(text: string): number {
  const cleaned = text.trim();
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/**
 * The add-liquidity form's whole decision surface as one pure function, so the
 * component only binds inputs and renders. Amounts mode: both deposits are
 * typed, the range is solved around them. Range mode: the range is typed, the
 * last-touched amount drives and the counterpart follows.
 */
export function liquidityFormView(inputs: LiquidityFormViewInputs): LiquidityFormViewResult {
  const { price, tokenSymbol, pairSymbol } = inputs;
  if (!Number.isFinite(price) || price <= 0) return EMPTY_VIEW;

  if (inputs.mode === "market") {
    const floor = inputs.reference.cashOut;
    const ceiling = inputs.reference.issuance;
    if (!floor || !ceiling || !(ceiling > floor)) {
      return {
        ...EMPTY_VIEW,
        note: "This revnet has no floor and ceiling to make a market between yet. Use By amounts.",
      };
    }
    const tokenAmount = parseAmountText(inputs.tokenText);
    const pairAmount = parseAmountText(inputs.pairText);
    if (Number.isNaN(tokenAmount) || Number.isNaN(pairAmount)) {
      return { ...EMPTY_VIEW, note: "Amounts must be plain numbers." };
    }
    // Each side needs room on its half of the corridor: the token side sells
    // above spot, the pair side buys below it.
    const tokenRoom = price < ceiling;
    const pairRoom = price > floor;
    const usesToken = tokenAmount > 0 && tokenRoom;
    const usesPair = pairAmount > 0 && pairRoom;
    const disabled = { token: !tokenRoom, pair: !pairRoom };
    const shape = `${tokenSymbol} sells from the current price up to the ceiling; ${pairSymbol} buys from the current price down to the floor. Two positions, one each side of the price, so the amounts are independent and used in full.`;
    if (!usesToken && !usesPair) {
      let note = `Enter what to place on each side. ${shape}`;
      if (tokenAmount > 0 && !tokenRoom) {
        note = `The price is at or above the ceiling, so there is no room to sell ${tokenSymbol} above it. Only ${pairSymbol} can be placed right now.`;
      } else if (pairAmount > 0 && !pairRoom) {
        note = `The price is at or below the floor, so there is no room to buy with ${pairSymbol} below it. Only ${tokenSymbol} can be placed right now.`;
      }
      return { ...EMPTY_VIEW, minPrice: floor, maxPrice: ceiling, disabled, note };
    }
    return {
      minPrice: floor,
      maxPrice: ceiling,
      tokenAmount: usesToken ? tokenAmount : 0,
      pairAmount: usesPair ? pairAmount : 0,
      derived: null,
      disabled,
      anchor: null,
      note: !tokenRoom
        ? `The price is at or above the ceiling, so only the ${pairSymbol} side can be placed right now.`
        : !pairRoom
          ? `The price is at or below the floor, so only the ${tokenSymbol} side can be placed right now.`
          : shape,
      summary: null,
      ready: true,
    };
  }

  if (inputs.mode === "amounts") {
    const tokenAmount = parseAmountText(inputs.tokenText);
    const pairAmount = parseAmountText(inputs.pairText);
    if (Number.isNaN(tokenAmount) || Number.isNaN(pairAmount)) {
      return { ...EMPTY_VIEW, note: "Amounts must be plain numbers." };
    }
    if (tokenAmount === 0 && pairAmount === 0) {
      return {
        ...EMPTY_VIEW,
        note: `Enter what you want to deposit — the price range is set for you.`,
      };
    }
    const solved = solveRangeFromAmounts({
      price,
      tokenAmount,
      pairAmount,
      floorHint: inputs.reference.cashOut,
      ceilingHint: inputs.reference.issuance,
    });
    if (!solved) return { ...EMPTY_VIEW, note: "These amounts don't form a position." };

    let note: string;
    if (tokenAmount === 0) {
      note = `Only ${pairSymbol}: the position sits below the current price and buys ${tokenSymbol} as the price falls.`;
    } else if (pairAmount === 0) {
      note = `Only ${tokenSymbol}: the position sits above the current price and sells into ${pairSymbol} as the price rises.`;
    } else if (solved.anchor === "floor") {
      note =
        inputs.reference.cashOut && solved.minPrice === inputs.reference.cashOut
          ? "Floor anchored at the cash-out price — below it, cashing out beats selling."
          : "Floor set to half the current price (no cash-out floor available).";
    } else {
      note =
        inputs.reference.issuance && solved.maxPrice === inputs.reference.issuance
          ? `Your ${tokenSymbol} side needs more room than the cash-out floor allows, so the ceiling is anchored at the issuance price instead.`
          : `Your ${tokenSymbol} side needs more room than the cash-out floor allows, so the ceiling is set to twice the current price.`;
    }

    return {
      minPrice: solved.minPrice,
      maxPrice: solved.maxPrice,
      tokenAmount,
      pairAmount,
      derived: null,
      disabled: { token: false, pair: false },
      anchor: solved.anchor,
      note,
      summary: `Uses your ${trim(tokenAmount)} ${tokenSymbol} + ${trim(pairAmount)} ${pairSymbol} between ${trim(solved.minPrice)} and ${trim(solved.maxPrice)} ${pairSymbol} per ${tokenSymbol}.`,
      ready: true,
    };
  }

  const minPrice = Number(inputs.minText);
  const maxPrice = Number(inputs.maxText);
  if (
    !Number.isFinite(minPrice) ||
    !Number.isFinite(maxPrice) ||
    minPrice <= 0 ||
    maxPrice <= minPrice
  ) {
    return { ...EMPTY_VIEW, note: "Set a valid price range first." };
  }

  const tokenActive = price < maxPrice;
  const pairActive = price > minPrice;

  if (!tokenActive) {
    const pairAmount = parseAmountText(inputs.pairText);
    return {
      minPrice,
      maxPrice,
      tokenAmount: 0,
      pairAmount: Number.isNaN(pairAmount) ? null : pairAmount,
      derived: null,
      disabled: { token: true, pair: false },
      anchor: null,
      note: `This range sits below the current price, so it only takes ${pairSymbol} — it buys ${tokenSymbol} as the price falls into it.`,
      summary: null,
      ready: !Number.isNaN(pairAmount) && pairAmount > 0,
    };
  }
  if (!pairActive) {
    const tokenAmount = parseAmountText(inputs.tokenText);
    return {
      minPrice,
      maxPrice,
      tokenAmount: Number.isNaN(tokenAmount) ? null : tokenAmount,
      pairAmount: 0,
      derived: null,
      disabled: { token: false, pair: true },
      anchor: null,
      note: `This range sits above the current price, so it only takes ${tokenSymbol} — it sells into ${pairSymbol} as the price rises into it.`,
      summary: null,
      ready: !Number.isNaN(tokenAmount) && tokenAmount > 0,
    };
  }

  const driverIsPair = inputs.driver === "pair";
  const driverAmount = parseAmountText(driverIsPair ? inputs.pairText : inputs.tokenText);
  const counterpart =
    Number.isNaN(driverAmount) || driverAmount <= 0
      ? null
      : uniswapV4CounterpartAmount(driverAmount, driverIsPair, price, minPrice, maxPrice);

  return {
    minPrice,
    maxPrice,
    tokenAmount: driverIsPair ? counterpart : driverAmount,
    pairAmount: driverIsPair ? driverAmount : counterpart,
    derived: counterpart === null ? null : driverIsPair ? "token" : "pair",
    disabled: { token: false, pair: false },
    anchor: null,
    note: "Amounts are linked: the range and the current price set the ratio. Edit either amount and the other follows.",
    summary: null,
    ready: counterpart !== null && driverAmount > 0,
  };
}

/** Review copy: the amounts are the headline, the ticks are fine print. */
export function describeAddLiquidityPlan(plan: {
  tokenMaximum: bigint;
  pairMaximum: bigint;
  tickLower: number;
  tickUpper: number;
  tokenSymbol: string;
  pairSymbol: string;
  pairDecimals: number;
}): { lead: string; detail: string } {
  return {
    lead: `Adds up to ${fmtUnits(plan.tokenMaximum, 18)} ${plan.tokenSymbol} + ${fmtUnits(plan.pairMaximum, plan.pairDecimals)} ${plan.pairSymbol}.`,
    detail: `Uniswap V4 mint | ticks ${plan.tickLower} → ${plan.tickUpper}.`,
  };
}

/**
 * Plain words for a reviewed position edit: what moves between the wallet and
 * the position, what the position holds afterwards, and what the wallet
 * authorizes. `band` is the resulting band on the display axis, already
 * formatted, for a move.
 */
export function describeEditLiquidityPlan(plan: {
  kind: "increase" | "decrease" | "move" | "remove";
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  pairHolding: bigint;
  tokenHolding: bigint;
  pairFlow: bigint;
  tokenFlow: bigint;
  pairFunding: bigint;
  tokenFunding: bigint;
  pairMinimum: bigint;
  tokenMinimum: bigint;
  tokenSymbol: string;
  pairSymbol: string;
  pairDecimals: number;
  pairIsNative: boolean;
  band?: string;
}): { lead: string; detail: string; tech: string } {
  const token = (amount: bigint) => `${fmtUnits(amount, 18)} ${plan.tokenSymbol}`;
  const pair = (amount: bigint) => `${fmtUnits(amount, plan.pairDecimals)} ${plan.pairSymbol}`;
  const both = (tokenAmount: bigint, pairAmount: bigint) =>
    `${token(tokenAmount)} + ${pair(pairAmount)}`;
  const id = `#${plan.tokenId.toString()}`;
  const holds = `about ${both(plan.tokenHolding, plan.pairHolding)}`;
  const authorizing =
    plan.tokenFunding > 0n || plan.pairFunding > 0n
      ? `Your wallet authorizes up to ${[
          plan.tokenFunding > 0n ? token(plan.tokenFunding) : null,
          plan.pairFunding > 0n ? pair(plan.pairFunding) : null,
        ]
          .filter(Boolean)
          .join(" and ")} — 1% price headroom${
          plan.pairIsNative && plan.pairFunding > 0n
            ? `; unused ${plan.pairSymbol} is refunded`
            : ""
        }.`
      : null;
  const floors = `At least ${both(plan.tokenMinimum, plan.pairMinimum)} is enforced onchain (95% floors).`;
  const fees = "Unclaimed fees return to your wallet in the same transaction.";

  switch (plan.kind) {
    case "increase":
      return {
        lead: `Adds about ${both(plan.tokenFlow, plan.pairFlow)} from your wallet; position ${id} then holds ${holds}.`,
        detail: `${authorizing ?? ""} Unclaimed fees offset what your wallet pays.`.trim(),
        tech: `Uniswap V4 increase | ticks ${plan.tickLower} → ${plan.tickUpper}.`,
      };
    case "decrease":
      return {
        lead: `Frees about ${both(-plan.tokenFlow, -plan.pairFlow)} to your wallet; position ${id} keeps ${holds}.`,
        detail: `${floors} ${fees}`,
        tech: `Uniswap V4 decrease | ticks ${plan.tickLower} → ${plan.tickUpper}.`,
      };
    case "move": {
      const flows = [
        plan.tokenFlow > 0n
          ? `pulls about ${token(plan.tokenFlow)}`
          : plan.tokenFlow < 0n
            ? `gets back about ${token(-plan.tokenFlow)}`
            : null,
        plan.pairFlow > 0n
          ? `pulls about ${pair(plan.pairFlow)}`
          : plan.pairFlow < 0n
            ? `gets back about ${pair(-plan.pairFlow)}`
            : null,
      ].filter(Boolean);
      return {
        lead:
          `Burns position ${id} and mints a new one${plan.band ? ` in the ${plan.band} band` : ""} holding ${holds}.` +
          (flows.length ? ` Your wallet ${flows.join(" and ")}.` : ""),
        detail: `${authorizing ? `${authorizing} ` : ""}The burn funds the mint inside one transaction; ${floors.charAt(0).toLowerCase()}${floors.slice(1)} ${fees}`,
        tech: `Uniswap V4 burn + mint | ticks ${plan.tickLower} → ${plan.tickUpper}.`,
      };
    }
    case "remove":
      return {
        lead: `Burns position ${id} and returns everything it holds — about ${both(-plan.tokenFlow, -plan.pairFlow)} — to your wallet.`,
        detail: `${floors} ${fees}`,
        tech: "Uniswap V4 burn + take.",
      };
  }
}
