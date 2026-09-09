"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { ProjectLink } from "@/components/ProjectLink";
import { SkeletonLines } from "@/components/ui/skeleton";
import {
  useCompleteAccountTokenBalances,
  useCompleteProjectsByRefs,
  useCompleteProjectTickersByRefs,
} from "@/hooks/useCompleteBendystrawLists";
import { projectRefKey, projectRefsWheres } from "@/lib/accountHoldings";
import type { AccountTokenBalanceRow, OwnedProjectRow } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { slugFor } from "@/lib/slug";
import { formatTokenSymbol } from "@/lib/utils";
import { formatUnits, JB_CHAINS } from "@bananapus/nana-sdk-core";
import { useMemo } from "react";
import type { Address } from "viem";

export type HoldingRow = AccountTokenBalanceRow & {
  project: OwnedProjectRow | undefined;
  /** The project ERC-20's ticker — NOT the accounting context's tokenSymbol. */
  ticker: string | undefined;
};

export type HoldingGroup = {
  key: string;
  name: string;
  /** The project route for the group; every row is v6 so this always resolves. */
  slug: string | undefined;
  /** Balance denomination: the project ERC-20 ticker, or "tokens" when absent. */
  symbol: string;
  total: bigint;
  rows: HoldingRow[];
};

/**
 * Group balances by project across chains (sucker group when the indexer
 * knows it), biggest first. Balances are denominated in the project's own
 * ERC-20 ticker — the project row's tokenSymbol names the ACCOUNTING
 * context's token (what the project is paid in) and must never label them.
 */
export function groupHoldings(rows: HoldingRow[]): HoldingGroup[] {
  const groups = new Map<string, HoldingGroup>();
  for (const row of rows) {
    const key = row.project?.suckerGroupId ?? `${row.chainId}:${row.projectId}`;
    const group = groups.get(key) ?? {
      key,
      name: `Project #${row.projectId}`,
      slug: undefined,
      symbol: "tokens",
      total: 0n,
      rows: [],
    };
    if (row.project?.name || row.project?.handle) {
      group.name = row.project.name ?? row.project.handle ?? group.name;
    }
    if (row.ticker && group.symbol === "tokens") group.symbol = formatTokenSymbol(row.ticker);
    group.slug ??= slugFor(row.chainId, row.projectId);
    group.total += BigInt(row.balance);
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => a.chainId - b.chainId),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

export function TokenHoldings({ address }: { address: Address }) {
  const balancesQuery = useCompleteAccountTokenBalances(address.toLowerCase());

  const holdings = useMemo(
    () =>
      (balancesQuery.data ?? []).filter(
        (row) => !!JB_CHAINS[row.chainId as JBChainId] && BigInt(row.balance) > 0n,
      ),
    [balancesQuery.data],
  );

  // Name/sucker-group lookup and ERC-20 ticker lookup for the held refs.
  const refsWheres = useMemo(() => projectRefsWheres(holdings), [holdings]);
  const projectsQuery = useCompleteProjectsByRefs(refsWheres, refsWheres.length > 0);
  const tickersQuery = useCompleteProjectTickersByRefs(refsWheres, refsWheres.length > 0);
  const projectByRef = useMemo(() => {
    const map = new Map<string, OwnedProjectRow>();
    for (const project of projectsQuery.data ?? []) {
      map.set(projectRefKey(project), project);
    }
    return map;
  }, [projectsQuery.data]);
  const tickerByDeployment = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of tickersQuery.data ?? []) {
      map.set(`${event.chainId}:${event.projectId}`, event.symbol);
    }
    return map;
  }, [tickersQuery.data]);

  const groups = useMemo(
    () =>
      groupHoldings(
        holdings.map((row) => ({
          ...row,
          project: projectByRef.get(projectRefKey(row)),
          ticker: tickerByDeployment.get(`${row.chainId}:${row.projectId}`),
        })),
      ),
    [holdings, projectByRef, tickerByDeployment],
  );

  const isLoading = balancesQuery.isLoading || (holdings.length > 0 && projectsQuery.isLoading);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Tokens</h2>
      {isLoading ? (
        <SkeletonLines lines={3} className="mt-3" />
      ) : balancesQuery.isError ? (
        <p className="text-sm text-zinc-500">Could not read token balances.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-zinc-500">This account holds no project tokens.</p>
      ) : (
        <>
          <div className="divide-y divide-melon-200 bg-melon-50 px-4">
            {groups.map((group) => (
              <div key={group.key} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {group.slug ? (
                    <ProjectLink
                      href={`/${group.slug}`}
                      projectHint={{ name: group.name, logoUri: null, ticker: group.symbol }}
                      className="text-sm font-medium hover:underline"
                    >
                      {group.name}
                    </ProjectLink>
                  ) : (
                    <span className="text-sm font-medium">{group.name}</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {group.rows.map((row) => {
                    const credits = BigInt(row.creditBalance ?? 0);
                    const claimed = BigInt(row.erc20Balance ?? 0);
                    return (
                      <div
                        key={`${row.chainId}:${row.projectId}`}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="flex items-center gap-2 text-xs text-zinc-500">
                          <ChainLogo chainId={row.chainId as JBChainId} width={16} height={16} />
                          {JB_CHAINS[row.chainId as JBChainId]?.name ?? `Chain ${row.chainId}`}
                        </span>
                        <span className="text-right">
                          <span className="tabular-nums text-zinc-800">
                            {formatUnits(BigInt(row.balance), 18, { fractionDigits: 5 })}{" "}
                            {group.symbol}
                          </span>
                          {credits > 0n ? (
                            <span className="block text-[11px] tabular-nums text-zinc-500">
                              {formatUnits(claimed, 18, { fractionDigits: 5 })} claimed |{" "}
                              {formatUnits(credits, 18, { fractionDigits: 5 })} credits
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
