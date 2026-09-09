import { fetchSafesOwnedBy, SAFE_TX_SERVICE_PREFIX, safeOwnersUrl } from "@/lib/safeOwners";
import { describe, expect, it, vi } from "vitest";

const OWNER = "0x1111111111111111111111111111111111111111";
const SAFE_A = "0x2222222222222222222222222222222222222222";
const SAFE_B = "0x3333333333333333333333333333333333333333";

describe("Safe Transaction Service owner lookups", () => {
  it("mirrors the Safe service prefixes used for proposal tracking", () => {
    expect(SAFE_TX_SERVICE_PREFIX).toEqual({
      1: "eth",
      10: "oeth",
      8453: "base",
      42161: "arb1",
      11155111: "sep",
    });
  });

  it("builds the owners endpoint per chain and rejects unsupported inputs", () => {
    expect(safeOwnersUrl(1, OWNER)).toBe(
      `https://api.safe.global/tx-service/eth/api/v1/owners/${OWNER}/safes/`,
    );
    expect(safeOwnersUrl(8453, OWNER)).toBe(
      `https://api.safe.global/tx-service/base/api/v1/owners/${OWNER}/safes/`,
    );
    // No service prefix for this chain — and never a URL for a non-address.
    expect(safeOwnersUrl(84532, OWNER)).toBeNull();
    expect(safeOwnersUrl(1, "not-an-address")).toBeNull();
  });

  it("aggregates safes across chains and treats per-chain failures as empty", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/tx-service/eth/")) {
        return new Response(JSON.stringify({ safes: [SAFE_A, SAFE_B, 42] }), { status: 200 });
      }
      if (href.includes("/tx-service/base/")) {
        return new Response("shed", { status: 503 });
      }
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const safes = await fetchSafesOwnedBy(OWNER, [1, 8453, 42161], fetcher);

    expect(safes).toEqual([
      { chainId: 1, safe: SAFE_A },
      { chainId: 1, safe: SAFE_B },
    ]);
  });
});
