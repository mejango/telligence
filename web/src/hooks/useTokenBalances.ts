"use client";

import { useViewedAccount } from "@/hooks/useViewedAccount";
import { Token } from "@/lib/token";
import { useMemo } from "react";
import { erc20Abi } from "viem";
import { useBalance, useReadContracts } from "wagmi";

export function useTokenBalances(tokens: Token[], chainId: number) {
  const { address } = useViewedAccount();

  const erc20Tokens = useMemo(() => tokens.filter((t) => !t.isNative), [tokens]);

  const erc20Contracts = useMemo(
    () =>
      erc20Tokens.map((t) => ({
        chainId,
        abi: erc20Abi,
        address: t.address,
        functionName: "balanceOf",
        args: [address],
      })),
    [erc20Tokens, address, chainId],
  );

  const { data: erc20Data, isLoading: isErc20Loading } = useReadContracts({
    contracts: erc20Contracts,
    query: { enabled: !!address && erc20Contracts.length > 0, refetchOnMount: false },
  });

  const { data: nativeData, isLoading: isNativeLoading } = useBalance({
    address,
    chainId,
    query: { enabled: !!address, refetchOnMount: false },
  });

  const balances = useMemo(() => {
    const map = new Map<string, bigint>();
    erc20Tokens.forEach((t, idx) => {
      const r = erc20Data?.[idx]?.result;
      if (typeof r === "bigint") map.set(t.address, r);
    });

    const nativeToken = tokens.find((t) => t.isNative);
    if (nativeToken && nativeData?.value != null) {
      map.set(nativeToken.address, nativeData.value);
    }
    return map;
  }, [tokens, erc20Tokens, erc20Data, nativeData]);

  return { balances, isLoading: isErc20Loading || isNativeLoading };
}
