import { readLoanSource } from "@/lib/loanTransactions";
import {
  loanTokenMetadata,
  type LoanTokenIdentity,
  type LoanTokenMetadata,
  type LoanTokenProject,
} from "@/lib/tokenUtils";
import { type JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { isAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";

/** Share missing source-context reads across rows; already-known display metadata needs no RPC. */
export function useLoanToken(
  loan: LoanTokenIdentity,
  projects: readonly LoanTokenProject[],
  requireCurrency = false,
) {
  const metadata = loanTokenMetadata(loan, projects);
  const token = loan.sourceToken || loan.token;
  const chainId = Number(loan.chainId) as JBChainId;
  const client = usePublicClient({ chainId });
  const needsContext = !metadata || (requireCurrency && metadata.currency === undefined);
  const query = useQuery({
    queryKey: ["revLoanDisplaySource", chainId, String(loan.projectId), token?.toLowerCase()],
    enabled: needsContext && !!client && !!token && isAddress(token),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 250,
    queryFn: async (): Promise<LoanTokenMetadata> => {
      const source = await readLoanSource(client!, {
        chainId,
        revnetId: BigInt(loan.projectId),
        preferredToken: token as Address,
      });
      // readLoanSource may choose the primary context for a NEW borrow. An existing
      // displayed loan is fixed to its token, so that fallback must never price this row.
      if (source.token.toLowerCase() !== token?.toLowerCase())
        throw new Error("This loan's source token is unavailable.");
      return {
        ...source,
        symbol: metadata?.symbol ?? `${source.token.slice(0, 6)}…${source.token.slice(-4)}`,
      };
    },
  });
  return {
    source: query.isError ? metadata : (query.data ?? metadata),
    pending: needsContext && query.isPending && query.fetchStatus !== "idle",
    retry: query.refetch,
  };
}
