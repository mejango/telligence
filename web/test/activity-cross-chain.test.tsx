import { ActivityFeed } from "@/app/[slug]/components/ActivityFeed/ActivityFeed";
import { ActivityItemRow } from "@/app/[slug]/components/ActivityFeed/ActivityItem";
import {
  groupCrossChainPoolEvents,
  groupSameTxEvents,
  mapActivityEvents,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({ useCompleteActivityEvents: query }));
vi.mock("@/components/ProfilesContext", () => ({
  ProfilesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ProfileAvatar", () => ({
  ProfileAvatar: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/app/[slug]/components/ActivityFeed/PendingRoutingPayments", () => ({
  PendingRoutingPayments: () => null,
}));
vi.mock("@/lib/nana/project", async (original) => ({
  ...(await original<object>()),
  useJBTokenContext: () => ({ token: { data: { symbol: "REV" } } }),
  useJBChainId: () => 1,
  useChain: () => undefined,
}));

const actor = "0x755ff2f75a0a586ecfa2b9a3c959cb662458a105";
const otherActor = "0x1111111111111111111111111111111111111111";
const emptyEvents = {
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
};

// The four public pool updates from the reported Revnet Network screenshot.
const poolUpdates = [
  [1, 1791342659, "0xfffdb8daa316118f249dc3e63b22016e9e5a003cf2ce9964cfd406ea9728a7bb"],
  [8453, 1791342651, "0xdf1c8a73a884e1953ff8f7ee60c8a9df16b7f2d81268e3fb40dff296aed8b3ba"],
  [10, 1791342651, "0xd1aa3a4da678c670a186e5b04e706134773101cf25f3a266c947ec9b64b27248"],
  [42161, 1791342649, "0x84ec65fd66ee6cc8854ed84833a94017bbc2ebeadb7df5deee138c7209b2a8d5"],
] as const;

function poolEvent(
  index: number,
  { from = actor, timestamp, txHash }: { from?: string; timestamp?: number; txHash?: string } = {},
): ActivityEventItem {
  const [chainId, time, hash] = poolUpdates[index];
  const base = { timestamp: timestamp ?? time, txHash: txHash ?? hash };
  return {
    ...emptyEvents,
    ...base,
    id: `pool:${chainId}:${base.txHash}`,
    chainId,
    buybackPoolEvent: { ...base, from, caller: "0x72f55a54cd53410a5ff175508a5a384227081788" },
  };
}

function balanceEvent(index: number, txHash?: string): ActivityEventItem {
  const source = poolEvent(index, { txHash });
  return {
    ...source,
    id: `balance:${source.id}`,
    buybackPoolEvent: null,
    addToBalanceEvent: {
      txHash: source.txHash,
      timestamp: source.timestamp,
      from: actor,
      caller: actor,
      amount: String(10n ** 18n + BigInt(index)),
      memo: "",
      amountUsd: "0",
    },
  } as ActivityEventItem;
}

const map = (events: ActivityEventItem[]) =>
  mapActivityEvents(events, () => ({ tokenSymbol: "ETH", decimals: 18 }));
const group = (events: ActivityEventItem[]) =>
  groupCrossChainPoolEvents(groupSameTxEvents(map(events)));
const projects = poolUpdates.map(([chainId]) => ({
  chainId,
  projectId: 3,
  version: 6,
  tokenSymbol: "ETH",
  decimals: 18,
})) as ComponentProps<typeof ActivityFeed>["projects"];

beforeEach(() => query.mockReturnValue({ data: [], isLoading: false, isError: false }));

