import type { Project } from "@/lib/bendystraw/types";
import { formatTokenAmount } from "@/lib/token";

type BalanceDeployment = Pick<Project, "balance" | "decimals" | "tokenSymbol">;

type BalanceBucket = {
  symbol: string;
  decimals: number;
  amount: bigint;
};

export function projectPreviewSlogan(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = value
      ?.replace(/<br\s*\/?>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&amp;/gu, "&")
      .replace(/&quot;/gu, '"')
      .replace(/&#39;|&apos;/gu, "'")
      .replace(/&nbsp;/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (text) return text.slice(0, 240);
  }
  return null;
}

/** Keep unlike treasury assets separate instead of presenting a fake total. */
export function formatProjectPreviewBalance(deployments: readonly BalanceDeployment[]): string {
  const buckets = new Map<string, BalanceBucket>();
  for (const deployment of deployments) {
    const symbol = deployment.tokenSymbol?.trim();
    const decimals = deployment.decimals;
    if (!symbol || decimals == null || !Number.isSafeInteger(decimals) || decimals < 0) continue;
    try {
      const key = `${symbol.toUpperCase()}:${decimals}`;
      const current = buckets.get(key);
      buckets.set(key, {
        symbol,
        decimals,
        amount: (current?.amount ?? 0n) + BigInt(deployment.balance || 0),
      });
    } catch {
      // An invalid indexer value is unknown, not zero.
    }
  }

  const values = [...buckets.values()]
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((bucket) => `${formatTokenAmount(bucket.amount, bucket)} ${bucket.symbol}`);
  if (!values.length) return "Unavailable";
  if (values.length <= 2) return values.join(" + ");
  return `${values.slice(0, 2).join(" + ")} + ${values.length - 2} more`;
}
