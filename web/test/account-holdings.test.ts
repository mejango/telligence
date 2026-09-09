import { groupHoldings, type HoldingRow } from "@/app/account/[id]/components/TokenHoldings";
import {
  ACCOUNT_BENDYSTRAW_CHAIN_ID,
  projectRefKey,
  projectRefsWhere,
  projectRefsWheres,
  REF_LOOKUP_BATCH_SIZE,
} from "@/lib/accountHoldings";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("account bendystraw endpoint pin", () => {
  it("routes account queries through the single shared chain pin", () => {
    // The account view spans chains, so it can't derive an endpoint from its
    // data. The pin lives in ONE place; components must not re-pin mainnet.
    expect(ACCOUNT_BENDYSTRAW_CHAIN_ID).toBe(1);

    const componentsDir = resolve(process.cwd(), "src/app/account/[id]/components");
    for (const file of readdirSync(componentsDir)) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(resolve(componentsDir, file), "utf8");
      expect(source, `${file} pins its own bendystraw chain`).not.toMatch(
        /chainId:\s*mainnet\.id/u,
      );
    }
  });
});

function row(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    chainId: 1,
    projectId: 4,
    version: 6,
    balance: "1000",
    creditBalance: "0",
    erc20Balance: "1000",
    project: undefined,
    ticker: undefined,
    ...overrides,
  };
}

describe("projectRefsWhere", () => {
  it("builds explicit AND groups per unique versioned ref", () => {
    const where = projectRefsWhere([
      { chainId: 1, projectId: 8, version: 6 },
      { chainId: 1, projectId: 8, version: 6 },
      { chainId: 8453, projectId: 119, version: 6 },
    ]);
    expect(where).toEqual({
      OR: [
        { AND: [{ chainId: 1 }, { projectId: 8 }, { version: 6 }] },
        { AND: [{ chainId: 8453 }, { projectId: 119 }, { version: 6 }] },
      ],
    });
  });

  it("returns null when there is nothing to look up", () => {
    expect(projectRefsWhere([])).toBeNull();
  });

  it("batches every lookup without dropping refs", () => {
    const refs = Array.from({ length: REF_LOOKUP_BATCH_SIZE + 50 }, (_, index) => ({
      chainId: 1,
      projectId: index + 1,
      version: 6,
    }));
    const wheres = projectRefsWheres(refs) as Array<{ OR: unknown[] }>;
    expect(wheres).toHaveLength(2);
    expect(wheres[0].OR).toHaveLength(REF_LOOKUP_BATCH_SIZE);
    expect(wheres[1].OR).toHaveLength(50);
  });

  it("keys lookups by chain and project", () => {
    expect(projectRefKey({ chainId: 1, projectId: 8, version: 6 })).not.toBe(
      projectRefKey({ chainId: 8453, projectId: 8, version: 6 }),
    );
  });
});

describe("groupHoldings", () => {
  it("labels amounts with the project ERC-20 ticker, never the accounting symbol", () => {
    const groups = groupHoldings([
      row({
        ticker: "REV",
        project: {
          chainId: 1,
          projectId: 4,
          version: 6,
          name: "Revnet",
          handle: null,
          logoUri: null,
          owner: "0x1",
          isRevnet: true,
          suckerGroupId: "g1",
          tokenSymbol: "ETH", // accounting-context symbol — must not label balances
          createdAt: 0,
        },
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].symbol).toBe("REV");
  });

  it("falls back to 'tokens' when the project has no ERC-20 ticker", () => {
    const groups = groupHoldings([
      row({
        project: {
          chainId: 1,
          projectId: 4,
          version: 6,
          name: "Revnet",
          handle: null,
          logoUri: null,
          owner: "0x1",
          isRevnet: true,
          suckerGroupId: "g1",
          tokenSymbol: "USDC",
          createdAt: 0,
        },
      }),
    ]);
    expect(groups[0].symbol).toBe("tokens");
  });

  it("merges sucker-group peers into one group and links the v6 project route", () => {
    const project = (chainId: number) => ({
      chainId,
      projectId: 4,
      version: 6,
      name: "Revnet",
      handle: null,
      logoUri: null,
      owner: "0x1",
      isRevnet: true,
      suckerGroupId: "g1",
      tokenSymbol: null,
      createdAt: 0,
    });
    const groups = groupHoldings([
      row({ chainId: 1, balance: "100", project: project(1), ticker: "REV" }),
      row({ chainId: 8453, balance: "50", project: project(8453) }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(150n);
    expect(groups[0].symbol).toBe("REV");
    expect(groups[0].slug).toBeDefined();
    expect(groups[0].rows).toHaveLength(2);
  });

  it("keeps unrelated projects distinct and every group linkable", () => {
    const groups = groupHoldings([
      row({ chainId: 1, projectId: 4 }),
      row({ chainId: 1, projectId: 9 }),
    ]);
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group.slug).toBeDefined();
  });
});
