/**
 * Keep ordinary percentages compact while ensuring a non-zero value is never
 * presented as 0%. Small issuance cuts need more than two decimal places.
 */
export function formatAdaptivePercent(percent: number): string {
  if (!Number.isFinite(percent) || percent === 0) return "0";

  const magnitude = Math.abs(percent);
  const decimals =
    magnitude >= 0.01 ? 2 : Math.min(8, Math.max(2, Math.ceil(-Math.log10(magnitude)) + 3));

  return percent.toFixed(decimals).replace(/\.?0+$/, "");
}
