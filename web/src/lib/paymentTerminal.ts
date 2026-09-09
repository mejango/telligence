import {
  getJBContractAddress,
  JBChainId,
  jbContractAddress,
  jbMultiTerminalAbi,
  JBRouterTerminalContracts,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import { PayPreview, previewPay } from "@bananapus/nana-sdk-core/v6";
import { Address, PublicClient } from "viem";

export type PaymentTerminalType = "multi" | "swap";

type PaymentTerminal = {
  address: Address;
  abi: typeof jbMultiTerminalAbi | typeof jbRouterTerminalRegistryAbi;
  type: PaymentTerminalType;
};

export type V6PayRoute = PaymentTerminal & { preview: PayPreview };

/**
 * Resolve the best v6 pay route by previewing both the multi terminal and the router
 * terminal registry, keeping whichever mints the beneficiary the most project tokens.
 * Candidates whose preview reverts (e.g. no accounting context for the token) are
 * skipped, so a surviving route always carries a live quote.
 */
export async function resolveBestV6PayRoute(args: {
  client: PublicClient;
  chainId: JBChainId;
  projectId: bigint;
  token: Address;
  amount: bigint;
  beneficiary: Address;
}): Promise<V6PayRoute | null> {
  const { client, chainId, projectId, token, amount, beneficiary } = args;

  const previews = await Promise.all(
    v6PayRouteCandidates(chainId).map(async (route) => {
      try {
        const preview = await previewPay(client, {
          chainId,
          terminal: route.address,
          projectId,
          token,
          amount,
          beneficiary,
          metadata: "0x",
        });
        return { ...route, preview };
      } catch {
        return null;
      }
    }),
  );

  let best: V6PayRoute | null = null;
  for (const route of previews) {
    if (!route) continue;
    if (!best || v6PayRouteIsBetter(route, best)) best = route;
  }
  return best;
}

function v6PayRouteCandidates(chainId: JBChainId): PaymentTerminal[] {
  const routes: PaymentTerminal[] = [];

  try {
    routes.push({
      address: getJBContractAddress(JBRouterTerminalContracts.JBRouterTerminalRegistry, 6, chainId),
      abi: jbRouterTerminalRegistryAbi,
      type: "swap",
    });
  } catch {
    // Router registry not deployed on this chain.
  }

  const multi = jbContractAddress[6].JBMultiTerminal[chainId];
  if (multi && !routes.some((route) => route.address.toLowerCase() === multi.toLowerCase())) {
    routes.push({ address: multi, abi: jbMultiTerminalAbi, type: "multi" });
  }

  return routes;
}

function v6PayRouteIsBetter(candidate: V6PayRoute, current: V6PayRoute): boolean {
  if (candidate.preview.beneficiaryTokenCount !== current.preview.beneficiaryTokenCount) {
    return candidate.preview.beneficiaryTokenCount > current.preview.beneficiaryTokenCount;
  }
  const candidateTotal =
    candidate.preview.beneficiaryTokenCount + candidate.preview.reservedTokenCount;
  const currentTotal = current.preview.beneficiaryTokenCount + current.preview.reservedTokenCount;
  if (candidateTotal !== currentTotal) return candidateTotal > currentTotal;

  // Prefer the direct multi terminal over the router when quotes tie.
  return candidate.type === "multi" && current.type !== "multi";
}
