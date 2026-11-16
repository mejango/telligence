import { customVotingUnits, resolveTierMedia } from "@/app/[slug]/components/v6/shop/shopLib";
import { readFileSync } from "node:fs";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

const DIGEST = `0x623d9c0b2fd488ca8b6d93a9f20f89290989366a548e6ec7354bbd61311f0e12` as const;
const tier = { id: 7, resolvedUri: "", encodedIpfsUri: DIGEST };
const metadata = (body: object) =>
  `data:application/json,${encodeURIComponent(JSON.stringify(body))}`;
const bareArtwork = () =>
  vi.fn().mockResolvedValue(
    new Response("<svg/>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe("voting units", () => {
  it("are the price repeated on a tier that votes by price", () => {
    expect(customVotingUnits({ price: 10n ** 18n, votingUnits: 10n ** 18n })).toBeNull();
    expect(customVotingUnits({ price: 0n, votingUnits: 0n })).toBeNull();
  });

  it("show raw on a tier with custom units", () => {
    expect(customVotingUnits({ price: 10n ** 18n, votingUnits: 5n })).toBe(5n);
  });

  it("leave no empty line on an item card", () => {
    const source = readFileSync("src/app/[slug]/components/v6/shop/InventorySection.tsx", "utf8");
    expect(source).not.toContain("tier.votingUnits");
  });
});

describe("a tier whose digest addresses bare artwork", () => {
  it("takes its name and art from the shop's resolver", async () => {
    const fetcher = bareArtwork();
    vi.stubGlobal("fetch", fetcher);
    const media = await resolveTierMedia(tier, async () =>
      metadata({
        name: "Pew Pew 150/150 remaining",
        productName: "Pew Pew",
        image: "data:image/svg+xml,a",
      }),
    );
    expect(media.name).toBe("Pew Pew");
    expect(media.image).toBe("data:image/svg+xml,a");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back to the digest when the resolver has nothing", async () => {
    vi.stubGlobal("fetch", bareArtwork());
    const media = await resolveTierMedia(tier, async () => "");
    expect(media.name).toBeUndefined();
    expect(media.image).toBeTruthy();
  });

  it("falls back when the resolver reverts", async () => {
    vi.stubGlobal("fetch", bareArtwork());
    const revert = new BaseError("reverted", {
      cause: new ContractFunctionRevertedError({
        abi: [],
        functionName: "tiersOf",
        message: "execution reverted",
      }),
    });
    const media = await resolveTierMedia(tier, () => Promise.reject(revert));
    expect(media.image).toBeTruthy();
  });

  it("stays retryable when the read fails", async () => {
    vi.stubGlobal("fetch", bareArtwork());
    await expect(
      resolveTierMedia(tier, () => Promise.reject(new Error("fetch failed"))),
    ).rejects.toThrow("Item details could not be loaded");
  });
});
