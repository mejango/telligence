import { combinedDescription } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import {
  groupSameTxEvents,
  mapActivityEvents,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import type { HomepageRawActivity } from "@/app/getHomepageActivity";
import { HomepageActivityFeed } from "@/app/HomepageActivityFeed";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/DateRelative", () => ({ DateRelative: () => null }));
vi.mock("@/components/IpfsImage", () => ({ IpfsImage: () => null }));
vi.mock("@/components/IssuanceFingerprint", () => ({ IssuanceFingerprint: () => null }));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/hooks/useInfiniteScroll", () => ({ useInfiniteScroll: () => undefined }));

const account = "0x1111111111111111111111111111111111111111";
const txHash = "0xaaa";
const timestamp = 1_700_000_000;

function activity(overrides: Partial<HomepageRawActivity> = {}): HomepageRawActivity {
  return {
    id: "activity-1",
    chainId: 8453,
    timestamp,
    txHash,
    tokenTicker: "SBB",
    project: {
      id: "8453:3:6",
      projectId: 3,
      chainId: 8453,
      version: 6,
      name: "Slopshop",
      handle: "slopshop",
      logoUri: null,
      projectTagline: null,
      tokenSymbol: "ETH",
      decimals: 18,
      isRevnet: true,
      suckerGroupId: "slopshop-group",
    },
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
    ...overrides,
  };
}

function swap(direction: string, overrides: Partial<HomepageRawActivity> = {}) {
  return activity({
    id: `swap-${direction}`,
    swapEvent: {
      txHash,
      timestamp,
      direction,
      terminalTokenAmount: "23000000000000",
      projectTokenAmount: "2340000000000000000",
      caller: "0x2222222222222222222222222222222222222222",
      from: account,
    },
    ...overrides,
  });
}

function cashOut() {
  return activity({
    id: "cash-out",
    cashOutTokensEvent: {
      id: "cash-out-event",
      txHash,
      timestamp,
      from: account,
      beneficiary: account,
      reclaimAmount: "23000000000000",
      reclaimAmountUsd: "0",
      cashOutCount: "2390000000000000000",
      metadata: "0x",
      project: activity().project!,
    },
  });
}

const map = (items: ActivityEventItem[]) =>
  mapActivityEvents(items, () => ({ tokenSymbol: "ETH", decimals: 18 }));

describe("activity swap direction", () => {
  it.each([
    ["buy", "swapBuy", "bought 2.34 SBB via the buyback pool", "in"],
    ["sell", "swapSell", "sold 2.34 SBB via the buyback pool", "out"],
    ["SELL", "swapSell", "sold 2.34 SBB via the buyback pool", "out"],
    ["mint", "issuance", "bought 2.34 SBB from issuance", "in"],
    ["unknown", "swap", "swapped 2.34 SBB via the buyback pool", null],
    ["", "swap", "swapped 2.34 SBB via the buyback pool", null],
  ])(
    "uses the indexed %s direction in project, account, and homepage copy",
    (direction, type, copy, flow) => {
      const item = swap(direction);
      const [mapped] = map([item]);
      expect(mapped).toMatchObject({ type, beneficiary: account, tokenCount: "2.34" });
      expect(combinedDescription(mapped, "SBB")).toBe(copy);

      render(<HomepageActivityFeed initialEvents={[item]} initialHasMore={false} />);
      expect(screen.getByText(copy, { exact: false })).toBeInTheDocument();
      if (flow) expect(screen.getByText(flow, { exact: true })).toBeInTheDocument();
      else {
        expect(screen.queryByText("in", { exact: true })).not.toBeInTheDocument();
        expect(screen.queryByText("out", { exact: true })).not.toBeInTheDocument();
      }
    },
  );

  it("describes a cash out and its pool sale without turning the sale into a purchase", () => {
    const items = [swap("sell"), cashOut()];
    const [group] = groupSameTxEvents(map(items));
    expect(group.type).toBe("out");
    const copy = "cashed out 2.39 SBB and sold 2.34 SBB via the buyback pool";
    expect(combinedDescription(group, "SBB")).toBe(copy);

    render(<HomepageActivityFeed initialEvents={items} initialHasMore={false} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(copy, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/bought/)).not.toBeInTheDocument();
  });

  it("keeps a genuine fee-project purchase separate from the same transaction's sale", () => {
    const purchase = swap("buy", {
      tokenTicker: "JBX",
      project: { ...activity().project!, id: "8453:1:6", projectId: 1, name: "Fee project" },
    });
    const items = [cashOut(), swap("sell"), purchase];
    expect(map(items).map((event) => event.type)).toEqual(["out", "swapSell", "swapBuy"]);

    render(<HomepageActivityFeed initialEvents={items} initialHasMore={false} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/cashed out 2.39 SBB and sold 2.34 SBB/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/bought 2.34 JBX via the buyback pool/)).toBeInTheDocument();
  });

  it.each(["mint", "sell"])(
    "does not infer a reserve percentage from a mixed buy/%s remint",
    (direction) => {
      const remint = activity({
        id: "remint",
        mintTokensEvent: {
          id: "remint-event",
          txHash,
          timestamp,
          from: account,
          caller: account,
          beneficiary: account,
          beneficiaryTokenCount: "1000000000000000000",
          memo: null,
        },
      });
      expect(
        map([swap("buy"), remint]).find((event) => event.id === "remint")?.detail,
      ).toBeDefined();
      expect(
        map([swap("buy"), swap(direction), remint]).find((event) => event.id === "remint")?.detail,
      ).toBeUndefined();

      // Another project's sale or leftover issuance cannot invalidate this
      // project's otherwise unambiguous buy/remint pair.
      const otherProject = swap(direction, {
        project: { ...activity().project!, projectId: 1, id: "8453:1:6" },
      });
      expect(
        map([swap("buy"), otherProject, remint]).find((event) => event.id === "remint")?.detail,
      ).toBeDefined();
    },
  );
});
