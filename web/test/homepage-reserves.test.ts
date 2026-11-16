// @vitest-environment jsdom
import { SecuredReserves } from "@/app/SecuredReserves";
import { getHomepageReserves } from "@/app/getHomepageReserves";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), groups: vi.fn() }));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/app/getTopProjects", () => ({ getHomepageSuckerGroups: mocks.groups }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/app/SecuredReserveChart", () => ({ SecuredReserveChart: () => null }));

const ETH = "0x000000000000000000000000000000000000eeee";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const e18 = (value: number) => `${value}000000000000000000`;
const page = (items: unknown[]) => ({ items, pageInfo: { hasNextPage: false, endCursor: null } });

const groups = [
  {
    // REV on Ethereum, holding ETH and USDC: its raw balance adds both tokens' units.
    id: "rev",
    balanceUsd: e18(2100),
    volumeUsd: e18(3000),
    projects: {
      items: [
        {
          chainId: 1,
          projectId: 3,
          version: 6,
          isRevnet: true,
          projectTokenBalances: {
            items: [
              {
                token: ETH,
                tokenSymbol: "ETH",
                decimals: 18,
                balance: e18(1),
                balanceUsd: e18(2000),
                usdRate: e18(2000),
              },
              {
                token: USDC,
                tokenSymbol: null,
                decimals: 6,
                balance: "100000000",
                balanceUsd: e18(100),
                usdRate: e18(1),
              },
            ],
          },
        },
      ],
    },
  },
  {
    id: "usdc",
    balanceUsd: e18(50),
    volumeUsd: e18(60),
    projects: {
      items: [
        {
          chainId: 8453,
          projectId: 7,
          version: 6,
          isRevnet: true,
          projectTokenBalances: {
            items: [
              {
                token: BASE_USDC,
                tokenSymbol: "USDC",
                decimals: 6,
                balance: "50000000",
                balanceUsd: e18(50),
                usdRate: e18(1),
              },
            ],
          },
        },
      ],
    },
  },
];

