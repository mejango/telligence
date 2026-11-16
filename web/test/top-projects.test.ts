import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));
vi.mock("@/lib/bendystraw/query.server", () => ({
  queryBendystraw: mocks.request,
}));

import { getTopProjects } from "@/app/getTopProjects";

const project = (overrides: Record<string, unknown>) => ({
  chainId: 1,
  isRevnet: true,
  name: "Canonical",
  projectId: 7,
  version: 6,
  ...overrides,
});

describe("top-project derivative availability", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("keeps the landing page available when Bendystraw is unavailable", async () => {
    mocks.request.mockRejectedValue(new Error("index unavailable"));

    await expect(getTopProjects()).resolves.toEqual([]);
  });

  it("returns nothing for an empty derivative result", async () => {
    mocks.request.mockResolvedValue({ suckerGroups: { items: [] } });

    await expect(getTopProjects()).resolves.toEqual([]);
  });

  it("ranks revnets by the indexer's USD balance, whatever tokens they hold", async () => {
    mocks.request.mockResolvedValue({
      suckerGroups: {
        items: [
          // ETH and USDC: the raw balance adds 18- and 6-decimal units.
          {
            balanceUsd: "6000000000000000000000",
            projects: {
              items: [
                project({
                  logoUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3nuy5v7pnpubszuztzlyh7uqa",
                  projectTagline: "Contract-derived economics",
                }),
              ],
            },
          },
          {
            balanceUsd: "999999000000000000000000",
            projects: { items: [project({ isRevnet: false, projectId: 8 })] },
          },
          {
            balanceUsd: "7000000000000000000000",
            projects: { items: [project({ chainId: 8453, name: "Usdc", projectId: 9 })] },
          },
          // An unpriced group is left out rather than ranked as zero.
          { balanceUsd: null, projects: { items: [project({ projectId: 10 })] } },
        ],
      },
    });

    await expect(getTopProjects()).resolves.toEqual([
      expect.objectContaining({ balanceUsd: 7_000, chainSlug: "base", projectId: 9, rank: 1 }),
      expect.objectContaining({ balanceUsd: 6_000, chainSlug: "eth", projectId: 7, rank: 2 }),
    ]);
  });

  it("links a cross-chain group to the member holding its balance", async () => {
    mocks.request.mockResolvedValue({
      suckerGroups: {
        items: [
          {
            balanceUsd: "8985000000000000000000",
            projects: {
              items: [
                project({ balanceUsd: "7600000000000000000" }),
                project({ balanceUsd: "0", chainId: 10 }),
                project({ balanceUsd: "8977000000000000000000", chainId: 8453 }),
                project({ balanceUsd: "0", chainId: 42161 }),
              ],
            },
          },
          // Equal balances keep the first member.
          {
            balanceUsd: "20000000000000000000",
            projects: {
              items: [
                project({ balanceUsd: "10000000000000000000", projectId: 8 }),
                project({ balanceUsd: "10000000000000000000", chainId: 8453, projectId: 8 }),
              ],
            },
          },
          // Unpriced members keep the first member.
          {
            balanceUsd: "10000000000000000000",
            projects: {
              items: [
                project({ balanceUsd: null, projectId: 9 }),
                project({ chainId: 8453, projectId: 9 }),
              ],
            },
          },
        ],
      },
    });

    await expect(getTopProjects()).resolves.toEqual([
      expect.objectContaining({ chainId: 8453, chainSlug: "base", projectId: 7 }),
      expect.objectContaining({ chainId: 1, chainSlug: "eth", projectId: 8 }),
      expect.objectContaining({ chainId: 1, chainSlug: "eth", projectId: 9 }),
    ]);
  });
});
