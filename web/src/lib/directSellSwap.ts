import type { JBChainId } from "@bananapus/nana-sdk-core";
import { chooseBestCashOutRoute, type CashOutRoute } from "@bananapus/nana-sdk-core/v6/cash-out";
import { PERMIT2_ADDRESS, permit2Abi } from "@bananapus/nana-sdk-core/v6/permit2";
import {
  buildUniswapV4ExactInputSwapTx,
  quoteUniswapV4ExactInputSingle,
  uniswapV4Deployment,
  uniswapV4SwapDirection,
  type UniswapV4PoolKey,
} from "@bananapus/nana-sdk-core/v6/uniswap-v4";
import type { Address, PublicClient } from "viem";

export { PERMIT2_ADDRESS, permit2Abi };

export interface DirectSellQuote {
  poolKey: UniswapV4PoolKey;
  zeroForOne: boolean;
  quotedOutput: bigint;
  minimumOutput: bigint;
}

/** Select a claimed-token pool sale only when its protected minimum beats
 * the hook-aware terminal cash-out output. Internal credits stay on the
 * terminal route because the Universal Router cannot pull them. */
export async function quoteDirectSellSwap({
  client,
  chainId,
  poolKey,
  projectToken,
  tokenToReclaim,
  amount,
  cashOutRoute,
  slippageBps,
}: {
  client: PublicClient;
  chainId: JBChainId;
  poolKey: UniswapV4PoolKey;
  projectToken: Address;
  tokenToReclaim: Address;
  amount: bigint;
  cashOutRoute: CashOutRoute;
  slippageBps: number;
}): Promise<DirectSellQuote | null> {
  if (
    !uniswapV4Deployment(chainId)?.universalRouter ||
    amount <= 0n ||
    slippageBps < 0 ||
    slippageBps > 10_000
  ) {
    return null;
  }
  const zeroForOne = uniswapV4SwapDirection({
    poolKey,
    tokenIn: projectToken,
    tokenOut: tokenToReclaim,
  });
  if (zeroForOne === null) return null;
  const quotedOutput = await quoteUniswapV4ExactInputSingle(client, {
    chainId,
    poolKey,
    zeroForOne,
    amountIn: amount,
  });
  const best = chooseBestCashOutRoute({
    cashOut: cashOutRoute,
    directSwapQuote: quotedOutput,
    directSwapPoolKey: poolKey,
    directSwapZeroForOne: zeroForOne,
    spendableProjectTokenCount: amount,
    cashOutCount: amount,
    slippageBps: BigInt(slippageBps),
  });
  if (best.kind !== "direct-swap") return null;
  return {
    poolKey: best.poolKey,
    zeroForOne: best.zeroForOne,
    quotedOutput: best.expectedReturn,
    minimumOutput: best.minimumReturn,
  };
}

export function buildDirectSellSwapTx({
  chainId,
  quote,
  amount,
  recipient,
  deadline,
}: {
  chainId: JBChainId;
  quote: DirectSellQuote;
  amount: bigint;
  recipient: Address;
  deadline: bigint;
}) {
  return buildUniswapV4ExactInputSwapTx({
    chainId,
    poolKey: quote.poolKey,
    zeroForOne: quote.zeroForOne,
    amountIn: amount,
    minimumAmountOut: quote.minimumOutput,
    recipient,
    deadline,
  });
}