describe("homepage reserves", () => {
  beforeEach(() => {
    mocks.groups.mockResolvedValue(groups);
    mocks.query.mockImplementation(async (_chainId, operation, variables) => {
      switch (operation.id) {
        case "add-to-balance-inflows.v1":
          return {
            addToBalanceEvents: page([
              { suckerGroupId: "rev", timestamp: 150, amountUsd: e18(10) },
              { suckerGroupId: "not-a-revnet", timestamp: 150, amountUsd: e18(999) },
            ]),
          };
        case "sucker-group-moments.v1":
          return {
            suckerGroupMoments: page(
              variables.suckerGroupId === "rev"
                ? [
                    { timestamp: 100, balanceUsd: e18(2000), volumeUsd: e18(2000) },
                    { timestamp: 200, balanceUsd: e18(2100), volumeUsd: e18(3000) },
                  ]
                : [{ timestamp: 150, balanceUsd: e18(50), volumeUsd: e18(60) }],
            ),
          };
        case "project-token-balance-moments.v1":
          return {
            projectTokenBalanceMoments: page(
              variables.chainId === 1
                ? [
                    {
                      token: ETH,
                      decimals: 18,
                      timestamp: 100,
                      balance: e18(1),
                      tokenUsdRate: e18(2000),
                    },
                    {
                      token: USDC,
                      decimals: 6,
                      timestamp: 200,
                      balance: "100000000",
                      tokenUsdRate: e18(1),
                    },
                  ]
                : [
                    {
                      token: BASE_USDC,
                      decimals: 6,
                      timestamp: 150,
                      balance: "50000000",
                      tokenUsdRate: e18(1),
                    },
                  ],
            ),
          };
      }
      throw new Error(`unexpected ${operation.id}`);
    });
  });

  it("counts each token of a multi-token group in its own units and totals in USD", async () => {
    const reserves = await getHomepageReserves();

    expect(reserves.totalUsd).toBe(2150);
    expect(reserves.passedThroughUsd).toBe(3070);
    expect(reserves.chains).toEqual([
      { chainId: 1, eth: 1, usdc: 100, otherAssets: [] },
      { chainId: 8453, eth: 0, usdc: 50, otherAssets: [] },
      { chainId: 42161, eth: 0, usdc: 0, otherAssets: [] },
      { chainId: 10, eth: 0, usdc: 0, otherAssets: [] },
    ]);
    expect(reserves.points?.at(-1)).toEqual({
      timestamp: 200,
      valueUsd: 2150,
      chains: [
        { chainId: 1, valueUsd: 2100 },
        { chainId: 8453, valueUsd: 50 },
        { chainId: 42161, valueUsd: 0 },
        { chainId: 10, valueUsd: 0 },
      ],
    });
    expect(reserves.volumePoints?.at(-1)?.valueUsd).toBe(3070);
    // REV's inflows: 1 ETH and 100 USDC, each at its own latest rate.
    expect(reserves.feesUsd).toBe(2100);
  });

  it("keeps chain history usable through an unpriced moment and a missing current row", async () => {
    mocks.groups.mockResolvedValue([
      {
        ...groups[0],
        projects: {
          items: [{ ...groups[0].projects.items[0], projectTokenBalances: { items: [] } }],
        },
      },
    ]);
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (chainId, operation, variables) =>
      operation.id === "project-token-balance-moments.v1"
        ? {
            projectTokenBalanceMoments: page([
              {
                token: ETH,
                decimals: 18,
                timestamp: 100,
                balance: e18(1),
                tokenUsdRate: e18(2000),
              },
              { token: ETH, decimals: 18, timestamp: 200, balance: e18(2), tokenUsdRate: null },
            ]),
          }
        : query(chainId, operation, variables),
    );

    const reserves = await getHomepageReserves();

    expect(reserves.points?.map((point) => point.chains[0])).toEqual([
      { chainId: 1, valueUsd: 2000 },
      { chainId: 1, valueUsd: 4000 },
    ]);
    // REV's fees value the unpriced moment at the last rate it had.
    expect(reserves.feesUsd).toBe(4000);
  });

  it("leaves out the chain breakdown when a deployment's history is unavailable", async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (chainId, operation, variables) => {
      if (operation.id === "project-token-balance-moments.v1" && variables.chainId === 8453) {
        throw new Error("index unavailable");
      }
      return query(chainId, operation, variables);
    });

    const reserves = await getHomepageReserves();

    expect(reserves.totalUsd).toBe(2150);
    expect(reserves.points?.every((point) => point.chains.length === 0)).toBe(true);
    expect(reserves.feesUsd).toBe(2100);
  });
  it("preserves the optional group fallback while strict homepage reads reject", async () => {
    const { getHomepageSuckerGroups } =
      await vi.importActual<typeof import("@/app/getTopProjects")>("@/app/getTopProjects");
    mocks.query.mockRejectedValue(new Error("index unavailable"));
    expect(await getHomepageSuckerGroups()).toEqual([]);
    await expect(getHomepageSuckerGroups({ strict: true })).rejects.toThrow("index unavailable");
  });

  it("keeps required group failures unavailable and recovers on a fresh read", async () => {
    mocks.groups.mockRejectedValue(new Error("index unavailable"));
    const failed = await getHomepageReserves();
    expect([failed.totalUsd, failed.passedThroughUsd, failed.feesUsd]).toEqual([null, null, null]);
    expect(failed.chains).toBeNull();
    mocks.groups.mockResolvedValue(groups);
    expect((await getHomepageReserves()).totalUsd).toBe(2150);
  });

  it("does not report partial REV fee history as a complete fee total", async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (chainId, operation, variables) => {
      if (operation.id === "project-token-balance-moments.v1" && variables.chainId === 1) {
        throw new Error("index unavailable");
      }
      return query(chainId, operation, variables);
    });
    const reserves = await getHomepageReserves();
    expect(reserves.totalUsd).toBe(2150);
    expect(reserves.feesUsd).toBeNull();
    expect(reserves.feePoints).toBeNull();
  });

  it("preserves valid empty reads as zero", async () => {
    mocks.groups.mockResolvedValue([]);
    mocks.query.mockResolvedValue({ addToBalanceEvents: page([]) });
    const empty = await getHomepageReserves();
    expect([empty.totalUsd, empty.passedThroughUsd, empty.feesUsd]).toEqual([0, 0, 0]);
    expect([empty.points, empty.volumePoints, empty.feePoints]).toEqual([[], [], []]);
  });

  it("does not substitute partial inflows or history for complete totals", async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (chainId, operation, variables) => {
      if (operation.id === "add-to-balance-inflows.v1") throw new Error("index unavailable");
      return query(chainId, operation, variables);
    });
    const inflows = await getHomepageReserves();
    expect(inflows.totalUsd).toBe(2150);
    expect(inflows.feesUsd).toBe(2100);
    expect(inflows.passedThroughUsd).toBeNull();
    expect(inflows.volumePoints).toBeNull();
    mocks.query.mockImplementation(async (chainId, operation, variables) => {
      if (operation.id === "sucker-group-moments.v1") throw new Error("index unavailable");
      return query(chainId, operation, variables);
    });
    const history = await getHomepageReserves();
    expect(history.totalUsd).toBe(2150);
    expect(history.passedThroughUsd).toBe(3070);
    expect(history.points).toBeNull();
    expect(history.volumePoints).toBeNull();
  });

  it("classifies canonical reserves by chain and address, not token symbols", async () => {
    const input = JSON.parse(JSON.stringify(groups));
    input[0].projects.items[0].projectTokenBalances.items.push(
      {
        token: "0x1111111111111111111111111111111111111111",
        tokenSymbol: "ETH",
        decimals: 18,
        balance: e18(1000),
        balanceUsd: e18(1000),
      },
      {
        token: "0x2222222222222222222222222222222222222222",
        tokenSymbol: "USDC",
        decimals: 6,
        balance: "3000000",
        balanceUsd: e18(3),
      },
      // Base's USDC address is not a canonical USDC deployment on Ethereum.
      {
        token: BASE_USDC,
        tokenSymbol: "USDC",
        decimals: 6,
        balance: "4000000",
        balanceUsd: e18(4),
      },
      { token: "", tokenSymbol: "ETH", decimals: 18, balance: e18(5), balanceUsd: e18(5) },
      {
        token: "0x3333333333333333333333333333333333333333",
        tokenSymbol: "ZERO",
        decimals: 0,
        balance: "0",
        balanceUsd: "0",
      },
    );
    mocks.groups.mockResolvedValue(input);
    const result = await getHomepageReserves();
    expect(result.chains?.find((chain) => chain.chainId === 1)).toEqual({
      chainId: 1,
      eth: 1,
      usdc: 100,
      otherAssets: ["ETH", "USDC"],
    });
    // These classifications do not change the indexer's USD headline.
    expect(result.totalUsd).toBe(2150);
  });
  it("renders failed reads as unavailable, refreshes, and recovers without inventing zero", async () => {
    mocks.groups.mockRejectedValue(new Error("index unavailable"));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      const failed = await getHomepageReserves();
      await act(async () => root.render(createElement(SecuredReserves, { data: failed })));
      expect(host.textContent).toContain("Unavailable");
      expect(host.textContent).not.toContain("$0.00");
      const retry = host.querySelector("button")!;
      expect(retry.textContent).toBe("Refresh");
      await act(async () => retry.click());
      expect(refresh).toHaveBeenCalled();
      mocks.groups.mockResolvedValue(groups);
      const recovered = await getHomepageReserves();
      await act(async () => root.render(createElement(SecuredReserves, { data: recovered })));
      expect(host.textContent).toContain("$2,150.00");
      expect(host.textContent).not.toContain("Unavailable");
      mocks.groups.mockResolvedValue([]);
      mocks.query.mockResolvedValue({ addToBalanceEvents: page([]) });
      const zero = await getHomepageReserves();
      await act(async () => root.render(createElement(SecuredReserves, { data: zero })));
      expect(host.textContent).toContain("$0.00");
      expect(host.textContent).not.toContain("Unavailable");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("renders a missing volume input independently from a known secured total", async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (chainId, operation, variables) => {
      if (operation.id === "add-to-balance-inflows.v1") throw new Error("index unavailable");
      return query(chainId, operation, variables);
    });
    const data = await getHomepageReserves();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(SecuredReserves, { data })));
      expect(host.textContent).toContain("$2,150.00");
      const select = host.querySelector("select")!;
      await act(async () => {
        select.value = "passedThrough";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(host.textContent).toContain("Unavailable");
      expect(host.textContent).toContain("Refresh");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
