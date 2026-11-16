// @vitest-environment node

import { chainRevert, revertedNonexistentToken } from "@/lib/contract-revert";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// What a node answers an eth_call with, set per test. Read through viem's real
// http() transport, whose errors quote the request body in their message.
let answer: { code: number; message: string; data?: Hex } = { code: 3, message: "" };
let server: Server;
let url = "";
// The setup blocks the network per test; this file talks only to its own loopback node.
const loopbackFetch = globalThis.fetch;
beforeEach(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!target.startsWith(url)) throw new Error(`Unexpected network request: ${target}`);
    return loopbackFetch(input, init);
  });
});

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { id } = JSON.parse(body) as { id: number };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id, error: answer }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const abi = parseAbi(["function ownerOf(uint256) view returns (address)"]);
const NONEXISTENT =
  "0x7e273289000000000000000000000000000000000000000000000000000000000000002a" as Hex;

async function failure(next: typeof answer): Promise<unknown> {
  answer = next;
  const client = createPublicClient({ chain: mainnet, transport: http(url, { retryCount: 0 }) });
  return client
    .readContract({
      address: "0x0000000000000000000000000000000000000001" as Address,
      abi,
      functionName: "ownerOf",
      args: [42n],
    })
    .then(
      () => {
        throw new Error("expected the read to fail");
      },
      (error: unknown) => error,
    );
}

describe("reading a node's error as the contract's answer", () => {
  it("never reads a node's -32603 internal error without revert data as a revert", async () => {
    const error = await failure({ code: -32603, message: "internal error" });
    expect(chainRevert(error)).toBeNull();
    expect(revertedNonexistentToken(error)).toBe(false);
  });

  it("reads ERC721NonexistentToken as a missing project, by code 3 or by a -32603 that carries it", async () => {
    for (const code of [3, -32603]) {
      const error = await failure({ code, message: "execution reverted", data: NONEXISTENT });
      expect(chainRevert(error)).not.toBeNull();
      expect(revertedNonexistentToken(error)).toBe(true);
    }
  });

  it("reads another revert as a revert, but not as a missing project", async () => {
    const error = await failure({ code: 3, message: "execution reverted" });
    expect(chainRevert(error)).not.toBeNull();
    expect(revertedNonexistentToken(error)).toBe(false);
    expect(chainRevert(new Error("not viem"))).toBeNull();
  });
});
