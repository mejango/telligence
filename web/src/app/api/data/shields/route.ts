import { ShieldGroupOperation, ShieldProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { fetchEthPrice } from "@/lib/ethPrice";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { NextResponse } from "next/server";

type ChainId = 1 | 10 | 8453 | 42161;

const JB_CHAINS: Record<ChainId, { name: string }> = {
  1: { name: "Ethereum" },
  10: { name: "Optimism" },
  8453: { name: "Base" },
  42161: { name: "Arbitrum" },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = parseInt(searchParams.get("projectId") ?? "");

  const chainIdParam = searchParams.get("chainId");
  const parsedChainId = chainIdParam ? Number(chainIdParam) : undefined;
  if (parsedChainId !== undefined && !(parsedChainId in JB_CHAINS)) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }
  const chainIds: ChainId[] =
    parsedChainId !== undefined
      ? [parsedChainId as ChainId]
      : (Object.keys(JB_CHAINS).map(Number) as ChainId[]);

  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Missing or invalid projectId" }, { status: 400 });
  }

  let totalBalance = 0;
  // The accounting token(s) the summed balance is denominated in. A badge may only
  // claim ETH — or convert at an ETH rate — when every context really is native.
  const accountingTokens = new Set<string>();
  const accountingSymbols = new Set<string>();
  const results = [];
  let projectName = "Revnet"; // default fallback
  const visitedGroups = new Set<string>();

  for (const chainId of chainIds) {
    try {
      const project = await queryBendystraw(chainId, ShieldProjectOperation, {
        chainId,
        projectId,
      });
      const suckerGroupId = project.project?.suckerGroupId;
      if (!suckerGroupId) {
        return NextResponse.json({ error: "Project not found on BendyStraw" }, { status: 404 });
      }
      if (visitedGroups.has(suckerGroupId)) continue;
      visitedGroups.add(suckerGroupId);

      const surplus = await queryBendystraw(chainId, ShieldGroupOperation, { id: suckerGroupId });
      const items = surplus.suckerGroup?.projects?.items ?? [];

      projectName = items[0]?.name ?? projectName;
      for (const item of items) {
        // `balance` is in the ACCOUNTING token's own decimals — 6 for a USDC revnet,
        // not 18. Dividing by 1e18 unconditionally reports a USDC treasury as ~1e-12
        // of its real size, and then prices that as ETH.
        const itemBalance = Number(item.balance ?? 0) / 10 ** (item.decimals ?? 18);
        totalBalance += itemBalance;
        if (item.token) accountingTokens.add(item.token.toLowerCase());
        if (item.tokenSymbol) accountingSymbols.add(item.tokenSymbol);

        results.push({
          chainId: item.chainId,
          balance: itemBalance,
          supporters: item.participants?.totalCount ?? 0,
          name: JB_CHAINS[item.chainId as ChainId]?.name ?? "Unknown",
          metadata: item.metadata,
          participants: item.participants?.items ?? [],
          // The list is capped; `supporters` above is the true count. Without this flag a
          // consumer reading `participants` has no way to tell a complete list from a page of
          // one — and this payload is public.
          participantsTruncated:
            (item.participants?.items?.length ?? 0) < (item.participants?.totalCount ?? 0),
        });
      }
    } catch {
      return NextResponse.json({ error: "Error fetching data" }, { status: 500 });
    }
  }

  // Only a native-token treasury may be priced with an ETH quote. A USDC (or any
  // other ERC-20) context has no ETH rate here, and multiplying by one would invent
  // a number; the badge reports the token amount alone in that case.
  const isNativeTreasury =
    accountingTokens.size === 1 && [...accountingTokens][0] === NATIVE_TOKEN.toLowerCase();
  const denomination = accountingSymbols.size === 1 ? [...accountingSymbols][0] : "tokens";

  // This badge is embedded off-site, so a price outage must not publish a number. Null here
  // falls through to the token-amount label below — the same path a non-native treasury takes
  // — rather than reporting a $0 treasury to every README that renders it.
  const ethPrice = isNativeTreasury ? await fetchEthPrice() : null;
  const usdTvl = ethPrice === null ? null : totalBalance * ethPrice;

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Missing host header" }, { status: 500 });
  }
  const publicBase = `https://${host}`;
  const publicUrl = `${publicBase}/api/data/shields?projectId=${projectId}${chainIds.length === 1 ? `&chainId=${chainIds[0]}` : ""}`;
  const badgeUrl = `https://img.shields.io/badge/dynamic/json?url=${encodeURIComponent(publicUrl)}&query=%24.message&label=${encodeURIComponent(projectName)}&cacheSeconds=3600`;

  const markdown = `[![revnet badge](${badgeUrl})](${publicBase}/base:${projectId})`;

  const balanceLabel = `${totalBalance.toFixed(4)} ${denomination}`;
  return NextResponse.json({
    label: "Current value",
    message:
      usdTvl !== null
        ? `${usdTvl.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD • ${balanceLabel}`
        : balanceLabel,
    tvlUsd: usdTvl,
    /** The treasury in its accounting token — named by `denomination`, not always ETH. */
    tvlBalance: totalBalance,
    denomination,
    color: totalBalance > 1 ? "green" : totalBalance > 0.1 ? "yellow" : "red",
    chains: results,
    badgeUrl,
    markdown,
  });
}
