import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bendystraw's `project.tokenSymbol` is the ACCOUNTING context's token (ETH,
// USDC), not the project ERC-20. Using it to label a project-token count made
// the homepage read "bought 23.29 ETH" for a revnet that issues MARKEE.
describe("homepage activity token labels", () => {
  it("labels project-token counts with the ERC-20 ticker, not the accounting symbol", () => {
    const feed = readFileSync("src/app/HomepageActivityFeed.tsx", "utf8");
    expect(feed).toContain("event.tokenTicker");
    expect(feed).not.toMatch(/const symbol = project\.tokenSymbol/);
  });

  it("resolves tickers per chain and project at version 6", () => {
    const source = readFileSync("src/app/getHomepageActivity.ts", "utf8");
    expect(source).toContain("ProjectErc20TickersOperation");
    // Same projectId on the same chain has a different ticker per protocol
    // version, so the pair alone doesn't identify a row.
    expect(source).toContain("version: 6");
    expect(source).toContain("`${row.chainId}:${row.projectId}`");
  });
});
