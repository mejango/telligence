import {
  readMetadataDestination,
  requireMetadataPermission,
  verifyMetadataSource,
} from "@/lib/project-metadata-write";
import type { Address, PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = `0x${"11".repeat(20)}` as Address;
const OWNER = `0x${"22".repeat(20)}` as Address;
const CONTROLLER = `0x${"33".repeat(20)}` as Address;
const CID = "QmTFCRTLGXQZgPjNMLxRHfnTQpsvSNvzEpx6NKCcXgSTuA";
const source = {
  chainId: 8453,
  projectId: "91",
  directory: `0x${"44".repeat(20)}` as Address,
  projects: `0x${"55".repeat(20)}` as Address,
  permissions: `0x${"66".repeat(20)}` as Address,
  controller: CONTROLLER,
  uri: `ipfs://${CID}`,
};
const readContract = vi.fn();
const client = { readContract } as unknown as PublicClient;

beforeEach(() => {
  readContract.mockImplementation(
    async ({ functionName }) =>
      ({ ownerOf: OWNER, hasPermission: true, controllerOf: CONTROLLER, uriOf: source.uri })[
        functionName as "ownerOf"
      ],
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ name: "Peer", peerOnly: true }), { status: 200 }),
    ),
  );
});

describe("live metadata destinations", () => {
  it("uses the active controller and the peer's project ID, including owner-bound ROOT/wildcard permission", async () => {
    const result = await readMetadataDestination(client, source, ACCOUNT);
    expect(result).toMatchObject({ source, metadata: { name: "Peer", peerOnly: true } });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: source.directory,
        functionName: "controllerOf",
        args: [91n],
      }),
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: CONTROLLER, functionName: "uriOf", args: [91n] }),
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: source.permissions,
        functionName: "hasPermission",
        args: [ACCOUNT, OWNER, 91n, 7n, true, true],
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      `https://juicebox.center/ipfs/${CID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("allows the live owner without requiring an indexed operator grant", async () => {
    await requireMetadataPermission(client, source, OWNER);
    expect(readContract).toHaveBeenCalledOnce();
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "ownerOf" }));
  });

  it("rejects missing permission before metadata fetch", async () => {
    readContract.mockImplementation(async ({ functionName }) =>
      functionName === "ownerOf" ? OWNER : false,
    );
    await expect(readMetadataDestination(client, source, ACCOUNT)).rejects.toThrow(
      /cannot update project 91/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["controller", "URI"])("blocks a changed %s after review", async (changed) => {
    readContract.mockImplementation(
      async ({ functionName }) =>
        ({
          ownerOf: OWNER,
          hasPermission: true,
          controllerOf: changed === "controller" ? OWNER : CONTROLLER,
          uriOf: "ipfs://changed",
        })[functionName as "ownerOf"],
    );
    await expect(verifyMetadataSource(client, source, ACCOUNT)).rejects.toThrow(
      changed === "controller" ? /active controller changed/ : /source metadata changed/,
    );
  });

  it.each(["HTTP error", "invalid JSON", "array JSON"])(
    "never treats %s as empty metadata",
    async (failure) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(failure === "array JSON" ? "[]" : "not JSON", {
              status: failure === "HTTP error" ? 503 : 200,
            }),
        ),
      );
      await expect(readMetadataDestination(client, source, ACCOUNT)).rejects.toThrow();
    },
  );

  it("rejects mutable/non-content-addressed URIs before a replacement edit", async () => {
    readContract.mockImplementation(async ({ functionName }) =>
      functionName === "controllerOf" ? CONTROLLER : "https://example.com/metadata.json",
    );
    await expect(readMetadataDestination(client, source)).rejects.toThrow(
      /not a readable content-addressed document/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a genuinely absent URI to start an empty document", async () => {
    readContract.mockImplementation(async ({ functionName }) =>
      functionName === "controllerOf" ? CONTROLLER : "",
    );
    expect(await readMetadataDestination(client, source)).toMatchObject({
      metadata: {},
      source: { uri: "" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
