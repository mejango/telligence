import {
  getJBContractAddress,
  JBChainId,
  JBCoreContracts,
  jbTokensAbi,
  NATIVE_TOKEN,
} from "@bananapus/nana-sdk-core";
import { formatUnits, getContract } from "viem";
import { isUsd } from "./currency";
import { getViemPublicClient } from "./wagmiTransports";

export interface Token {
  symbol: string;
  address: `0x${string}`;
  isNative: boolean;
  decimals: number;
}

export function formatTokenAmount(amount: bigint, token: Pick<Token, "symbol" | "decimals">) {
  const formatted = formatUnits(amount, token.decimals);
  return Number(formatted).toLocaleString("en-US", getTokenFractionDigits(token.symbol));
}

function getTokenFractionDigits(symbol: string) {
  if (isUsd(symbol)) {
    return { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
  }
  if (symbol === "ETH") {
    return { minimumFractionDigits: 0, maximumFractionDigits: 4 } as const;
  }
  return { minimumFractionDigits: 0, maximumFractionDigits: 2 } as const;
}

export function isNativeToken(address: string | null) {
  return address?.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

export const getTokenAddress = async (chainId: JBChainId, projectId: number) => {
  const client = getViemPublicClient(chainId);

  const jbTokens = getContract({
    address: getJBContractAddress(JBCoreContracts.JBTokens, 6, chainId),
    abi: jbTokensAbi,
    client,
  });

  return await jbTokens.read.tokenOf([BigInt(projectId)]);
};