describe("project cross-chain pool activity", () => {
  it("maps the four reported updates into one chronological row with every accessible explorer link", () => {
    const input = poolUpdates.map((_, index) => poolEvent(index));
    const rows = group(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: input[0].id,
      timestamp: input[0].timestamp,
      txHash: input[0].txHash,
      beneficiary: actor,
      chains: input.map(({ chainId, txHash }) => ({ chainId, txHash })),
    });
    render(<ActivityItemRow event={rows[0]} projectTokenSymbol="REV" />);
    expect(screen.getByText("Buyback pool", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("by", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText("set the buyback pool")).toHaveLength(1);
    for (const [index, [name, explorer]] of [
      ["Ethereum", "https://etherscan.io"],
      ["Base", "https://basescan.org"],
      ["Optimism", "https://optimistic.etherscan.io"],
      ["Arbitrum", "https://arbiscan.io"],
    ].entries()) {
      expect(screen.getByRole("link", { name: `View transaction on ${name}` })).toHaveAttribute(
        "href",
        `${explorer}/tx/${input[index].txHash}`,
      );
    }
  });

  it.each([
    ["1000000000000000000000000", "1M", "1,000,000"],
    ["1234567890123456789012345", "1.23M", "1,234,567.890123456789012345"],
    ["1", "0.000000000000000001", "0.000000000000000001"],
  ])("compacts auto issuance while retaining the exact amount %s", (count, compact, exact) => {
    const source = poolEvent(0);
    const autoIssue = {
      ...source,
      buybackPoolEvent: null,
      autoIssueEvent: {
        id: "auto-issue-1",
        txHash: source.txHash,
        timestamp: source.timestamp,
        from: otherActor,
        beneficiary: actor,
        count,
      },
    };
    const [row] = map([autoIssue]);
    expect(row).toMatchObject({
      id: source.id,
      txHash: source.txHash,
      beneficiary: actor,
      chainId: source.chainId,
      tokenCount: compact,
      exactTokenCount: exact,
    });
    render(<ActivityItemRow event={row} projectTokenSymbol="BAN" />);
    expect(screen.getByText("Auto issuance", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("to", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(actor, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("by", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(otherActor, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByTitle(`${exact} BAN`)).toHaveTextContent(`${compact} BAN`);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent(`auto-issued ${compact} BAN`);
  });

  it("labels a mint without changing its receipt or adding an auto-issuance claim", () => {
    const source = poolEvent(0);
    const [row] = map([
      {
        ...source,
        buybackPoolEvent: null,
        mintTokensEvent: {
          id: "mint-1",
          txHash: source.txHash,
          timestamp: source.timestamp,
          from: otherActor,
          caller: otherActor,
          beneficiary: actor,
          beneficiaryTokenCount: "1000000000000000000000000",
          memo: null,
        },
      },
    ]);
    render(<ActivityItemRow event={row} projectTokenSymbol="BAN" />);
    expect(screen.getByText("Minted", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("to", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(actor, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("by", { exact: true })).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("minted 1M BAN");
    expect(screen.queryByText(/auto-issued/)).not.toBeInTheDocument();
  });

  it.each([
    { type: "in" as const, prefix: "from" },
    { type: "out" as const, prefix: "to" },
  ])("keeps $type amounts and the $prefix actor prefix", ({ type, prefix }) => {
    render(
      <ActivityItemRow
        event={{
          id: "flow-1",
          type,
          txHash: poolUpdates[0][2],
          timestamp: poolUpdates[0][1],
          beneficiary: actor,
          chainId: 1,
          baseAmount: "1",
          baseTokenSymbol: "ETH",
          exactAmount: "1 ETH",
          tokenCount: "10",
        }}
        projectTokenSymbol="BAN"
      />,
    );
    expect(screen.getByText(type, { exact: true })).toBeInTheDocument();
    expect(screen.getByText(prefix, { exact: true })).toBeInTheDocument();
    expect(screen.getByTitle("1 ETH")).toHaveTextContent("1 ETH");
    expect(screen.queryByText("Payment", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Cash out", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps different actors, same-chain repeats and updates beyond six hours separate", () => {
    const first = poolEvent(0);
    expect(group([first, poolEvent(1, { from: otherActor })])).toHaveLength(2);
    expect(group([first, poolEvent(0, { txHash: `0x${"a".repeat(64)}` })])).toHaveLength(2);
    expect(
      group([first, poolEvent(1, { timestamp: first.timestamp - 6 * 3600 - 1 })]),
    ).toHaveLength(2);
  });

  it("does not merge financial rows or pool updates folded with another action", () => {
    const amounts = group([balanceEvent(0), balanceEvent(1)]);
    expect(amounts).toHaveLength(2);
    // These raw amounts differ by one wei but share an abbreviated display.
    expect(amounts[0].baseAmount).toBe(amounts[1].baseAmount);
    expect(amounts.every((row) => row.chains === undefined)).toBe(true);
    const mixed = group([poolEvent(0), balanceEvent(0), poolEvent(1), balanceEvent(1)]);
    expect(mixed).toHaveLength(2);
    expect(mixed.every((row) => row.also?.some((event) => event.type === "buybackPool"))).toBe(
      true,
    );
    expect(mixed.every((row) => row.chains === undefined)).toBe(true);
  });

  it("filters before folding so selecting pool updates combines previously mixed transactions", () => {
    query.mockReturnValue({
      data: [poolEvent(0), balanceEvent(0), poolEvent(1), balanceEvent(1)],
      isLoading: false,
      isError: false,
    });
    render(<ActivityFeed suckerGroupId="revnet-network" projects={projects} />);
    expect(screen.getAllByText("set the buyback pool")).toHaveLength(2);
    fireEvent.click(screen.getByText("All", { selector: "summary span" }));
    fireEvent.click(screen.getByLabelText("Add to balance"));
    expect(screen.getAllByText("set the buyback pool")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /View transaction on/ })).toHaveLength(2);
  });

  it("groups before pagination so a first-page row retains chains beyond the ten-item boundary", () => {
    const fillers = Array.from({ length: 9 }, (_, index) =>
      balanceEvent(0, `0x${String(index + 1).padStart(64, "0")}`),
    );
    query.mockReturnValue({
      data: [poolEvent(0), ...fillers, poolEvent(1), poolEvent(2), poolEvent(3)],
      isLoading: false,
      isError: false,
    });
    render(<ActivityFeed suckerGroupId="revnet-network" projects={projects} />);
    expect(screen.getAllByText("set the buyback pool")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /View transaction on/ })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "more" })).not.toBeInTheDocument();
  });
});
