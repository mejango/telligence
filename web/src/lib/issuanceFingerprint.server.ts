import "server-only";

import { getRulesets } from "@/app/[slug]/terms/getRulesets";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { formatUnits } from "viem";

export async function getIssuanceFingerprint(
  projectId: number,
  chainId: JBChainId,
): Promise<number[]> {
  try {
    const rulesets = await getRulesets(String(projectId), chainId);
    return rulesets.flatMap((ruleset, index) => {
      const weight = Number(formatUnits(BigInt(ruleset.weight), 18));
      if (!Number.isFinite(weight) || weight <= 0) return [];
      const price = 1 / weight;
      const next = rulesets[index + 1];
      if (!next || ruleset.duration <= 0 || ruleset.weightCutPercent <= 0) return [price];
      const cycles = Math.max(
        1,
        Math.min(6, Math.floor((next.start - ruleset.start) / ruleset.duration)),
      );
      return Array.from(
        { length: cycles },
        (_, cycle) => price / Math.pow(1 - ruleset.weightCutPercent, cycle),
      );
    });
  } catch {
    return [];
  }
}
