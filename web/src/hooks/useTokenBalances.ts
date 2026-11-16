"use client";

import { useViewedAccount } from "@/hooks/useViewedAccount";
import { readEach } from "@/lib/read-each";
import { Token } from "@/lib/token";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { erc20Abi } from "viem";
import { useBalance, usePublicClient } from "wagmi";

export function useTokenBalances(tokens: Token[], chainId: number) {
  const { address } = useViewedAccount();

  const erc20Tokens = useMemo(() => tokens.filter((t) => !t.isNative), [tokens]);

  const client = usePublicClient({ chainId });
  // Each token is a contract someone else controls, so the balances read apart
  // from the page's other reads, and one that burns its gas fails only itself.
  const { data: erc20Data, isLoading: isErc20Loading } = useQuery({
    queryKey: [
      "token-balances",
      chainId,
      address?.toLowerCase(),
      erc20Tokens.map((t) => t.address.toLowerCase()),
    ],
    enabled: !!client && !!address && erc20Tokens.length > 0,
    refetchOnMount: false,
    queryFn: () =>
      readEach(
        client!,
        erc20Tokens.map((t) => ({
          address: t.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        })),
      ),
  });

  const { data: nativeData, isLoading: isNativeLoading } = useBalance({
    address,
    chainId,
    query: { enabled: !!address, refetchOnMount: false },
  });

  const balances = useMemo(() => {
    const map = new Map<string, bigint>();
    erc20Tokens.forEach((t, idx) => {
      const read = erc20Data?.[idx];
      if (read?.status === "success" && typeof read.result === "bigint") {
        map.set(t.address, read.result);
      }
    });

    const nativeToken = tokens.find((t) => t.isNative);
    if (nativeToken && nativeData?.value != null) {
      map.set(nativeToken.address, nativeData.value);
    }
    return map;
  }, [tokens, erc20Tokens, erc20Data, nativeData]);

  return { balances, isLoading: isErc20Loading || isNativeLoading };
}
