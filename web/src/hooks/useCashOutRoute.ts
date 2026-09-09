import type { JBChainId } from "@/lib/nana/types";
import { type CashOutRoute, getHookAwareCashOutQuote } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";

/**
 * Quote a cash out through `JBMultiTerminal.previewCashOutFrom` — the hook-aware
 * simulation of the real cash-out path — and prepare a slippage-protected route.
 * Pass `route.terminalMinimum` as `minTokensReclaimed` and `route.metadata` as
 * `metadata` in `cashOutTokensOf`; `route.expectedReturn` is the quoted net for
 * display, in the reclaim token's own decimals.
 *
 * The query errors while a revnet's initial cash-out delay is active (the
 * preview reverts), so treat the error state as "cash outs locked".
 */
export function useCashOutRoute(params: {
  chainId: JBChainId | undefined;
  projectId: bigint | undefined;
  holder: Address | undefined;
  cashOutCount: bigint | undefined;
  tokenToReclaim: Address | undefined;
  terminal: Address | undefined;
  slippageBps?: bigint;
}) {
  const { chainId, projectId, holder, cashOutCount, tokenToReclaim, terminal, slippageBps } =
    params;

  const publicClient = usePublicClient({ chainId });

  return useQuery<CashOutRoute>({
    queryKey: [
      "cashOutRoute",
      chainId,
      projectId?.toString(),
      holder,
      cashOutCount?.toString(),
      tokenToReclaim,
      terminal,
      slippageBps?.toString(),
    ],
    enabled:
      !!publicClient && !!chainId && !!projectId && !!holder && !!cashOutCount && !!tokenToReclaim,
    queryFn: () =>
      getHookAwareCashOutQuote(publicClient as PublicClient, {
        chainId: chainId as JBChainId,
        projectId: projectId as bigint,
        holder: holder as Address,
        cashOutCount: cashOutCount as bigint,
        tokenToReclaim: tokenToReclaim as Address,
        terminal,
        slippageBps,
      }),
  });
}
