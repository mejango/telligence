import { formatUnits } from "@bananapus/nana-sdk-core";

/**
 * A stage is one ruleset, but the same stage carries a DIFFERENT ruleset id on
 * every chain. Across chains a stage is therefore addressed by its index in the
 * chronological ruleset list, never by an id.
 */
export type StageRulesetPair<TChainId extends number = number> = {
  peerChainId: TChainId;
  projectId: bigint;
  rulesets?: readonly { id: number | bigint }[];
};

export type StageChain<TChainId extends number = number> = {
  chainId: TChainId;
  projectId: bigint;
  rulesetId: bigint;
};

/**
 * The index of the stage in force now: the LAST one whose start has passed.
 *
 * `findIndex(start > now)` returns -1 once every stage has started — i.e. exactly when the
 * final stage is current — so deriving the index from it silently collapses to stage 1 for
 * the entire rest of a revnet's life. That matters because `JBController` distributes from
 * the CURRENT ruleset: an edit aimed at a past stage's ruleset id succeeds on-chain and
 * changes nothing.
 */
export function currentStageIndex(
  rulesets: readonly { start: number | bigint }[] | undefined | null,
  nowSeconds: number = Date.now() / 1000,
): number {
  const started = (rulesets ?? []).filter((ruleset) => Number(ruleset.start) <= nowSeconds).length;
  return Math.max(started - 1, 0);
}

/** Each chain's own ruleset id for the stage at `stageIdx`, skipping chains that don't have one. */
export function chainsAtStage<TChainId extends number>(
  pairs: readonly StageRulesetPair<TChainId>[] | undefined | null,
  stageIdx: number,
): StageChain<TChainId>[] {
  if (!pairs) return [];

  return pairs.flatMap((pair) => {
    const rulesetId = pair.rulesets?.[stageIdx]?.id;
    if (!rulesetId) return [];
    return [
      {
        chainId: pair.peerChainId,
        projectId: BigInt(pair.projectId),
        rulesetId: BigInt(rulesetId),
      },
    ];
  });
}

/**
 * A split's share of total issuance, as a percent string.
 *
 * `percent` is out of SPLITS_TOTAL_PERCENT (1e9) of the stage's split limit, and
 * `splitLimitBps` is that limit out of 10_000 (2.5% is 250). The limit stays in
 * its stored units until the final division so fractional limits survive.
 */
export function effectiveSplitPercent(percent: bigint, splitLimitBps: bigint): string {
  return formatUnits((percent * splitLimitBps) / 10_000n, 7);
}

export type EmptySaveChain = {
  chainId: number;
  selected: boolean;
  /** Recipients the form would submit for this chain. */
  splitCount: number;
  /** Recipients in the project's fallback (ruleset 0) group, or null if it couldn't be read. */
  fallbackSplitCount: number | null;
};

/**
 * Why an empty recipient list can't be saved, or null when it can.
 *
 * `JBSplits.splitsOf` serves the fallback (ruleset 0) group whenever the active
 * ruleset's group is empty, so clearing a group only strands the reserved tokens
 * at the owner contract when that fallback group is empty too. An unreadable
 * fallback fails closed.
 */
export function emptySaveBlockMessage(
  chains: readonly EmptySaveChain[],
  nameOf: (chainId: number) => string,
): string | null {
  const blocked = chains.filter(
    (chain) => chain.selected && chain.splitCount === 0 && chain.fallbackSplitCount !== 0,
  );
  if (blocked.length === 0) return null;

  return blocked
    .map((chain) =>
      chain.fallbackSplitCount === null
        ? `Couldn't read ${nameOf(chain.chainId)}'s default splits, so clearing its recipients is blocked.`
        : `Clearing ${nameOf(chain.chainId)}'s recipients would activate the project's default splits (${chain.fallbackSplitCount} ${chain.fallbackSplitCount === 1 ? "recipient" : "recipients"}).`,
    )
    .join(" ");
}
