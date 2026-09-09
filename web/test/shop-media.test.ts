import {
  decodeEncodedIpfsUri,
  encodeIpfsCid,
  resolveTierMedia,
  resolvedUriTierIds,
} from "@/app/[slug]/components/v6/shop/shopLib";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { decodeEncodedIpfsUriCandidates } from "@bananapus/nana-sdk-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const CID_V0 = "QmWxEUm7YCv5oDP1sssMErUrh5AYTxU2hnLCraFEH6BqdQ";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shop tier media", () => {
  it("resolves one category representative plus every resolver-only tier", () => {
    expect(
      resolvedUriTierIds([
        { id: 1, category: 0, encodedIpfsUri: `0x${"0".repeat(64)}` },
        { id: 2, category: 0, encodedIpfsUri: `0x${"1".repeat(64)}` },
        { id: 3, category: 1, encodedIpfsUri: `0x${"2".repeat(64)}` },
        { id: 4, category: 1, encodedIpfsUri: `0x${"0".repeat(64)}` },
        { id: 5, category: 2, encodedIpfsUri: `0x${"3".repeat(64)}` },
      ]),
    ).toEqual([1, 3, 4, 5]);
  });

  it("unwraps Nana's immutable URI candidate when decoding a stored digest", () => {
    const encodedIpfsUri = encodeIpfsCid(CID_V0);

    expect(decodeEncodedIpfsUri(encodedIpfsUri)).toBe(CID_V0);
  });

  it("resolves Nana's IPFS metadata through the same-origin gateway boundary", async () => {
    const encodedIpfsUri = encodeIpfsCid(CID_V0);
    const candidates = decodeEncodedIpfsUriCandidates(encodedIpfsUri);
    expect(candidates).not.toBeNull();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        name: "Banny shop item",
        image: `ipfs://${CID_V0}/item.png`,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveTierMedia({
        id: 1,
        resolvedUri: "",
        encodedIpfsUri,
      }),
    ).resolves.toMatchObject({
      name: "Banny shop item",
      image: `https://juicebox.center/ipfs/${CID_V0}/item.png`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ipfsUriToAppUrl(candidates![0]));
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/juicebox\.center\/ipfs\/(?:Qm|bafy)/u,
    );
  });

  it("uses a tier's encoded CID directly when it resolves to artwork", async () => {
    const encodedIpfsUri = encodeIpfsCid(CID_V0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "image/svg+xml" }),
      }),
    );

    await expect(
      resolveTierMedia({
        id: 1,
        resolvedUri: "",
        encodedIpfsUri,
      }),
    ).resolves.toMatchObject({
      image: `https://juicebox.center/ipfs/${CID_V0}`,
      mediaType: "image/svg+xml",
    });
  });

  it("falls through failed immutable URI candidates without rejecting the shop query", async () => {
    const encodedIpfsUri = encodeIpfsCid(CID_V0);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("cold cache"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "Fallback item" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveTierMedia({
        id: 2,
        resolvedUri: "",
        encodedIpfsUri,
      }),
    ).resolves.toMatchObject({ name: "Fallback item" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
