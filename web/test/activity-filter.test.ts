import { activityCategory } from "@/app/[slug]/components/ActivityFeed/ActivityFeed";
import type { ActivityEvent } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import { describe, expect, it } from "vitest";

const event = (type: ActivityEvent["type"]) => ({ type }) as ActivityEvent;

describe("activity filter categories", () => {
  it("groups buy and sell swaps together while preserving distinct project actions", () => {
    expect(activityCategory(event("swapBuy"))).toBe("buybackSwap");
    expect(activityCategory(event("swapSell"))).toBe("buybackSwap");
    expect(activityCategory(event("swap"))).toBe("buybackSwap");
    expect(activityCategory(event("issuance"))).toBe("tokenMint");
    expect(activityCategory(event("addToBalance"))).toBe("addToBalance");
    expect(activityCategory(event("projectTransfer"))).toBe("ownershipTransfer");
  });
});
