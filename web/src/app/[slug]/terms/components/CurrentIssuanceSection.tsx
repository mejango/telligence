"use client";

import { SkeletonLines } from "@/components/ui/skeleton";
import { useBoostRecipient } from "@/hooks/useBoostRecipient";
import { useCountdownToDate } from "@/hooks/useCountdownToDate";
import { useFormattedTokenIssuance } from "@/hooks/useFormattedTokenIssuance";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import { useJBRulesetContext } from "@/lib/nana/project";
import { formatSeconds } from "@/lib/utils";
import { getNextRulesetWeight, ReservedPercent, RulesetWeight } from "@bananapus/nana-sdk-core";

export function CurrentIssuanceSection() {
  const { ruleset, rulesetMetadata } = useJBRulesetContext();
  const baseToken = useProjectBaseToken();
  const boostRecipient = useBoostRecipient();

  // useFormattedTokenIssuance resolves the unit after the slash from the
  // indexer's base-token row; when that row is unavailable it interpolates
  // "undefined". For v6 the terminal's on-chain accounting context is
  // authoritative (e.g. Artizen's USDC context, currency uint32(token)), so
  // fill the unit from it.
  const withUnit = (issuance: string | undefined) => {
    if (!issuance?.endsWith(" / undefined")) return issuance;
    return baseToken?.symbol
      ? issuance.replace(/undefined$/, baseToken.symbol)
      : issuance.slice(0, -" / undefined".length);
  };

  const currentIssuance = withUnit(
    useFormattedTokenIssuance({ reservedPercent: new ReservedPercent(0) }),
  );

  const nextCutTime = ruleset?.data
    ? new Date((ruleset.data.start + ruleset.data.duration) * 1000)
    : undefined;
  const timeLeft = useCountdownToDate(nextCutTime);

  const nextWeight = ruleset?.data
    ? new RulesetWeight(
        getNextRulesetWeight({
          weight: ruleset.data.weight.value,
          weightCutPercent: Number(ruleset.data.weightCutPercent.value),
        }),
      )
    : undefined;

  const nextIssuance = withUnit(
    useFormattedTokenIssuance({
      weight: nextWeight,
      reservedPercent: new ReservedPercent(0),
    }),
  );

  const splitPercent = rulesetMetadata?.data?.reservedPercent;

  if (!ruleset?.data || !rulesetMetadata?.data) {
    return <SkeletonLines lines={2} className="w-64 py-1" />;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="self-start text-xl font-normal tabular-nums text-black">
        {currentIssuance}
      </span>

      {timeLeft && nextIssuance && (
        <p className="text-sm text-zinc-500">
          Cut to <span className="font-normal tabular-nums text-black">{nextIssuance}</span> in{" "}
          {formatSeconds(timeLeft)}
        </p>
      )}

      {splitPercent && boostRecipient && (
        <p className="text-sm text-zinc-500">
          {splitPercent.formatPercentage().toFixed(2)}% of issuance and buybacks to splits
        </p>
      )}
    </div>
  );
}
