import { treasuryUsdTotal } from "@/app/[slug]/components/Header/TvlDatum";
import { describe, expect, it } from "vitest";

describe("Revnet treasury total", () => {
  it("adds already-normalized USD values instead of mixing token decimals", () => {
    expect(
      treasuryUsdTotal(
        [
          {
            chainId: 1,
            verified: true,
            rows: [
              {
                chainId: 1,
                token: "0x000000000000000000000000000000000000eeee",
                symbol: "ETH",
                decimals: 18,
                balance: 2n * 10n ** 18n,
                usd: 5_000n * 10n ** 18n,
              },
            ],
          },
          {
            chainId: 8453,
            verified: true,
            rows: [
              {
                chainId: 8453,
                token: "0x0000000000000000000000000000000000000001",
                symbol: "USDC",
                decimals: 6,
                balance: 10_000n * 10n ** 6n,
                usd: 10_000n * 10n ** 18n,
              },
            ],
          },
        ],
        2,
      ),
    ).toBe(15_000n * 10n ** 18n);
  });

  it("fails closed when any nonzero context cannot be priced", () => {
    expect(
      treasuryUsdTotal(
        [
          {
            chainId: 1,
            verified: true,
            rows: [
              {
                chainId: 1,
                token: "0x000000000000000000000000000000000000eeee",
                symbol: "ETH",
                decimals: 18,
                balance: 1n,
                usd: null,
              },
            ],
          },
        ],
        1,
      ),
    ).toBeNull();
  });
});
