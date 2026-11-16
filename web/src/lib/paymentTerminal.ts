import { routerEntriesFor } from "@/lib/protocol-rollout";
import {
  JBChainId,
  jbMultiTerminalAbi,
  jbRouterTerminalRegistryAbi,
  jbV6ContractAddress,
} from "@bananapus/nana-sdk-core";
import {
  prepareBestUserPay,
  resolvePaymentTerminal,
  type PreparedUserPay,
} from "@bananapus/nana-sdk-core/v6";
import { Address, PublicClient } from "viem";

type PaymentTerminalType = "multi" | "swap";

type PaymentTerminal = {
  address: Address;
  abi: typeof jbMultiTerminalAbi | typeof jbRouterTerminalRegistryAbi;
  type: PaymentTerminalType;
};

export type V6PayRoute = PaymentTerminal & PreparedUserPay;

/**
 * Resolve the best v6 pay route by preparing the payment on both the multi terminal and the
 * router terminal registry, keeping whichever gives the beneficiary the most project tokens.
 * Candidates whose preview reverts (e.g. no accounting context for the token) are
 * skipped, so a surviving route always carries a live quote. When none survives and a swap
 * quote failed, that failure is thrown so the payer can retry the quote.
 */
export async function resolveBestV6PayRoute(args: {
  client: PublicClient;
  chainId: JBChainId;
  projectId: bigint;
  token: Address;
  amount: bigint;
  beneficiary: Address;
  attachedTerminals?: readonly Address[];
  /** The payer's tolerance on the SDK's quote and minimum; the SDK default when unset. */
  slippageBps?: bigint;
  /**
   * The paying account. With it, each native-token route is run as that account and the one that
   * delivers the most tokens wins; without it, the terminals' previews decide.
   */
  simulateFrom?: Address;
}): Promise<V6PayRoute | null> {
  const { client, chainId, projectId, token, amount, beneficiary, slippageBps, simulateFrom } =
    args;

  let attachedTerminals = args.attachedTerminals;
  if (attachedTerminals === undefined) {
    // Accounting contexts do not prove attachment. Recover only a direct route
    // whose token-specific primary is freshly confirmed by the directory.
    const primary = await resolvePaymentTerminal(client, { chainId, projectId, token });
    const multi = jbV6ContractAddress.JBMultiTerminal[chainId];
    if (primary.isRouter || primary.address.toLowerCase() !== multi?.toLowerCase()) return null;
    attachedTerminals = [primary.address];
  }

  // One rule for every client: the SDK prepares the payment on each listed terminal and keeps the
  // one that gives the beneficiary the most.
  const candidates = v6PayRouteCandidates(chainId, attachedTerminals);
  const best = await prepareBestUserPay(client, {
    chainId,
    projectId,
    token,
    amount,
    beneficiary,
    candidates: candidates.map((route) => ({
      terminal: route.address,
      type: route.type === "multi" ? ("multi" as const) : ("router" as const),
    })),
    ...(slippageBps !== undefined ? { slippageBps } : {}),
    ...(simulateFrom ? { simulateFrom } : {}),
  });
  if (!best) return null;
  const { terminal, type: _type, ...prepared } = best;
  const route = candidates.find((candidate) => candidate.address === terminal)!;
  return { ...route, ...prepared };
}

function v6PayRouteCandidates(
  chainId: JBChainId,
  attachedTerminals: readonly Address[],
): PaymentTerminal[] {
  const routes: PaymentTerminal[] = routerEntriesFor(chainId, attachedTerminals).map((address) => ({
    address,
    abi: jbRouterTerminalRegistryAbi,
    type: "swap",
  }));
  const multi = jbV6ContractAddress.JBMultiTerminal[chainId];
  if (
    multi &&
    attachedTerminals.some((address) => address.toLowerCase() === multi.toLowerCase()) &&
    !routes.some((route) => route.address.toLowerCase() === multi.toLowerCase())
  ) {
    routes.push({ address: multi, abi: jbMultiTerminalAbi, type: "multi" });
  }
  return routes;
}
