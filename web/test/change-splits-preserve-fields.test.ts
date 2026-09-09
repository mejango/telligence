import type { SplitFormData } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import {
  splitIsLocked,
  splitRouting,
} from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import { prepareArgs } from "@/app/[slug]/owners/components/hooks/useSetSplitGroups";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

const LP_HOOK = "0x1111111111111111111111111111111111111111" as const;
const ALICE = "0x000000000000000000000000000000000000dEaD" as const;
const BOB = "0x000000000000000000000000000000000000bEEF" as const;

const chain = (splits: SplitFormData[]) => ({
  chainId: 8453 as JBChainId,
  projectId: 3n,
  rulesetId: 1721000000n,
  selected: true,
  splits,
});

/**
 * `setSplitGroupsOf` replaces the whole group, so an edit to one row re-sends
 * every row. Dropping hook/projectId/lockedUntil on the way through would strip
 * routing and break locks the chain still enforces.
 */
describe("prepareArgs preserves non-editable split fields", () => {
  it("carries hook, projectId and lock through an unrelated percentage edit", () => {
    const args = prepareArgs(
      chain([
        // an LP-hook split: routed by hook, beneficiary is the zero address
        {
          percentage: "50",
          beneficiary: zeroAddress,
          hook: LP_HOOK,
          projectId: 0n,
          lockedUntil: 2_000_000_000,
          preferAddToBalance: false,
        },
        // a project-routed split
        {
          percentage: "30",
          beneficiary: ALICE,
          hook: zeroAddress,
          projectId: 42n,
          lockedUntil: 0,
          preferAddToBalance: true,
        },
        // the plain payout the user actually edited
        { percentage: "20", beneficiary: BOB, hook: zeroAddress, projectId: 0n, lockedUntil: 0 },
      ]),
    );

    const splits = args[2][0].splits;

    expect(splits[0].hook).toBe(LP_HOOK);
    expect(splits[0].lockedUntil).toBe(2_000_000_000);
    expect(splits[0].beneficiary).toBe(zeroAddress);

    expect(splits[1].projectId).toBe(42n);
    expect(splits[1].preferAddToBalance).toBe(true);

    expect(splits[2].hook).toBe(zeroAddress);
    expect(splits[2].projectId).toBe(0n);
    expect(splits[2].beneficiary).toBe(BOB);

    expect(splits.reduce((sum, s) => sum + s.percent, 0)).toBe(1_000_000_000);
  });

  it("encodes a user-added row as a plain address payout", () => {
    const args = prepareArgs(chain([{ percentage: "100", beneficiary: BOB }]));
    const [split] = args[2][0].splits;

    expect(split.hook).toBe(zeroAddress);
    expect(split.projectId).toBe(0n);
    expect(split.lockedUntil).toBe(0);
    expect(split.preferAddToBalance).toBe(false);
  });
});

describe("split row classification", () => {
  it("flags hook and project rows as routed, plain rows as not", () => {
    expect(splitRouting({ percentage: "1", beneficiary: zeroAddress, hook: LP_HOOK })).toEqual({
      kind: "hook",
      address: LP_HOOK,
    });
    expect(splitRouting({ percentage: "1", beneficiary: ALICE, projectId: 42n })).toEqual({
      kind: "project",
      projectId: 42n,
    });
    expect(
      splitRouting({ percentage: "1", beneficiary: ALICE, hook: zeroAddress, projectId: 0n }),
    ).toBeNull();
  });

  it("treats only future locks as locked", () => {
    const now = 1_700_000_000;
    expect(splitIsLocked({ percentage: "1", beneficiary: ALICE, lockedUntil: now + 1 }, now)).toBe(
      true,
    );
    expect(splitIsLocked({ percentage: "1", beneficiary: ALICE, lockedUntil: now }, now)).toBe(
      false,
    );
    expect(splitIsLocked({ percentage: "1", beneficiary: ALICE }, now)).toBe(false);
  });
});
