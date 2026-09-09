import { mergeAccountActivity } from "@/lib/bendystraw/accountActivity";
import { AccountActivityEventsOperation } from "@/lib/bendystraw/operations";
import { BENDYSTRAW_QUERY_REGISTRY } from "@/lib/bendystraw/registry.server";
import type { AccountActivityEventsQuery } from "@/lib/bendystraw/types";
import { describe, expect, it } from "vitest";

const ME = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

const PROJECT = {
  projectId: 3,
  handle: null,
  version: 6,
  chainId: 1,
  name: "Test",
  tokenSymbol: "TEST",
  decimals: 18,
};

function payEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    amount: "1000000000000000000",
    beneficiary: ME,
    memo: null,
    timestamp: 1_700_000_000,
    feeFromProject: null,
    newlyIssuedTokenCount: "1000000000000000000",
    from: ME,
    txHash: "0xaaa",
    amountUsd: "0",
    caller: ME,
    distributionFromProjectId: null,
    projectId: 3,
    project: null,
    ...overrides,
  };
}

function fromBranchItem(id: string, sub: Record<string, unknown>) {
  return {
    id,
    chainId: 1,
    timestamp: 1_700_000_000,
    txHash: "0xaaa",
    from: ME,
    project: PROJECT,
    payEvent: null,
    cashOutTokensEvent: null,
    addToBalanceEvent: null,
    mintTokensEvent: null,
    manualMintTokensEvent: null,
    autoIssueEvent: null,
    deployErc20Event: null,
    projectCreateEvent: null,
    projectTransferEvent: null,
    operatorPermissionsSetEvent: null,
    rulesetQueuedEvent: null,
    swapEvent: null,
    buybackPoolEvent: null,
    ...sub,
  };
}

describe("AccountActivityEvents query", () => {
  const query = BENDYSTRAW_QUERY_REGISTRY[AccountActivityEventsOperation.id].query;

  it("pins version 6 with an explicit AND group in the from branch", () => {
    // This Ponder version does not AND sibling fields inside OR branches, so
    // every branch must spell out its own AND group.
    expect(query).toMatch(
      /activityEvents\(\s*where:\s*\{\s*AND:\s*\[\s*\{\s*from:\s*\$address\s*\}\s*,?\s*\{\s*version:\s*6\s*\}\s*\]\s*\}/u,
    );
  });

  it("covers the beneficiary side through the beneficiary-bearing event roots", () => {
    // The top-level activityEventFilter has no beneficiary field, so the
    // beneficiary branch queries the sub-event tables that do.
    for (const root of [
      "payEvents",
      "cashOutTokensEvents",
      "mintTokensEvents",
      "manualMintTokensEvents",
      "autoIssueEvents",
      "sendReservedTokensToSplitEvents",
    ]) {
      expect(query).toContain(`${root}(`);
    }
    const beneficiaryGroups = query.match(
      /AND:\s*\[\s*\{\s*beneficiary:\s*\$address\s*\}\s*,?\s*\{\s*version:\s*6\s*\}\s*\]/gu,
    );
    expect(beneficiaryGroups).toHaveLength(6);
  });
});

describe("mergeAccountActivity", () => {
  it("dedupes rows that appear in both the from and beneficiary branches", () => {
    const data = {
      activityEvents: {
        items: [fromBranchItem("activity-1", { payEvent: payEvent("pay-1") })],
      },
      beneficiaryPayEvents: {
        items: [{ ...payEvent("pay-1"), chainId: 1, project: PROJECT }],
      },
    } as unknown as AccountActivityEventsQuery;

    const merged = mergeAccountActivity(data);

    expect(merged).toHaveLength(1);
    expect(merged[0].payEvent?.id).toBe("pay-1");
  });

  it("keeps beneficiary-only rows and sorts the merged feed newest first", () => {
    const data = {
      activityEvents: {
        items: [fromBranchItem("activity-1", { payEvent: payEvent("pay-1") })],
      },
      beneficiaryPayEvents: {
        items: [
          {
            ...payEvent("pay-2", {
              from: OTHER,
              beneficiary: ME,
              txHash: "0xbbb",
              timestamp: 1_700_000_010,
            }),
            chainId: 1,
            project: PROJECT,
          },
        ],
      },
      beneficiaryMintTokensEvents: {
        items: [
          {
            id: "mint-9",
            chainId: 1,
            timestamp: 1_700_000_005,
            txHash: "0xccc",
            from: OTHER,
            caller: OTHER,
            beneficiary: ME,
            beneficiaryTokenCount: "1000000000000000000",
            memo: null,
            project: PROJECT,
          },
        ],
      },
    } as unknown as AccountActivityEventsQuery;

    const merged = mergeAccountActivity(data);

    expect(merged.map((item) => item.id)).toEqual(["pay-2", "mint-9", "activity-1"]);
    const mint = merged.find((item) => item.id === "mint-9");
    expect(mint?.mintTokensEvent?.beneficiary).toBe(ME);
    expect(mint?.project?.tokenSymbol).toBe("TEST");
  });

  it("tolerates responses without the beneficiary roots", () => {
    const data = {
      activityEvents: {
        items: [fromBranchItem("activity-1", { payEvent: payEvent("pay-1") })],
      },
    } as unknown as AccountActivityEventsQuery;

    expect(mergeAccountActivity(data)).toHaveLength(1);
  });
});
