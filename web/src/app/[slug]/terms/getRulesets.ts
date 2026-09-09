import { readAllProjectRulesets } from "@/lib/nana/rulesets";
import { decodeRulesetMetadata } from "@/lib/utils";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  getJBContractAddress,
  JBChainId,
  JBCoreContracts,
  jbRulesetsAbi,
  WeightCutPercent,
} from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";
import { getContract } from "viem";

export type Ruleset = {
  id: number;
  start: number;
  duration: number;
  weight: string;
  weightCutPercent: number;
  baseCurrency: number;
};

const readRulesets = async (projectId: string, chainId: JBChainId): Promise<Ruleset[]> => {
  const client = getViemPublicClient(chainId);
  const contract = getContract({
    address: getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId),
    abi: jbRulesetsAbi,
    client,
  });

  const data = await readAllProjectRulesets(client, contract.address, BigInt(projectId));

  return data
    .map((r) => ({
      id: r.id,
      start: r.start,
      duration: r.duration,
      weight: r.weight.toString(),
      weightCutPercent: new WeightCutPercent(r.weightCutPercent).toFloat(),
      baseCurrency: decodeRulesetMetadata(BigInt(r.metadata)).baseCurrency,
    }))
    .sort((a, b) => a.start - b.start);
};

/**
 * A revnet's stages are queued once at deployFor — REVDeployer launches them
 * all in one call on a blank project, and no revnet actor holds
 * QUEUE_RULESETS — so this answer can never change. Cache it permanently
 * rather than re-reading the chain every few minutes.
 */
const cachedRulesets = unstable_cache(readRulesets, ["rulesets-with-base-currency"], {
  // Ruleset LISTS are immutable only for revnets, whose stages are fixed at deploy. This app also
  // renders ordinary projects, whose owner can queue a new ruleset at any time — caching those
  // forever left Terms and stages permanently stale ACROSS SESSIONS. Persisted-but-revalidating
  // is correct for both: a revnet's list simply never differs on revalidation.
  revalidate: 60,
});

export async function getRulesets(projectId: string, chainId: JBChainId): Promise<Ruleset[]> {
  const cached = await cachedRulesets(projectId, chainId);
  if (cached.length > 0) return cached;
  // An empty read means the revnet is mid-deploy or the RPC failed — never let
  // that become the permanent answer, so bypass the cache until it has stages.
  return readRulesets(projectId, chainId);
}
