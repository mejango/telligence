import { USDC_DECIMALS } from "@/app/constants";
import { NATIVE_TOKEN, NATIVE_TOKEN_DECIMALS, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";

/**
 * Get token symbol from token address
 * @param tokenAddress - The token address to resolve
 * @returns The token symbol (ETH, USDC, or TOKEN as fallback)
 */
export function getTokenSymbolFromAddress(tokenAddress: string) {
  // Check for ETH (case insensitive)
  if (tokenAddress?.toLowerCase() === NATIVE_TOKEN.toLowerCase()) {
    return "ETH";
  }

  // Check for USDC (case insensitive)
  const isUsdc = Object.values(USDC_ADDRESSES)
    .map((addr) => addr.toLowerCase())
    .includes(tokenAddress?.toLowerCase() as `0x${string}`);

  if (isUsdc) return "USDC";

  return "TOKEN";
}

export type TokenIdentity = {
  chainId?: number | null;
  token?: string | null;
  tokenSymbol?: string | null;
  decimals?: number | null;
};

/** Canonical reserve identity is chain and address; an ERC-20 symbol is only a label. */
export function canonicalTokenSymbol(
  row: Pick<TokenIdentity, "chainId" | "token">,
): "ETH" | "USDC" | null {
  if (isNativeToken(row.token)) return "ETH";
  return row.chainId != null &&
    row.token &&
    USDC_ADDRESSES[row.chainId as keyof typeof USDC_ADDRESSES]?.toLowerCase() ===
      row.token.toLowerCase()
    ? "USDC"
    : null;
}

export type LoanTokenIdentity = {
  chainId: number | string;
  projectId: number | string;
  token?: string | null;
  sourceToken?: string | null;
};
export type LoanTokenProject = TokenIdentity & {
  projectId: number | string;
  currency?: number | string | bigint | null;
  projectTokenBalances?: { items: TokenIdentity[] } | null;
};
export type LoanTokenMetadata = {
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Only present when the exact source's accounting currency is known. */
  currency?: number;
};

/** Indexed loan metadata never borrows another accounting token's units or currency. */
export function loanTokenMetadata(
  loan: LoanTokenIdentity,
  projects: readonly LoanTokenProject[],
): LoanTokenMetadata | null {
  const token = loan.sourceToken || loan.token;
  if (!token) return null;
  const project = projects.find(
    (candidate) =>
      Number(candidate.chainId) === Number(loan.chainId) &&
      Number(candidate.projectId) === Number(loan.projectId),
  );
  const primaryMatches = project?.token?.toLowerCase() === token.toLowerCase();
  const context =
    project?.projectTokenBalances?.items.find(
      (row) => row.token?.toLowerCase() === token.toLowerCase(),
    ) ?? (primaryMatches ? project : undefined);
  const canonical = canonicalTokenSymbol({ chainId: Number(loan.chainId), token });
  const decimals =
    canonical === "ETH"
      ? NATIVE_TOKEN_DECIMALS
      : canonical === "USDC"
        ? USDC_DECIMALS
        : context?.decimals;
  if (decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    return null;
  const currency =
    primaryMatches && project?.currency != null && project.currency !== ""
      ? Number(project.currency)
      : undefined;
  return {
    token: token as `0x${string}`,
    symbol:
      canonical ?? (context?.tokenSymbol?.trim() || `${token.slice(0, 6)}…${token.slice(-4)}`),
    decimals,
    currency:
      currency != null && Number.isSafeInteger(currency) && currency >= 0 ? currency : undefined,
  };
}

/**
 * Which rows are the same asset: ETH and USDC by symbol, so each chain's copy adds up;
 * any other token by its chain and address, so unrelated assets stay apart.
 */
export function tokenKindOf(row: TokenIdentity): string {
  const kind = `${row.tokenSymbol?.trim().toUpperCase()}:${row.decimals ?? 18}`;
  const known = !row.token || canonicalTokenSymbol(row) !== null;
  return row.token && !known
    ? `${row.chainId ?? "unknown"}:${row.token.toLowerCase()}:${kind}`
    : kind;
}

/**
 * Whether a sucker group's raw balances and amounts add unlike units: a chain accepts more
 * than one token, or the chains' accounting tokens differ.
 */
export function groupMixesTokens(
  projects: ReadonlyArray<TokenIdentity & { accountingTokenCount?: number | null }>,
): boolean {
  if (projects.some((project) => (project.accountingTokenCount ?? 0) > 1)) return true;
  const kinds = new Set(
    projects.filter((project) => project.token || project.tokenSymbol).map(tokenKindOf),
  );
  return kinds.size > 1;
}

/**
 * Decimals for an accounting token, from its address and whatever the indexer reported.
 *
 * USDC is pinned to 6 on every chain `USDC_ADDRESSES` covers, because an indexed value
 * can be stale or absent. Everything else is taken as indexed, nullish-coalesced and
 * never `||`: a legitimate 0-decimal token is a real thing, and coercing it to 18 would
 * mis-scale every amount by 1e18.
 */
export function accountingDecimalsOf(context: {
  token?: string | null;
  decimals?: number | null;
}): number {
  if (getTokenSymbolFromAddress(context.token ?? "") === "USDC") return USDC_DECIMALS;
  return context.decimals ?? NATIVE_TOKEN_DECIMALS;
}

/**
 * Token configuration for a specific chain
 */
export interface TokenConfig {
  token: `0x${string}`;
  currency: number;
  decimals: number;
  symbol?: string;
}

/** Whether an address is the protocol's native-token sentinel. Symbols are
 * display-only — gate behavior (value attachment, allowance checks) on this. */
export function isNativeToken(tokenAddress: string | undefined | null): boolean {
  return tokenAddress?.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

/**
 * Get token configuration for a specific chain from sucker group data.
 *
 * Returns null while the sucker-group data is missing/loading or the chain has
 * no resolvable accounting token. Callers must treat null as LOADING (disable
 * submits, show skeletons) — never default to ETH/18: a USDC loan rendered as
 * ETH skips the allowance gate and attaches native value.
 */
export function getTokenConfigForChain(
  suckerGroupData: any,
  targetChainId: number,
): TokenConfig | null {
  const projectForChain = suckerGroupData?.suckerGroup?.projects?.items?.find(
    (project: any) => project.chainId === targetChainId,
  );
  if (!projectForChain?.token) return null;

  return {
    token: projectForChain.token as `0x${string}`,
    currency: Number(projectForChain.currency),
    decimals: accountingDecimalsOf(projectForChain),
    symbol:
      projectForChain.tokenSymbol ||
      getTokenSymbolFromAddress(projectForChain.token as `0x${string}`),
  };
}

/**
 * A chain's accounting token as its terminal states it. A project can hold several contexts: the
 * one for the indexed token wins, else the first. The indexed symbol labels only its own token.
 */
export function pickAccountingContext(
  contexts: readonly { token: `0x${string}`; decimals: number; currency: number }[] | undefined,
  indexed: TokenConfig | null,
): TokenConfig | null {
  if (!contexts?.length) return null;
  const match = indexed
    ? contexts.find((context) => context.token.toLowerCase() === indexed.token.toLowerCase())
    : undefined;
  const context = match ?? contexts[0];
  return {
    token: context.token,
    currency: Number(context.currency),
    decimals: Number(context.decimals),
    symbol: match ? indexed?.symbol : undefined,
  };
}
