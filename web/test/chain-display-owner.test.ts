import { projectItemsWithFallback, type ProjectItem } from "@/app/[slug]/components/v6/shared";
import { normalizeSuckerPairs } from "@/lib/nana/suckers";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CANONICAL = [1, 8453, 42161, 10];

describe("one owner for chain names and order", () => {
  it("never renders the SDK's wallet-facing chain name directly", () => {
    let hits = "";
    try {
      hits = execFileSync(
        "grep",
        [
          "-rnE",
          "--exclude=constants.ts",
          "--exclude=route.ts",
          String.raw`JB_CHAINS\[[^]]+\]\??\.name|OP Mainnet"|Arbitrum One"`,
          "src",
        ],
        { encoding: "utf8" },
      );
    } catch {
      hits = "";
    }
    expect(hits).toBe("");
  });

  it("orders sucker pairs by the canonical chain order", () => {
    const pairs = normalizeSuckerPairs(
      [8453, 42161, 10].map((peerChainId) => ({ peerChainId, projectId: 3n })) as never,
      { peerChainId: 1, projectId: 3n } as never,
    );
    expect(pairs.map((pair) => pair.peerChainId)).toEqual(CANONICAL);
  });

  it("orders the group's project rows the same way", () => {
    const rows = [42161, 8453, 1, 10].map((chainId) => ({
      chainId,
      projectId: 3,
    })) as ProjectItem[];
    const sorted = projectItemsWithFallback(rows, rows[0], 1, 3);
    expect(sorted.map((row) => row.chainId)).toEqual(CANONICAL);
  });
});
