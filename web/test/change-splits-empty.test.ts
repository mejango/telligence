import { changeSplitsSchema } from "@/app/[slug]/owners/components/changeSplitsSchema";
import { prepareArgs } from "@/app/[slug]/owners/components/hooks/useSetSplitGroups";
import { RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { describe, expect, it } from "vitest";

const chain = (splits: Array<{ percentage: string; beneficiary: string }>) => ({
  chainId: 8453 as JBChainId,
  projectId: 3n,
  rulesetId: 1721000000n,
  selected: true,
  splits,
});

describe("changeSplitsSchema with no recipients", () => {
  it("accepts a selected chain whose split list is empty", () => {
    const result = changeSplitsSchema.safeParse({ chains: [chain([])] });
    expect(result.success).toBe(true);
  });

  it("still enforces the 100% total when recipients exist", () => {
    const result = changeSplitsSchema.safeParse({
      chains: [
        chain([{ percentage: "40", beneficiary: "0x000000000000000000000000000000000000dEaD" }]),
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("100%"))).toBe(true);
    }
  });
});

describe("prepareArgs with no recipients", () => {
  it("encodes an empty reserved split group without NaN percents", () => {
    const args = prepareArgs(chain([]));
    expect(args[0]).toBe(3n);
    expect(args[1]).toBe(1721000000n);
    expect(args[2]).toEqual([{ groupId: RESERVED_TOKEN_SPLIT_GROUP_ID, splits: [] }]);
  });

  it("still normalizes non-empty splits to the full split percent", () => {
    const args = prepareArgs(
      chain([
        { percentage: "60", beneficiary: "0x000000000000000000000000000000000000dEaD" },
        { percentage: "40", beneficiary: "0x000000000000000000000000000000000000bEEF" },
      ]),
    );
    const splits = args[2][0].splits;
    expect(splits).toHaveLength(2);
    const total = splits.reduce((sum, split) => sum + split.percent, 0);
    expect(total).toBe(1_000_000_000);
  });
});
