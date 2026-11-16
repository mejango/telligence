import { usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import { ShieldGroupOperation, ShieldProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ShieldGroupQuery } from "@/lib/bendystraw/types";
import {
  deploymentTokenBalances,
  formatProjectPreviewBalance,
  tokenSymbolOf,
} from "@/lib/project-link-preview";
import { slugFor } from "@/lib/slug";
import { tokenKindOf } from "@/lib/tokenUtils";
import { NextResponse } from "next/server";
import { formatUnits } from "viem";

type ChainId = 1 | 10 | 8453 | 42161;
type ShieldDeployment = NonNullable<
  NonNullable<ShieldGroupQuery["suckerGroup"]>["projects"]
>["items"][number];

type Denomination = {
  chainId: number;
  token: string | null;
  tokenSymbol: string | null;
  decimals: number;
};

/**
 * The deployments' holdings in one token: rows of that token as held, any other token
 * converted through its latest USD rate. A token with no USD rate (or a denomination with
 * none, for the others) cannot be converted, so it is left out and named in `excluded`.
 * The denomination's rate comes from `group`, so one chain's total can use another's.
 * Null when the denomination itself is unknown.
 */
function treasuryIn(
  denomination: Denomination | null,
  deployments: readonly ShieldDeployment[],
  group: readonly ShieldDeployment[] = deployments,
) {
  if (!denomination?.tokenSymbol) return null;
  const kind = tokenKindOf(denomination);
  const rows = deployments.flatMap(deploymentTokenBalances);
  const rateOf = (row: (typeof rows)[number]) => {
    try {
      const rate = row.usdRate == null ? 0n : BigInt(row.usdRate);
      return rate > 0n ? Number(formatUnits(rate, 18)) : null;
    } catch {
      return null;
    }
  };
  const denominationUsd =
    group
      .flatMap(deploymentTokenBalances)
      .filter((row) => tokenKindOf(row) === kind)
      .map(rateOf)
      .find((r) => r !== null) ?? null;

  let amount = 0;
  let unreadAmount = false;
  // By kind, so two tokens sharing a symbol are both named.
  const excluded = new Map<string, { token: string | null; tokenSymbol: string | null }>();
  for (const row of rows) {
    const exclude = () =>
      excluded.set(tokenKindOf(row), {
        token: row.token ?? null,
        tokenSymbol: row.tokenSymbol ?? null,
      });
    let held: number;
    try {
      held =
        row.decimals == null || row.balance == null || row.balance === ""
          ? NaN
          : Number(formatUnits(BigInt(row.balance), row.decimals));
    } catch {
      held = NaN;
    }
    // An unreadable amount is unknown, not zero.
    if (!Number.isFinite(held)) {
      unreadAmount = true;
      exclude();
      continue;
    }
    if (!(held > 0)) continue;
    if (tokenKindOf(row) === kind) amount += held;
    else {
      const usd = rateOf(row);
      if (usd !== null && denominationUsd !== null) amount += (held * usd) / denominationUsd;
      else exclude();
    }
  }
  return { amount: unreadAmount ? null : amount, excluded: [...excluded.values()] };
}

const JB_CHAINS: Record<ChainId, { name: string }> = {
  1: { name: "Ethereum" },
  10: { name: "Optimism" },
  8453: { name: "Base" },
  42161: { name: "Arbitrum" },
};

/** Each token one deployment holds, in its own units, for consumers that need more than the label. */
function tokenBalances(deployment: ShieldDeployment) {
  return deploymentTokenBalances(deployment).flatMap((row) => {
    if (!row.token) return [];
    let balance: number | null = null;
    try {
      // Without decimals the units are unknown: the row stays, with its USD value.
      if (row.decimals != null) balance = Number(formatUnits(BigInt(row.balance), row.decimals));
    } catch {
      balance = null;
    }
    return [
      {
        token: row.token,
        tokenSymbol: row.tokenSymbol ?? null,
        balance,
        balanceUsd: usdFromScaled(row.balanceUsd),
      },
    ];
  });
}

// The badge links to this chain's project page when no chainId is given.
const DEFAULT_CHAIN_ID: ChainId = 8453;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = parseInt(searchParams.get("projectId") ?? "");

  const chainIdParam = searchParams.get("chainId");
  const chainId = chainIdParam ? Number(chainIdParam) : DEFAULT_CHAIN_ID;
  if (!(chainId in JB_CHAINS)) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Missing or invalid projectId" }, { status: 400 });
  }

  // One project: its sucker group already spans every chain it is deployed on. The same
  // project number on another chain is usually a different project.
  let items: ShieldDeployment[];
  let totalUsd: number | null;
  try {
    const project = await queryBendystraw(chainId, ShieldProjectOperation, { chainId, projectId });
    const suckerGroupId = project.project?.suckerGroupId;
    if (!suckerGroupId) {
      return NextResponse.json({ error: "Project not found on BendyStraw" }, { status: 404 });
    }
    const group = await queryBendystraw(chainId, ShieldGroupOperation, { id: suckerGroupId });
    items = group.suckerGroup?.projects?.items ?? [];
    totalUsd = usdFromScaled(group.suckerGroup?.balanceUsd);
  } catch {
    return NextResponse.json({ error: "Error fetching data" }, { status: 500 });
  }

  const projectName = items[0]?.name ?? "Revnet";
  // Totals are in the badged project's own accounting token.
  const badged = items.find((item) => item.chainId === chainId) ?? items[0];
  const badgedSymbol = badged?.token
    ? tokenSymbolOf({ token: badged.token, tokenSymbol: badged.tokenSymbol })
    : badged?.tokenSymbol;
  const denomination =
    badgedSymbol && badged.decimals != null
      ? {
          chainId: badged.chainId,
          token: badged.token ?? null,
          tokenSymbol: badgedSymbol,
          decimals: badged.decimals,
        }
      : null;
  const results = items.map((item) => ({
    chainId: item.chainId,
    balance: treasuryIn(denomination, [item], items)?.amount ?? null,
    balances: tokenBalances(item),
    supporters: item.participants?.totalCount ?? 0,
    name: JB_CHAINS[item.chainId as ChainId]?.name ?? "Unknown",
    metadata: item.metadata,
    participants: item.participants?.items ?? [],
    // The list is capped; `supporters` above is the true count. Without this flag a
    // consumer reading `participants` has no way to tell a complete list from a page of
    // one — and this payload is public.
    participantsTruncated:
      (item.participants?.items?.length ?? 0) < (item.participants?.totalCount ?? 0),
  }));

  const treasury = treasuryIn(denomination, items);

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Missing host header" }, { status: 500 });
  }
  const publicBase = `https://${host}`;
  const publicUrl = `${publicBase}/api/data/shields?projectId=${projectId}&chainId=${chainId}`;
  // Shields' endpoint badge reads label, message and color from `format=endpoint`; the
  // dynamic JSON badge (older READMEs) reads only `message` and keeps working.
  const badgeUrl = `https://img.shields.io/endpoint?url=${encodeURIComponent(`${publicUrl}&format=endpoint`)}`;
  const slug = slugFor(chainId, projectId);
  const markdown = `[![revnet badge](${badgeUrl})](${slug ? `${publicBase}/${slug}` : publicBase})`;

  const balanceLabel = formatProjectPreviewBalance(items);
  const message =
    totalUsd !== null
      ? `${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD, ${balanceLabel}`
      : balanceLabel;
  const color = badgeColor(totalUsd);
  if (searchParams.get("format") === "endpoint") {
    // Exactly Shields' endpoint schema, which rejects other keys.
    return NextResponse.json({
      schemaVersion: 1,
      label: projectName,
      message,
      color,
      cacheSeconds: 3600,
    });
  }
  return NextResponse.json({
    label: "Current value",
    message,
    tvlUsd: totalUsd,
    /**
     * The treasury in `denomination`, other tokens converted at their latest USD rate.
     * Tokens with no rate are left out and listed in `tvlExcludedTokens`.
     */
    tvlBalance: treasury?.amount ?? null,
    denomination: denomination?.tokenSymbol ?? "tokens",
    tvlExcludedTokens: treasury?.excluded ?? [],
    color,
    chains: results,
    badgeUrl,
    markdown,
  });
}

/**
 * Green, yellow or red by the treasury's USD value, so every token is judged on one scale;
 * grey when the indexer has not priced it. ponytail: thresholds are round numbers, not tuned.
 */
function badgeColor(usd: number | null) {
  if (usd === null) return "lightgrey";
  return usd >= 1000 ? "green" : usd >= 100 ? "yellow" : "red";
}
