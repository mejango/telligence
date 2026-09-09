export function formatDecimals(value: number, maxDecimals: number = 6): string {
  return parseFloat(value.toFixed(maxDecimals)).toString();
}

export function commaNumber(value: string | number): string {
  const numStr = value.toString();
  const parts = numStr.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/**
 * Abbreviate for display. Delegates to {@link formatCompact} — this used to round to whole
 * units (`.toFixed()` with no argument), so 1,234,567 and 1,900,000 both rendered "1M", and
 * its `.replace(/\.00$/)` could never match because there was no decimal point left to trim.
 * ALWAYS pair with {@link exactNumber} in a title.
 */
export function prettyNumber(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return formatCompact(num, 2);
}

/**
 * NUMBER PRESENTATION POLICY — shared across every webclient surface.
 *
 * Precision is never lost, only FOLDED: any abbreviated or truncated number carries its
 * exact value in a `title` so one hover unfolds it (no delay — the browser default).
 *
 *  - Dense lists (activity feeds, tables, leaderboards) abbreviate to 3 SIGNIFICANT
 *    figures with a k/M/B ladder: 1.23M, 12.3k, 123k. Never 0-decimal — "12k" throws away
 *    an order of magnitude that "12.3k" reads just as fast.
 *  - Anything the user is about to ACT on — confirm modals, inputs and their derived
 *    previews, cash-out and payout quotes — is never abbreviated.
 *  - USD keeps cents below $1,000 and drops them above; a real amount under a cent shows
 *    as `<$0.01`, never `$0.00`, because rounding a payment to zero reads as "nothing
 *    happened".
 *  - Do the arithmetic in BigInt and format only at the edge.
 */

/** Decimals needed to show `scaled` (always < 1000) to three significant figures. */
function sigFigDecimals(scaled: number): number {
  const magnitude = Math.abs(scaled);
  if (magnitude >= 100) return 0;
  if (magnitude >= 10) return 1;
  return 2;
}

/**
 * Abbreviate for a dense list: three significant figures with a k/M/B suffix.
 * Values below 1,000 keep up to `maxDecimals` and are never suffixed.
 * ALWAYS pair with `exactNumber()` in a title.
 */
export function formatCompact(value: string | number, maxDecimals: number = 4): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "0";
  const sign = num < 0 ? "-" : "";
  const magnitude = Math.abs(num);
  for (const [threshold, suffix] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const) {
    if (magnitude >= threshold) {
      const scaled = magnitude / threshold;
      return `${sign}${trimZeros(scaled.toFixed(sigFigDecimals(scaled)))}${suffix}`;
    }
  }
  if (magnitude === 0) return "0";
  const fixed = trimZeros(magnitude.toFixed(maxDecimals));
  // A real amount never reads as nothing: below the decimal budget, show its
  // first significant figure instead of rounding to 0.
  if (fixed === "0")
    return `${sign}${trimZeros(magnitude.toFixed(Math.ceil(-Math.log10(magnitude))))}`;
  return `${sign}${fixed}`;
}

/** The unabbreviated value, grouped — what a hover reveals. */
export function exactNumber(value: string | number, maxDecimals: number = 18): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return String(value);
  return commaNumber(trimZeros(num.toFixed(maxDecimals)));
}

function trimZeros(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
