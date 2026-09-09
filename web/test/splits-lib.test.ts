import {
  chainsAtStage,
  effectiveSplitPercent,
  emptySaveBlockMessage,
} from "@/app/[slug]/owners/components/splitsLib";
import { describe, expect, it } from "vitest";

// The same stage has a different ruleset id on every chain, so a stage is
// addressed across chains by its INDEX in the chronological ruleset list.
const pairs = [
  {
    peerChainId: 8453,
    projectId: 3n,
    rulesets: [{ id: 1_700_000_001 }, { id: 1_700_000_002 }],
  },
  {
    peerChainId: 10,
    projectId: 7n,
    rulesets: [{ id: 1_800_000_001 }, { id: 1_800_000_002 }],
  },
];

describe("chainsAtStage", () => {
  it("maps a stage index to each chain's own ruleset id", () => {
    expect(chainsAtStage(pairs, 1)).toEqual([
      { chainId: 8453, projectId: 3n, rulesetId: 1_700_000_002n },
      { chainId: 10, projectId: 7n, rulesetId: 1_800_000_002n },
    ]);
  });

  it("selects stage 1 at index 0", () => {
    expect(chainsAtStage(pairs, 0).map((c) => c.rulesetId)).toEqual([
      1_700_000_001n,
      1_800_000_001n,
    ]);
  });

  it("yields no chains when handed a ruleset id instead of an index", () => {
    // The regression: ruleset ids are ~1.7e9 timestamps, so every chain gets
    // filtered out and the dialog opens with zero rows and zero chains.
    expect(chainsAtStage(pairs, 1_700_000_002)).toEqual([]);
  });

  it("skips chains that have no ruleset at that stage", () => {
    expect(
      chainsAtStage([pairs[0], { peerChainId: 10, projectId: 7n, rulesets: [{ id: 5 }] }], 1),
    ).toEqual([{ chainId: 8453, projectId: 3n, rulesetId: 1_700_000_002n }]);
  });

  it("tolerates pairs whose rulesets have not loaded", () => {
    expect(chainsAtStage([{ peerChainId: 10, projectId: 7n }], 0)).toEqual([]);
  });
});

describe("effectiveSplitPercent", () => {
  // `percent` is out of SPLITS_TOTAL_PERCENT (1e9) of the stage's split limit;
  // the limit is stored in the ruleset metadata out of 10_000 (2.5% = 250).
  it("keeps a fractional split limit intact", () => {
    expect(effectiveSplitPercent(1_000_000_000n, 250n)).toBe("2.5");
    expect(effectiveSplitPercent(1_000_000_000n, 40n)).toBe("0.4");
  });

  it("does not round a sub-1% limit away to zero", () => {
    expect(effectiveSplitPercent(500_000_000n, 40n)).toBe("0.2");
  });

  it("handles whole-number limits", () => {
    expect(effectiveSplitPercent(1_000_000_000n, 10_000n)).toBe("100");
    expect(effectiveSplitPercent(500_000_000n, 2_000n)).toBe("10");
  });

  it("keeps seven decimals of a split's share", () => {
    expect(effectiveSplitPercent(333_333_333n, 250n)).toBe("0.8333333");
  });

  it("is zero for a zero limit", () => {
    expect(effectiveSplitPercent(1_000_000_000n, 0n)).toBe("0");
  });
});

describe("emptySaveBlockMessage", () => {
  const nameOf = (chainId: number) => (chainId === 8453 ? "Base" : "Optimism");

  it("allows an empty save when the fallback group is empty", () => {
    expect(
      emptySaveBlockMessage(
        [{ chainId: 8453, selected: true, splitCount: 0, fallbackSplitCount: 0 }],
        nameOf,
      ),
    ).toBeNull();
  });

  it("allows a non-empty save even when the fallback group is populated", () => {
    expect(
      emptySaveBlockMessage(
        [{ chainId: 8453, selected: true, splitCount: 2, fallbackSplitCount: 3 }],
        nameOf,
      ),
    ).toBeNull();
  });

  it("ignores unselected chains", () => {
    expect(
      emptySaveBlockMessage(
        [{ chainId: 8453, selected: false, splitCount: 0, fallbackSplitCount: 3 }],
        nameOf,
      ),
    ).toBeNull();
  });

  it("blocks an empty save that would activate the project's default splits", () => {
    const message = emptySaveBlockMessage(
      [{ chainId: 8453, selected: true, splitCount: 0, fallbackSplitCount: 3 }],
      nameOf,
    );
    expect(message).toContain("Base");
    expect(message).toContain("default splits");
    expect(message).toContain("3 recipients");
  });

  it("uses the singular for a one-recipient fallback group", () => {
    expect(
      emptySaveBlockMessage(
        [{ chainId: 10, selected: true, splitCount: 0, fallbackSplitCount: 1 }],
        nameOf,
      ),
    ).toContain("1 recipient)");
  });

  it("fails closed when the fallback group could not be read", () => {
    const message = emptySaveBlockMessage(
      [{ chainId: 10, selected: true, splitCount: 0, fallbackSplitCount: null }],
      nameOf,
    );
    expect(message).toContain("Optimism");
    expect(message).toMatch(/couldn't|could not/i);
  });

  it("reports every blocked chain", () => {
    const message = emptySaveBlockMessage(
      [
        { chainId: 8453, selected: true, splitCount: 0, fallbackSplitCount: 2 },
        { chainId: 10, selected: true, splitCount: 0, fallbackSplitCount: null },
      ],
      nameOf,
    );
    expect(message).toContain("Base");
    expect(message).toContain("Optimism");
  });
});
