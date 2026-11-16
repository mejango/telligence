"use client";

import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHydrated } from "@/hooks/useHydrated";
import type { Project } from "@/lib/bendystraw/types";
import { PERSIST } from "@/lib/query-persist";
import { formatTokenAmount } from "@/lib/token";
import { cn } from "@/lib/utils";
import {
  getJBContractAddress,
  JBCoreContracts,
  jbPricesAbi,
  jbTerminalStoreAbi,
  NATIVE_TOKEN,
  USD_CURRENCY_ID,
  USDC_ADDRESSES,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { getAccountingContexts } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";

type TreasuryRow = {
  chainId: JBChainId;
  token: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  usd: bigint | null;
};

type ChainTreasury = {
  chainId: JBChainId;
  verified: boolean;
  rows: TreasuryRow[];
};

interface Props {
  projects: Array<Pick<Project, "chainId" | "projectId">>;
}

function symbolOf(chainId: JBChainId, token: Address): string {
  if (token.toLowerCase() === NATIVE_TOKEN.toLowerCase()) return "ETH";
  if (USDC_ADDRESSES[chainId]?.toLowerCase() === token.toLowerCase()) return "USDC";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

async function readChainTreasury(
  config: ReturnType<typeof useConfig>,
  project: Props["projects"][number],
): Promise<ChainTreasury> {
  const chainId = project.chainId as JBChainId;
  const client = getPublicClient(config, { chainId }) as PublicClient | undefined;
  if (!client) return { chainId, verified: false, rows: [] };

  try {
    const projectId = BigInt(project.projectId);
    const terminal = getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId);
    const store = getJBContractAddress(JBCoreContracts.JBTerminalStore, 6, chainId);
    const prices = getJBContractAddress(JBCoreContracts.JBPrices, 6, chainId);
    const contexts = await getAccountingContexts(client, { chainId, projectId });
    const rows = await Promise.all(
      contexts.map(async (context): Promise<TreasuryRow> => {
        const balance = await client.readContract({
          address: store,
          abi: jbTerminalStoreAbi,
          functionName: "balanceOf",
          args: [terminal, projectId, context.token],
        });
        const usdPrice =
          balance === 0n
            ? 0n
            : await client
                .readContract({
                  address: prices,
                  abi: jbPricesAbi,
                  functionName: "pricePerUnitOf",
                  args: [projectId, BigInt(USD_CURRENCY_ID(6)), BigInt(context.currency), 18n],
                })
                .catch(() => null);
        return {
          chainId,
          token: context.token,
          symbol: symbolOf(chainId, context.token),
          decimals: context.decimals,
          balance,
          usd: usdPrice == null ? null : (balance * usdPrice) / 10n ** BigInt(context.decimals),
        };
      }),
    );
    return { chainId, verified: true, rows };
  } catch {
    return { chainId, verified: false, rows: [] };
  }
}

/**
 * The priced tokens' USD total, and the symbols of held tokens with no USD price, which it
 * leaves out. Null while any chain is unread: its holdings are unknown, not unpriced.
 */
export function treasuryUsdTotal(
  chainResults: readonly ChainTreasury[],
  expectedChains: number,
): { usd: bigint; unpriced: string[] } | null {
  if (chainResults.length !== expectedChains || chainResults.some((result) => !result.verified)) {
    return null;
  }
  const rows = chainResults.flatMap((result) => result.rows);
  return {
    usd: rows.reduce((sum, row) => sum + (row.usd ?? 0n), 0n),
    unpriced: [
      ...new Set(
        rows.filter((row) => row.balance !== 0n && row.usd == null).map((row) => row.symbol),
      ),
    ],
  };
}

function formatUsd18(value: bigint): string {
  const whole = value / 10n ** 18n;
  const cents = ((value % 10n ** 18n) * 100n) / 10n ** 18n;
  return `$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function TvlDatum({ projects }: Props) {
  const config = useConfig();
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: [
      "revnet",
      "treasury",
      projects.map(({ chainId, projectId }) => [chainId, projectId]),
    ],
    meta: PERSIST,
    queryFn: () => Promise.all(projects.map((project) => readChainTreasury(config, project))),
    enabled: projects.length > 0,
    staleTime: 30_000,
    retry: 1,
  });

  // A restored treasury may be available before this streamed component hydrates.
  const chainResults = hydrated ? (query.data ?? []) : [];
  const rows = chainResults.flatMap((result) => result.rows);
  const treasury = treasuryUsdTotal(chainResults, projects.length);
  const loading = hydrated ? query.isLoading : projects.length > 0;
  const total = loading
    ? "…"
    : treasury == null || treasury.unpriced.length
      ? "—"
      : formatUsd18(treasury.usd);

  return (
    <Tooltip>
      <TooltipTrigger className="min-h-11 sm:min-h-0">
        <span className="sm:text-xl text-lg">
          <span className="font-medium text-black">{total}</span>{" "}
          <span className="text-zinc-500">balance</span>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-3 text-xs"
      >
        <p className="mb-2 font-medium uppercase tracking-wide text-zinc-500">Balance by chain</p>
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={`${row.chainId}:${row.token}`}
              className={cn(
                "flex items-start justify-between gap-4",
                row.balance === 0n && "opacity-50",
              )}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 text-zinc-600">
                <ChainLogo chainId={row.chainId} width={17} height={17} />
                <span className="truncate">{chainDisplayName(row.chainId)}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block">
                  {formatTokenAmount(row.balance, row)} {row.symbol}
                </span>
                <span className="block text-[11px] text-zinc-500">
                  {row.usd == null ? "No USD price" : formatUsd18(row.usd)}
                </span>
              </span>
            </div>
          ))}
          {chainResults
            .filter((result) => !result.verified)
            .map((result) => (
              <div
                key={result.chainId}
                className="flex items-center justify-between gap-4 text-zinc-500"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ChainLogo chainId={result.chainId} width={17} height={17} />
                  {chainDisplayName(result.chainId)}
                </span>
                <span>Unavailable</span>
              </div>
            ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-4 border-t border-zinc-200 pt-2 font-medium">
          <span>All chains</span>
          <span className="tabular-nums">{total}</span>
        </div>
        {treasury?.unpriced.length ? (
          <div className="mt-1 text-zinc-500">
            Excludes {treasury.unpriced.join(", ")}: no USD price
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
