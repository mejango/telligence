import { PayEventRatesOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { getViemPublicClient, type transports } from "@/lib/wagmiTransports";
import {
  jbContractAddress,
  JBCoreContracts,
  jbPricesAbi,
  NATIVE_TOKEN,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { BASE_CURRENCY_ETH, BASE_CURRENCY_USD, tokenCurrencyId } from "@bananapus/nana-sdk-core/v6";
import type { Address } from "viem";

/**
 * PRICE-CHART AXIS — canonical semantics, shared by every webclient.
 *
 * The axis unit is the ruleset's `baseCurrency`. That is what the project denominates
 * issuance in and what the protocol itself prices against: `JBTerminalStore` converts every
 * payment into `ruleset.baseCurrency()` before applying the weight
 * (`tokenCount = amount * weight / weightRatio`, JBTerminalStore.sol:1165-1175), and
 * `JBBuybackHook` repeats the same conversion when choosing mint-vs-swap
 * (JBBuybackHook.sol:1153-1164). It is also the only unit in which the issuance line is
 * EXACT, since issuance is `1 / weight` with no feed involved.
 *
 * Series and their native units:
 *   issuance ceiling (1/weight) → already base currency per token. NO conversion.
 *   AMM / pool price           → accounting (terminal) token per project token.
 *   cash-out floor + minimum   → accounting token per project token (balance ÷ supply).
 *
 * The last two are multiplied by `basePerAccountingToken` to reach the axis.
 *
 * Two rate sources, in preference order:
 *  1. `JBPrices` — the protocol's OWN feed, the one the terminal consults on every payment.
 *     Authoritative but current-only, so it restates history when the pair actually floats.
 *  2. Pay-event ratios from the indexer — per-timestamp, so history stays history, but only
 *     usable where the indexer values the accounting token (see below).
 *
 * Historical points prefer (2) and fall back to (1). NEVER fabricate a rate: if neither
 * source has one the series is omitted and the UI says so. A missing line is honest, a
 * wrongly denominated one is not — but a line withheld while the protocol itself has the
 * rate on chain is just a gap, which is why (1) is consulted for every off-axis project.
 */

/**
 * NOTE: these axis predicates live here, not beside the chart loader, because that module
 * carries "use server" — every export from a Server Actions module must be an async
 * function, so a synchronous helper there fails `next build` (and only `next build`:
 * tsc and vitest both accept it).
 */
/**
 * Is the accounting token already the axis unit?
 *
 * The axis is the ruleset's `baseCurrency` (see lib/baseCurrencyRate.ts for the full
 * contract). When the accounting token IS that currency — a token-keyed base currency, or
 * ETH against a native terminal — the AMM and cash-out series are already on-axis and no
 * rate is needed. `JBPrices.pricePerUnitOf` returns exactly 1e18 for that case too.
 */
export function accountingIsAxisUnit(
  baseCurrency: number | undefined,
  accountingToken: string,
): boolean {
  if (baseCurrency === undefined) return false;
  if (baseCurrency === tokenCurrencyId(accountingToken as Address)) return true;
  return (
    baseCurrency === BASE_CURRENCY_ETH &&
    accountingToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
  );
}

/** Does this base currency price things in USD? Only then is the payEvent ratio the rate. */
export function baseIsUsd(baseCurrency: number | undefined): boolean {
  return baseCurrency === BASE_CURRENCY_USD;
}

/** A per-timestamp rate: base-currency units per ONE accounting token. */
export type BaseRatePoint = { timestamp: number; rate: number };

/**
 * Rates derived from the project's own pay events.
 *
 * `payEvent` records both `amount` (accounting token) and `amountUsd` (18-dec USD at the
 * time), so their ratio is USD per accounting token AT THAT TIMESTAMP — the historical rate
 * the live `JBPrices` feed cannot give, because it only prices now.
 *
 * Two caveats this function enforces, both learned from live data:
 *  - `amountUsd` is unreliable for non-ETH accounting tokens (a live 20 USDC payment reported
 *    `amountUsd: 0`), so any point with a zero on either side is DROPPED rather than trusted.
 *  - the result is the INDEXER's valuation, not the JBPrices feed the terminal actually used,
 *    so a converted series is an approximation and must be labelled as one.
 */
export function usdPerAccountingTokenFrom(
  payEvents: readonly { timestamp: number; amount: string; amountUsd: string }[],
  accountingDecimals: number,
): BaseRatePoint[] {
  const points: BaseRatePoint[] = [];
  for (const event of payEvents) {
    const amount = Number(event.amount);
    const amountUsd = Number(event.amountUsd);
    // A zero on either side is missing data, not a real rate of zero.
    if (!(amount > 0) || !(amountUsd > 0)) continue;
    const tokens = amount / 10 ** accountingDecimals;
    const usd = amountUsd / 1e18;
    const rate = usd / tokens;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    points.push({ timestamp: event.timestamp, rate });
  }
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The rate in force at `timestamp`: the nearest EARLIER observation, carried forward.
 *
 * Payments are sparse, so a rate holds until the next one is observed. Nothing is carried
 * BACKWARD — a price from after the fact would restate history, which is the very error this
 * whole module exists to avoid. Returns null before the first observation.
 */
export function rateAt(points: readonly BaseRatePoint[], timestamp: number): number | null {
  let rate: number | null = null;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    rate = point.rate;
  }
  return rate;
}

/** Convert an accounting-token-denominated value onto the base-currency axis. */
export function toBaseAxis(value: number | undefined, rate: number | null): number | undefined {
  if (value === undefined) return undefined;
  if (rate === null) return undefined; // no rate ⇒ omit the point, never guess
  return value * rate;
}

/** Pay events for a project, oldest first, for historical rate derivation. */
export async function fetchPayEventRates(
  chainId: JBChainId,
  projectId: number,
  accountingDecimals: number,
): Promise<BaseRatePoint[]> {
  try {
    const data = await queryBendystraw(chainId, PayEventRatesOperation, {
      where: { projectId, chainId: Number(chainId), version: 6 },
      limit: 500,
      offset: 0,
    });
    return usdPerAccountingTokenFrom(data.payEvents?.items ?? [], accountingDecimals);
  } catch {
    return [];
  }
}

/**
 * The live rate from `JBPrices`: base-currency units per ONE accounting token.
 *
 * `pricePerUnitOf` is documented as "the `pricingCurrency` price of one `unitCurrency`"
 * (JBPrices.sol:217-225), so pricing in the BASE currency a unit of the ACCOUNTING currency
 * is exactly the factor the axis needs — and it is the same feed `JBTerminalStore` uses to
 * build `weightRatio` on every payment (JBTerminalStore.sol:1165-1172). Identical currencies
 * short-circuit to 1e18 on chain (`:238`).
 *
 * Only registered PAIRS resolve; `JBPrices_PriceFeedNotFound` reverts otherwise. Deployments
 * register legs against USD rather than a full mesh (Base has USD↔USDC and USD↔ETH but no
 * ETH↔USDC), so a missing direct pair is retried as two legs through USD.
 *
 * Returns null when no leg resolves or the read fails — the caller must not invent one.
 */
export async function fetchLiveBasePerAccountingToken(
  chainId: JBChainId,
  projectId: number,
  baseCurrency: number | undefined,
  accountingToken: string,
): Promise<number | null> {
  if (baseCurrency === undefined) return null;
  const accountingCurrency = tokenCurrencyId(accountingToken as Address);
  if (baseCurrency === accountingCurrency) return 1;
  const prices = jbContractAddress["6"]?.[JBCoreContracts.JBPrices]?.[chainId];
  if (!prices) return null;

  const client = getViemPublicClient(chainId as keyof typeof transports);
  const priceOf = (pricingCurrency: number, unitCurrency: number) =>
    client
      .readContract({
        address: prices,
        abi: jbPricesAbi,
        functionName: "pricePerUnitOf",
        args: [BigInt(projectId), BigInt(pricingCurrency), BigInt(unitCurrency), 18n],
      })
      .then((price) => Number(price) / 1e18)
      .catch(() => null);

  const finite = (rate: number | null) =>
    rate !== null && Number.isFinite(rate) && rate > 0 ? rate : null;

  const direct = finite(await priceOf(baseCurrency, accountingCurrency));
  if (direct !== null) return direct;

  // Two legs through USD: (base per USD) × (USD per accounting token).
  const [basePerUsd, usdPerAccounting] = await Promise.all([
    priceOf(baseCurrency, BASE_CURRENCY_USD),
    priceOf(BASE_CURRENCY_USD, accountingCurrency),
  ]);
  if (basePerUsd === null || usdPerAccounting === null) return null;
  return finite(basePerUsd * usdPerAccounting);
}

/**
 * The indexer's 18-dec rate as a plain number, or null where the row predates the backfill or
 * no feed bridged the pair — both meaning "use the live rate for this point".
 */
export function usdRateOf(raw: string | number | bigint | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const rate = Number(raw) / 1e18;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
