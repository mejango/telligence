import { buildTierConfigs, newDraftItem } from "@/components/shop/itemDraft";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const beneficiaryA = "0x1111111111111111111111111111111111111111";
const beneficiaryB = "0x2222222222222222222222222222222222222222";

describe("revnet shop item editor", () => {
  it("makes new items permanently transferable by default", () => {
    const result = buildTierConfigs([{ ...newDraftItem(), price: "1" }], 6);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    expect(result[0].flags.transfersPausable).toBe(false);
  });

  it("encodes every advanced item setting into adjustTiers", () => {
    const item = {
      ...newDraftItem(),
      price: "25",
      supply: "100",
      category: "3",
      reserveFrequency: "10",
      reserveBeneficiary: beneficiaryA,
      discountPct: "12.5",
      votingUnits: "7",
      splits: [
        { percent: "20", beneficiary: beneficiaryA },
        { percent: "30", beneficiary: beneficiaryB },
      ],
      allowOwnerMint: true,
      nonTransferable: true,
      cantBeRemoved: true,
      allowCredits: false,
      operatorCanEditDiscount: false,
    };

    const result = buildTierConfigs([item], 6);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    expect(result[0]).toMatchObject({
      price: 25_000_000n,
      initialSupply: 100,
      category: 3,
      reserveFrequency: 10,
      reserveBeneficiary: beneficiaryA,
      discountPercent: 25,
      votingUnits: 7,
      splitPercent: 500_000_000,
      flags: {
        allowOwnerMint: true,
        transfersPausable: true,
        useVotingUnits: true,
        cantBeRemoved: true,
        cantIncreaseDiscountPercent: true,
        cantBuyWithCredits: true,
      },
    });
    expect(result[0].splits.map((split) => split.percent)).toEqual([400_000_000, 600_000_000]);
    expect(result[0].splits.map((split) => split.beneficiary)).toEqual([
      beneficiaryA,
      beneficiaryB,
    ]);
  });

  it("rejects sales splits above 100 percent", () => {
    const item = {
      ...newDraftItem(),
      price: "1",
      splits: [
        { percent: "60", beneficiary: beneficiaryA },
        { percent: "50", beneficiary: beneficiaryB },
      ],
    };
    expect(buildTierConfigs([item], 6)).toBe("sales splits cannot add up to more than 100%.");
  });

  it("rejects a split too small to encode instead of writing a zero-percent row", () => {
    // HEAD's hand-rolled remainder correction turned this into [1e9, 0] — a split that can
    // never pay its beneficiary anything, encoded into the tier without a word.
    const item = {
      ...newDraftItem(),
      price: "1",
      splits: [
        { percent: "50", beneficiary: beneficiaryA },
        { percent: "0.000000001", beneficiary: beneficiaryB },
      ],
    };
    expect(buildTierConfigs([item], 6)).toBe(
      "split 2 is too small a share of the other splits to encode.",
    );
  });

  it("never produces a negative percent when many rows round down", () => {
    // 15 rows of 6.6666666 plus a tiny trailing row drove HEAD's last-entered row to -5,
    // which viem rejects for a uint field — the operator saw only a generic failure.
    const item = {
      ...newDraftItem(),
      price: "1",
      splits: [
        ...Array.from({ length: 15 }, () => ({ percent: "6.6666666", beneficiary: beneficiaryA })),
        { percent: "0.00000001", beneficiary: beneficiaryB },
      ],
    };
    expect(buildTierConfigs([item], 6)).toBe(
      "split 16 is too small a share of the other splits to encode.",
    );
  });

  it("gives the rounding remainder to the largest row and totals exactly 1e9", () => {
    const item = {
      ...newDraftItem(),
      price: "1",
      splits: [
        { percent: "33.33", beneficiary: beneficiaryA },
        { percent: "33.33", beneficiary: beneficiaryA },
        { percent: "33.34", beneficiary: beneficiaryB },
      ],
    };
    const result = buildTierConfigs([item], 6);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    const percents = result[0].splits.map((split) => split.percent);
    expect(percents.reduce((total, value) => total + value, 0)).toBe(1e9);
    expect(percents.every((percent) => percent > 0)).toBe(true);
  });

  it("keeps the basic fields compact and the protocol controls behind More options", () => {
    // The fields themselves are shared with the create flow's store section.
    const fields = readFileSync("src/components/shop/ItemDraftFields.tsx", "utf8");
    for (const label of [
      "Upload media",
      "Short description (optional)",
      "More options",
      "Split sales",
      "Discount",
      "Reserve inventory",
      "Voting power",
      "Item rules",
    ]) {
      expect(fields).toContain(label);
    }

    const source = readFileSync("src/app/[slug]/components/v6/shop/AddItemsModal.tsx", "utf8");
    for (const label of ["Add on", "Add items"]) {
      expect(source).toContain(label);
    }
    // Permission-before-upload behavior is exercised by shop-multichain-dialogs.test.tsx.
  });
});
