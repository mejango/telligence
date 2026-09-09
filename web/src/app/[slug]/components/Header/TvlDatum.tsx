"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Project } from "@/lib/bendystraw/types";
import { PERSIST } from "@/lib/query-persist";
import { formatTokenAmount } from "@/lib/token";
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

export function treasuryUsdTotal(
  chainResults: readonly ChainTreasury[],
  expectedChains: number,
): bigint | null {
  const rows = chainResults.flatMap((result) => result.rows);
  if (
    chainResults.length !== expectedChains ||
    chainResults.some((result) => !result.verified) ||
    rows.some((row) => row.balance !== 0n && row.usd == null)
  ) {
    return null;
  }
  return rows.reduce((sum, row) => sum + (row.usd ?? 0n), 0n);
}

function formatUsd18(value: bigint): string {
  const whole = value / 10n ** 18n;
  const cents = ((value % 10n ** 18n) * 100n) / 10n ** 18n;
  return `$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function TvlDatum({ projects }: Props) {
  const config = useConfig();
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

  const chainResults = query.data ?? [];
  const rows = chainResults.flatMap((result) => result.rows);
  const totalUsd = treasuryUsdTotal(chainResults, projects.length);
  const total = query.isLoading ? "…" : totalUsd == null ? "—" : formatUsd18(totalUsd);

  return (
    <Tooltip>
      <TooltipTrigger className="min-h-11 sm:min-h-0">
        <span className="sm:text-xl text-lg">
          <span className="font-medium text-black">{total}</span>{" "}
          <span className="text-zinc-500">balance</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="w-72">
        {rows.map((row) => (
          <div key={`${row.chainId}:${row.token}`} className="flex justify-between gap-2">
            <span>
              Chain {row.chainId} | {row.symbol}
            </span>
            <span className="font-medium">
              {formatTokenAmount(row.balance, row)} {row.symbol}
              {row.usd == null ? " | USD unavailable" : ` | ${formatUsd18(row.usd)}`}
            </span>
          </div>
        ))}
        {chainResults
          .filter((result) => !result.verified)
          .map((result) => (
            <div key={result.chainId} className="flex justify-between gap-2">
              <span>Chain {result.chainId}</span>
              <span className="font-medium">Unavailable</span>
            </div>
          ))}
        <hr className="py-1" />
        <div className="flex justify-between gap-2">
          <span>[All chains]</span>
          <span className="font-medium">{total}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
