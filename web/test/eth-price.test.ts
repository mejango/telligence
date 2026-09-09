// The ETH price converts real treasury balances into figures people read as fact, and the
// shields badge publishes one of them off-site. A failed feed must therefore be reported as
// "no price", never as a stand-in number — a hard-coded fallback used to live here and made
// every caller's honest-degradation path unreachable.
//
// The price comes from `JBPrices`, the protocol's own feed. It used to come from
// `juicebox.money/api/juicebox/prices/ethusd`, a route of the V1–V5 app, which the V6 client
// is about to replace at that domain.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

const readContract = vi.fn();
vi.mock("@/lib/wagmiTransports", () => ({
  transports: {},
  getViemPublicClient: () => ({ readContract }),
}));

const { fetchEthPrice } = await import("@/lib/ethPrice");
const { readEthUsdPrice } = await import("@/lib/ethUsdFeed");

afterEach(() => {
  readContract.mockReset();
});

describe("readEthUsdPrice", () => {
  it("returns the protocol feed price", async () => {
    readContract.mockResolvedValue(3_421_500_000_000_000_000_000n);
    await expect(readEthUsdPrice()).resolves.toBe(3421.5);
  });

  it("falls back to the next chain when one cannot be read", async () => {
    readContract
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce(1_883_000_000_000_000_000_000n);
    await expect(readEthUsdPrice()).resolves.toBe(1883);
  });

  it("throws rather than returning a stand-in when no chain answers", async () => {
    readContract.mockRejectedValue(new Error("rpc down"));
    await expect(readEthUsdPrice()).rejects.toThrow(/ETH price unavailable/u);
  });

  it("throws when the feed answers with an unusable price", async () => {
    readContract.mockResolvedValue(0n);
    await expect(readEthUsdPrice()).rejects.toThrow(/ETH price unavailable/u);
  });
});

describe("fetchEthPrice", () => {
  it("returns null when the feed is unreadable", async () => {
    readContract.mockRejectedValue(new Error("rpc down"));
    await expect(fetchEthPrice()).resolves.toBeNull();
  });

  it("returns the price when the feed answers", async () => {
    readContract.mockResolvedValue(3_421_500_000_000_000_000_000n);
    await expect(fetchEthPrice()).resolves.toBe(3421.5);
  });
});
