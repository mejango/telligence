import {
  pinMediaEdits,
  readMediaEditSource,
  replaceTierMedia,
} from "@/app/[slug]/components/v6/shop/shopMediaEdit";
import type { ShopDestination } from "@/app/[slug]/components/v6/shop/useShopDestinations";
import { encodeIpfsUri } from "@bananapus/nana-sdk-core";
import { zeroAddress, type Address, type PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pinJsonMetadata: vi.fn() }));
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinJsonMetadata: mocks.pinJsonMetadata,
}));
const hook = `0x${"11".repeat(20)}` as Address;
const owner = `0x${"22".repeat(20)}` as Address;
const cid = "QmYwAPJzv5CZsnAzt8auVZRnGi2C6aC9Shm9fzxfHvHm7Q";
const digest = encodeIpfsUri(cid);
const destination = {
  chainId: 8453,
  projectId: 91n,
  shop: { hook, store: `0x${"55".repeat(20)}`, tiers: [{ id: 12 }] },
} as ShopDestination;

function client(values: Record<string, unknown> = {}) {
  return {
    readContract: vi.fn(
      async ({ functionName }: { functionName: string }) =>
        ({
          tiered721HookOf: hook,
          owner,
          PERMISSIONS: owner,
          encodedIpfsUriOf: digest,
          tokenUriResolverOf: zeroAddress,
          isTierRemoved: false,
          tierOf: { id: 12, initialSupply: 100 },
          ...values,
        })[functionName],
    ),
  } as unknown as PublicClient;
}

beforeEach(() => mocks.pinJsonMetadata.mockResolvedValue(cid));
afterEach(() => vi.unstubAllGlobals());

describe("wallet-action:shop-items — shop media replacement", () => {
  it("replaces owned media fields while preserving names, attributes and peer custom data", () => {
    const source = {
      name: "Peer item",
      attributes: [{ trait_type: "Color", value: "Blue" }],
      custom: { peer: true },
      image: "old",
      image_data: "old",
      animation_url: "old",
      animationUrl: "old",
      mediaType: "video/mp4",
    };
    expect(replaceTierMedia(source, "ipfs://new", "image/png")).toEqual({
      name: source.name,
      attributes: source.attributes,
      custom: source.custom,
      image: "ipfs://new",
      mediaType: "image/png",
    });
    expect(replaceTierMedia(source, "ipfs://new", "video/mp4")).toMatchObject({
      animation_url: "ipfs://new",
      mediaType: "video/mp4",
    });
    expect(source.image).toBe("old");
  });

  it("reads each selected tier's complete source JSON and freezes its digest/resolver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ name: "Peer item", privateKey: { preserve: true } }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const source = await readMediaEditSource(client(), destination, 12, owner);
    expect(source.metadata).toEqual({ name: "Peer item", privateKey: { preserve: true } });
    expect(source.tierId).toBe(12);
    expect(source.preconditions).toHaveLength(6);
  });

  it("refuses to infer equal tier IDs between chains", async () => {
    await expect(readMediaEditSource(client(), destination, 3, owner)).rejects.toThrow(
      "Choose an existing item",
    );
    await expect(
      readMediaEditSource(client({ tierOf: { id: 12, initialSupply: 0 } }), destination, 12, owner),
    ).rejects.toThrow("no longer in this shop");
    await expect(
      readMediaEditSource(client({ isTierRemoved: true }), destination, 12, owner),
    ).rejects.toThrow("no longer in this shop");
  });

  it("does not silently clear a custom resolver or perform an ineffective digest-only edit", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      readMediaEditSource(client({ tokenUriResolverOf: owner }), destination, 12, owner),
    ).rejects.toThrow("custom media resolver");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed for missing, invalid or non-object metadata", async () => {
    for (const body of ["bad json", "[]", "null"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async () => new Response(body)),
      );
      await expect(readMediaEditSource(client(), destination, 12, owner)).rejects.toThrow(
        "cannot be safely preserved",
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response("", { status: 404 })),
    );
    await expect(readMediaEditSource(client(), destination, 12, owner)).rejects.toThrow(
      "cannot be safely preserved",
    );
    expect(mocks.pinJsonMetadata).not.toHaveBeenCalled();
  });

  it("allows a genuinely empty metadata digest", async () => {
    const source = await readMediaEditSource(
      client({ encodedIpfsUriOf: `0x${"0".repeat(64)}` }),
      destination,
      12,
      owner,
    );
    expect(source.metadata).toEqual({});
  });

  it("pins identical merged documents once and keeps distinct peer documents separate", async () => {
    const source = {
      destination,
      tierId: 12,
      metadata: { name: "First", custom: "keep" },
      preconditions: [],
    };
    const second = { ...source, destination: { ...destination, chainId: 1 as const }, tierId: 41 };
    const third = { ...source, metadata: { name: "Peer", custom: "different" } };
    const edits = await pinMediaEdits([source, second, third], "ipfs://media", "image/png");
    expect(mocks.pinJsonMetadata).toHaveBeenCalledTimes(2);
    expect(mocks.pinJsonMetadata).toHaveBeenCalledWith({
      name: "Peer",
      custom: "different",
      image: "ipfs://media",
      mediaType: "image/png",
    });
    expect(edits.map((edit) => edit.tierId)).toEqual([12, 41, 12]);
  });
});
