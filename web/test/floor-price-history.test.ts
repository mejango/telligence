import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), group: vi.fn() }));

vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/app/[slug]/getSuckerGroup", () => ({ getSuckerGroup: mocks.group }));

import { getFloorPriceHistory } from "@/app/[slug]/components/TokenPrice/getFloorPriceHistory";

const ETH = "0x000000000000000000000000000000000000EEEe";
const page = (items: unknown[]) => ({ items, pageInfo: { hasNextPage: false, endCursor: null } });
const options = {
  suckerGroupId: "group",
  chainId: 1,
  projectId: 8,
  baseToken: ETH,
  baseTokenDecimals: 18,
  currentCashOutTax: 0,
  projectStart: 0,
};

describe("cash-out floor history", () => {
  beforeEach(() => {
    mocks.query.mockImplementation(async (_chainId, operation) => {
      switch (operation.id) {
        case "cash-out-tax-snapshots.v1":
          return { cashOutTaxSnapshots: page([]) };
        case "sucker-group-moments.v1":
          return {
            suckerGroupMoments: page([
              {
                timestamp: 10,
                balance: "2000000000",
                balanceUsd: "2000000000000000000000",
                tokenSupply: "1000000000000000000000",
                accountingTokenUsdRate: "1000000000000000000",
              },
              {
                // 1 ETH plus 2,000 USDC: the raw sum is neither token's units.
                timestamp: 100,
                balance: "1000000002000000000",
                balanceUsd: "4000000000000000000000",
                tokenSupply: "1000000000000000000000",
                accountingTokenUsdRate: "1000000000000000000",
              },
            ]),
          };
        case "project-token-balance-moments.v1":
          return {
            projectTokenBalanceMoments: page([
              {
                token: ETH.toLowerCase(),
                decimals: 18,
                timestamp: 50,
                balance: "1000000000000000000",
                tokenUsdRate: "2000000000000000000000",
              },
            ]),
          };
      }
      throw new Error(`unexpected ${operation.id}`);
    });
  });

  it("values a multi-token group in USD, expressed in the accounting token at its own rate", async () => {
    mocks.group.mockResolvedValue({
      projects: { items: [{ tokenSymbol: "ETH", decimals: 18, accountingTokenCount: 2 }] },
    });

    const points = await getFloorPriceHistory(options);

    // The moment before any ETH rate is left out rather than read in mixed units.
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      timestamp: 100,
      floorPrice: 0.002,
      totalBalance: "2000000000000000000",
      accountingTokenUsdRate: 2000,
    });
  });

  it.each([
    ["could not be read", null],
    [
      "are two tokens sharing a name",
      {
        projects: {
          items: [
            {
              token: "0x00000000000000000000000000000000000000aa",
              tokenSymbol: "CASH",
              decimals: 18,
            },
            {
              token: "0x00000000000000000000000000000000000000bb",
              tokenSymbol: "CASH",
              decimals: 18,
            },
          ],
        },
      },
    ],
    [
      "include one without a readable symbol",
      {
        projects: {
          items: [
            {
              token: "0x00000000000000000000000000000000000000aa",
              tokenSymbol: "CASH",
              decimals: 18,
            },
            {
              token: "0x00000000000000000000000000000000000000bb",
              tokenSymbol: null,
              decimals: 18,
            },
          ],
        },
      },
    ],
  ])("takes the USD path when the group's tokens %s", async (_case, group) => {
    mocks.group.mockResolvedValue(group);

    const points = await getFloorPriceHistory(options);

    expect(points.map((point) => point.floorPrice)).toEqual([0.002]);
  });

  it("keeps the exact raw balance for a single-token group", async () => {
    mocks.group.mockResolvedValue({
      projects: { items: [{ tokenSymbol: "ETH", decimals: 18, accountingTokenCount: 1 }] },
    });

    const points = await getFloorPriceHistory(options);

    expect(points.map((point) => point.totalBalance)).toEqual([
      "2000000000",
      "1000000002000000000",
    ]);
    expect(mocks.query).not.toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: "project-token-balance-moments.v1" }),
      expect.anything(),
    );
  });
});
