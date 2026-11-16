import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { describe, expect, it } from "vitest";

describe("project link preview balance", () => {
  it("adds matching balances across chains", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1250000", decimals: 6, tokenSymbol: "USDC" },
        { balance: "2750000", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("4.00 USDC");
  });

  it("keeps unlike accounting tokens separate", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1500000000000000000", decimals: 18, tokenSymbol: "ETH" },
        { balance: "2500000", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("1.5 ETH + 2.50 USDC");
  });

  it("reads each token a deployment holds instead of its mixed raw balance", () => {
    expect(
      formatProjectPreviewBalance([
        {
          // ETH and USDC wei added together: neither token's units.
          balance: "10000000020000000",
          decimals: 18,
          tokenSymbol: "ETH",
          projectTokenBalances: {
            items: [
              {
                token: "0x000000000000000000000000000000000000eeee",
                tokenSymbol: "ETH",
                decimals: 18,
                balance: "10000000000000000",
              },
              {
                token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                tokenSymbol: null,
                decimals: 6,
                balance: "20000000",
              },
            ],
          },
        },
        // No rows: an empty treasury, read from its raw balance.
        { balance: "0", decimals: 18, tokenSymbol: "ETH", projectTokenBalances: { items: [] } },
      ]),
    ).toBe("0.01 ETH + 20.00 USDC");
  });

  it("shows a held token with an unreadable symbol in USD", () => {
    const unnamed = {
      token: "0x00000000000000000000000000000000000000aa",
      tokenSymbol: null,
      decimals: 18,
      balance: "1000000000000000000",
      balanceUsd: "12000000000000000000",
    };
    const deployment = (items: unknown[]) =>
      ({
        balance: "0",
        decimals: 18,
        tokenSymbol: "ETH",
        projectTokenBalances: { items },
      }) as never;
    expect(
      formatProjectPreviewBalance([
        deployment([
          {
            token: "0x000000000000000000000000000000000000eeee",
            tokenSymbol: "ETH",
            decimals: 18,
            balance: "1000000000000000000",
          },
          unnamed,
        ]),
      ]),
    ).toBe("1 ETH + $12.00");
    expect(formatProjectPreviewBalance([deployment([unnamed])])).toBe("$12.00");
  });

  it("keeps unknown tokens apart by address and decimals", () => {
    const row = (token: string, tokenSymbol: string, decimals: number, balance: string) => ({
      token,
      tokenSymbol,
      decimals,
      balance,
    });
    const A = "0x00000000000000000000000000000000000000aa";
    expect(
      formatProjectPreviewBalance([
        {
          balance: "0",
          decimals: 18,
          tokenSymbol: "CASH",
          projectTokenBalances: {
            items: [
              row(A, "CASH", 18, "1000000000000000000"),
              row("0x00000000000000000000000000000000000000bb", "CASH", 18, "2000000000000000000"),
              row(A, "OTHER", 6, "10000000"),
            ],
          },
        },
      ]).split(" + "),
    ).toHaveLength(3);
  });

  it("leaves out a token the project no longer holds", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1500000000000000000", decimals: 18, tokenSymbol: "ETH" },
        { balance: "0", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("1.5 ETH");
  });

  it("renders unknown rather than treating malformed rows as zero", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "bad", decimals: 18, tokenSymbol: "ETH" },
        { balance: "12", decimals: null, tokenSymbol: "USDC" },
      ]),
    ).toBe("Unavailable");
  });

  it("uses a plain-text description when there is no dedicated tagline", () => {
    expect(projectPreviewSlogan(null, "<p>Join our <b>creative</b> mission.</p>")).toBe(
      "Join our creative mission.",
    );
  });
});

it("qualifies flattened custom-token balances by their deployment chain", () => {
  const deployment = (chainId: number, balance: string) => ({
    chainId,
    balance,
    decimals: 18,
    tokenSymbol: "XYZ",
    projectTokenBalances: {
      items: [
        {
          token: "0x1111111111111111111111111111111111111111",
          tokenSymbol: "XYZ",
          decimals: 18,
          balance,
        },
      ],
    },
  });
  expect(
    formatProjectPreviewBalance([
      deployment(1, "1000000000000000000"),
      deployment(8453, "2000000000000000000"),
    ]),
  ).toBe("1 XYZ + 2 XYZ");
  expect(
    formatProjectPreviewBalance([
      deployment(1, "1000000000000000000"),
      deployment(1, "2000000000000000000"),
    ]),
  ).toBe("3 XYZ");
});

it("never presents a partial treasury as complete after a missing or failed row", () => {
  const known = { balance: "1000000000000000000", decimals: 18, tokenSymbol: "ETH" };
  for (const balance of [undefined, null, "", "bad"]) {
    expect(formatProjectPreviewBalance([known, { ...known, balance } as never])).toBe(
      "Unavailable",
    );
  }
  expect(formatProjectPreviewBalance([known, { ...known, balance: "0" }])).toBe("1 ETH");
});
