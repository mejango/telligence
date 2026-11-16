import { formatUsd, usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import type { Project, ProjectTokenBalance } from "@/lib/bendystraw/types";
import { formatTokenAmount } from "@/lib/token";
import { getTokenSymbolFromAddress, tokenKindOf } from "@/lib/tokenUtils";

type BalanceDeployment = Pick<Project, "balance" | "decimals" | "tokenSymbol"> & {
  chainId?: number | null;
  token?: string | null;
  projectTokenBalances?: { items: ProjectTokenBalance[] } | null;
};

/**
 * What one deployment holds, one row per token in that token's own units. The raw
 * `balance` (which adds unlike units once a project accepts several tokens) is read only
 * when the indexer served no per-token rows.
 */
export function deploymentTokenBalances(deployment: BalanceDeployment): Array<
  Pick<Project, "balance" | "decimals" | "tokenSymbol"> &
    Pick<Partial<ProjectTokenBalance>, "token" | "balanceUsd" | "usdRate"> & {
      chainId?: number | null;
    }
> {
  const rows = deployment.projectTokenBalances?.items;
  if (!rows?.length) {
    const { token } = deployment;
    return [
      {
        ...deployment,
        token: token ?? undefined,
        tokenSymbol: token ? tokenSymbolOf({ ...deployment, token }) : deployment.tokenSymbol,
      },
    ];
  }
  return rows.map((row) => ({
    ...row,
    chainId: deployment.chainId,
    tokenSymbol: tokenSymbolOf(row),
  }));
}

/** A per-token row's symbol: the indexer's, else a token this app knows, else null. */
export function tokenSymbolOf(row: Pick<ProjectTokenBalance, "token" | "tokenSymbol">) {
  if (row.tokenSymbol) return row.tokenSymbol;
  const known = getTokenSymbolFromAddress(row.token);
  return known === "TOKEN" ? null : known;
}

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
  // Holdings in a token whose symbol is unreadable are shown in USD.
  let unnamedUsd = 0;
  for (const deployment of deployments.flatMap(deploymentTokenBalances)) {
    const symbol = deployment.tokenSymbol?.trim();
    const decimals = deployment.decimals;
    if (!symbol) {
      const usd = usdFromScaled(deployment.balanceUsd);
      if (usd === null) return "Unavailable";
      unnamedUsd += usd;
      continue;
    }
    if (decimals == null || !Number.isSafeInteger(decimals) || decimals < 0) return "Unavailable";
    try {
      if (deployment.balance == null || deployment.balance === "") return "Unavailable";
      const key = tokenKindOf(deployment);
      const current = buckets.get(key);
      buckets.set(key, {
        symbol,
        decimals,
        amount: (current?.amount ?? 0n) + BigInt(deployment.balance),
      });
    } catch {
      // An invalid indexer value cannot establish a complete treasury total.
      return "Unavailable";
    }
  }

  // A token the project no longer holds is noise beside one it does.
  const held = [...buckets.values()].filter((bucket) => bucket.amount > 0n);
  const values = (held.length || unnamedUsd > 0 ? held : [...buckets.values()])
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((bucket) => `${formatTokenAmount(bucket.amount, bucket)} ${bucket.symbol}`)
    .concat(unnamedUsd > 0 ? [formatUsd(unnamedUsd)] : []);
  if (!values.length) return "Unavailable";
  if (values.length <= 2) return values.join(" + ");
  return `${values.slice(0, 2).join(" + ")} + ${values.length - 2} more`;
}
