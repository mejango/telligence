import {
  combinedDescription,
  type ActivityEvent,
} from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import {
  foldSameTxActivities,
  groupSameTxEvents,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { describe, expect, it } from "vitest";

function row(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: "e",
    type: "in",
    txHash: "0xtx",
    timestamp: 1,
    beneficiary: "0xpayer" as ActivityEvent["beneficiary"],
    chainId: 8453 as ActivityEvent["chainId"],
    ...overrides,
  };
}

// The buyback shape: the pay row and the pool-swap row share one tx. They must
// fold into ONE line item attributed to the payer, with the pay's amount and
// memo, and both actions in the sentence.
const pay = row({
  id: "a",
  tokenCount: "0",
  memo: "gm",
  baseAmount: "20",
  baseTokenSymbol: "USDC",
});
const swap = row({
  id: "b",
  type: "swapBuy",
  beneficiary: "0xbundler" as ActivityEvent["beneficiary"],
  tokenCount: "28.4k",
});

describe("groupSameTxEvents", () => {
  it("folds same-tx rows and keeps other txs separate", () => {
    const other = row({ id: "c", txHash: "0xother" });
    const grouped = groupSameTxEvents([swap, pay, other]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].beneficiary).toBe("0xpayer");
    expect(grouped[0].also).toHaveLength(1);
    expect(grouped[1].also).toBeUndefined();
  });
});

describe("foldSameTxActivities + combinedDescription", () => {
  it("reads as one sentence — pay first, remint explained via the reserve", () => {
    const remint = row({
      id: "d",
      type: "mint",
      tokenCount: "17k",
      detail: "after the 40% split",
    });
    const folded = foldSameTxActivities([swap, remint, pay]);
    expect(folded.memo).toBe("gm");
    expect(folded.baseAmount).toBe("20");
    // The zero-issuance pay anchors the row but contributes no fragment —
    // the amount + "in" tag already say "paid in".
    expect(combinedDescription(folded, "ART")).toBe(
      "bought 28.4k ART via the buyback pool and received 17k ART after the 40% split",
    );
  });

  it("leaves a lone row untouched", () => {
    expect(foldSameTxActivities([pay])).toBe(pay);
    expect(combinedDescription(pay, "ART")).toBe("paid in");
  });
});
