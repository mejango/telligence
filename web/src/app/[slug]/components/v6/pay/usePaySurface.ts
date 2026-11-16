"use client";

import { routerEntriesFor } from "@/lib/protocol-rollout";
import { payTokenCurrencyId, routerPayRouteWorks, V6PayTokenOption } from "@/lib/v6/pay";
import {
  JBChainId,
  JBCoreContracts,
  jbDirectoryAbi,
  jbV6ContractAddress,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import { getAccountingContexts, getCurrentRuleset } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { Address, erc20Abi, PublicClient } from "viem";
import { usePublicClient } from "wagmi";

export interface V6PaySurface {
  /** Directly accepted tokens first, then live-probed via-router options. */
  tokens: V6PayTokenOption[];
  /** Some additional routes could not be checked; verified choices remain usable. */
  routingUnavailable: boolean;
  /** Current ruleset start timestamp (seconds), 0 when unknown. */
  rulesetStart: number;
  pausePay: boolean;
  /** Listed payment terminals; undefined means the directory read is unavailable. */
  terminals: Address[] | undefined;
}

/**
 * The project's payment surface on the selected chain: accepted tokens + live
 * ruleset gates (website/ readProjectPaymentSurface parity).
 *
 * Direct tokens = the multi terminal's accounting contexts. When the project
 * also lists a known router registry, gateway, or current/previous router, native ETH and/or USDC that it does
 * NOT accept directly are offered as swap-via-router options — but ONLY when a
 * live `previewPayFor` probe through an attached entry succeeds (a listed router
 * with no route reverts at pay time). The token list retains verified choices
 * when an additional route cannot be checked.
 */
export function usePaySurface(chainId: JBChainId, projectId: bigint) {
  const publicClient = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["v6PaySurface", chainId, projectId.toString()],
    enabled: !!publicClient,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<V6PaySurface> => {
      const client = publicClient as PublicClient;
      const nativeSymbol = "ETH";
      const directory = jbV6ContractAddress[JBCoreContracts.JBDirectory][chainId];

      const [contexts, ruleset, terminalsRaw] = await Promise.all([
        getAccountingContexts(client, { chainId, projectId }),
        getCurrentRuleset(client, { chainId, projectId }).catch(() => null),
        client
          .readContract({
            address: directory,
            abi: jbDirectoryAbi,
            functionName: "terminalsOf",
            args: [projectId],
          })
          .catch(() => null),
      ]);

      const direct: V6PayTokenOption[] = await Promise.all(
        contexts.map(async (ctx) => ({
          token: ctx.token,
          decimals: ctx.decimals,
          currency: ctx.currency,
          viaRouter: false,
          symbol: await resolveSymbol(client, ctx.token, nativeSymbol),
        })),
      );

      const terminals = (terminalsRaw ?? []).filter(Boolean) as Address[];
      const routerEntries = routerEntriesFor(chainId, terminals);

      // Router candidates: ETH/USDC that aren't already accepted directly,
      // each gated by a fresh previewPayFor route probe.
      const has = (a: string) => direct.some((t) => t.token.toLowerCase() === a.toLowerCase());
      let routable: V6PayTokenOption[] = [];
      let routingUnavailable = terminalsRaw === null;
      if (routerEntries.length) {
        const candidates: V6PayTokenOption[] = [];
        if (!has(NATIVE_TOKEN)) {
          candidates.push({
            token: NATIVE_TOKEN as Address,
            decimals: 18,
            currency: payTokenCurrencyId(NATIVE_TOKEN as Address),
            symbol: nativeSymbol,
            viaRouter: true,
          });
        }
        const usdc = USDC_ADDRESSES[chainId];
        if (usdc && !has(usdc)) {
          candidates.push({
            token: usdc,
            decimals: 6,
            currency: payTokenCurrencyId(usdc),
            symbol: "USDC",
            viaRouter: true,
          });
        }
        const gated = await Promise.all(
          candidates.map(async (candidate) => {
            const probes = await Promise.allSettled(
              routerEntries.map((entry) =>
                routerPayRouteWorks(client, projectId, entry, candidate.token, candidate.decimals),
              ),
            );
            if (probes.some((probe) => probe.status === "fulfilled" && probe.value))
              return candidate;
            if (probes.some((probe) => probe.status === "rejected")) routingUnavailable = true;
            return null;
          }),
        );
        routable = gated.filter((c): c is V6PayTokenOption => c !== null);
      }

      return {
        tokens: [...direct, ...routable],
        routingUnavailable,
        rulesetStart: ruleset ? Number(ruleset.ruleset.start) : 0,
        pausePay: ruleset ? ruleset.metadata.pausePay : false,
        terminals: terminalsRaw === null ? undefined : terminals,
      };
    },
  });
}

async function resolveSymbol(
  client: PublicClient,
  token: Address,
  nativeSymbol: string,
): Promise<string> {
  if (token.toLowerCase() === NATIVE_TOKEN.toLowerCase()) return nativeSymbol;
  // Known USDC needs no read: a failed `symbol()` would otherwise leave a truncated address
  // that never matches "USDC", and the buy-first prompt then names ETH.
  if (Object.values(USDC_ADDRESSES).some((usdc) => usdc?.toLowerCase() === token.toLowerCase()))
    return "USDC";
  try {
    return await client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
  } catch {
    return `${token.slice(0, 6)}…${token.slice(-4)}`;
  }
}
