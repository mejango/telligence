import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { isNativeToken, Token } from "@/lib/token";
import { accountingDecimalsOf, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { useMemo } from "react";

type ReturnData = Token & {
  tokenMap: Record<JBChainId, Token>;
  /** Accounting-context currency id for the project's base token. */
  currency: number;
};

export function resolveProjectBaseToken(project: {
  token?: string | null;
  tokenSymbol?: string | null;
  decimals?: number | null;
  currency?: number | string | null;
}): Token & { currency: number } {
  const address = project.token as `0x${string}`;
  const fromAddress = getTokenSymbolFromAddress(address);
  // Prefer ETH/USDC labels for known reserve assets over the project ticker, and pin USDC to
  // 6 decimals. The old note here claimed the indexer reports "the project token's 18" — it
  // does not: bendystraw's `project.decimals`/`tokenSymbol` describe the ACCOUNTING context
  // (they sit under an `accountingContext` heading in ponder.schema.ts). The pin is still
  // right, but for a different reason: it guards a stale/absent context value, not a
  // project-token one. Believing the old comment is how the B2 accounting-context bug
  // (fallback filling accounting fields from the project ERC-20) got written in the first
  // place.
  const symbol = fromAddress === "TOKEN" ? project.tokenSymbol || "TOKEN" : fromAddress;
  const decimals = accountingDecimalsOf(project);
  const isNative = isNativeToken(project.token ?? null);

  return {
    address,
    symbol,
    isNative,
    decimals,
    currency: Number(project.currency ?? (isNative ? 1 : 0)),
  };
}

export function useProjectBaseToken(): ReturnData | undefined {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const { data } = useBendystrawQuery(
    ProjectOperation,
    { chainId: Number(chainId), projectId: Number(projectId), version: 6 },
    { enabled: !!chainId && !!projectId, pollInterval: 30000 },
  );

  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: data?.project?.suckerGroupId ?? "" },
    { enabled: !!data?.project?.suckerGroupId, pollInterval: 30000, chainId: Number(chainId) },
  );

  // Memoized so consumers can use the result in effect deps without looping.
  return useMemo(() => {
    if (!data?.project) return undefined;

    const tokenMap =
      suckerGroupData?.suckerGroup?.projects?.items?.reduce(
        (acc, project) => {
          if (project.token) {
            const { currency: _currency, ...token } = resolveProjectBaseToken(project);
            acc[Number(project.chainId) as JBChainId] = token;
          }
          return acc;
        },
        {} as Record<JBChainId, Token>,
      ) || ({} as Record<JBChainId, Token>);

    return { ...resolveProjectBaseToken(data.project), tokenMap };
  }, [data?.project, suckerGroupData?.suckerGroup?.projects?.items]);
}
