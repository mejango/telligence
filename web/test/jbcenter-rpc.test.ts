import { jbCenterAppOrigin, jbCenterBaseUrl } from "@/lib/jbcenter-config";
import { jbCenterRpcTransport } from "@/lib/jbcenter-rpc";
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Juicebox Center RPC transport", () => {
  it("does not treat other localhost ports as trusted dev clients", () => {
    expect(jbCenterBaseUrl("http://localhost:3000")).toBe("https://juicebox.center");
    expect(jbCenterAppOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it.each([
    "https://telligence.money",
    "https://www.telligence.money",
    "https://revnet.money",
    "http://127.0.0.1:4173",
  ])("identifies server reads using the actual configured origin %s", async (siteUrl) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", undefined);
    const client = createPublicClient({
      chain: mainnet,
      transport: jbCenterRpcTransport(mainnet.id),
    });

    await expect(client.getChainId()).resolves.toBe(mainnet.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://juicebox.center/v1/rpc/1");
    expect(new Headers(init.headers).get("origin")).toBe(siteUrl);
  });

  it.each([
    "",
    "invalid origin",
    "https://revnet.money@telligence.money",
    "https://telligence.money/path",
    "http://telligence.money",
    "https://telligence.money?origin=revnet.money",
  ])("rejects an invalid configured origin instead of impersonating another app: %s", (siteUrl) => {
    expect(() => jbCenterAppOrigin(siteUrl)).toThrow();
  });

  it("calls browser fetch with the Window receiver", async () => {
    const browserWindow = {
      fetch: vi.fn(function (this: unknown) {
        if (this !== browserWindow) throw new TypeError("Illegal invocation");
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    };
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal(
      "fetch",
      vi.fn(function () {
        throw new TypeError("Illegal invocation");
      }),
    );
    const client = createPublicClient({
      chain: mainnet,
      transport: jbCenterRpcTransport(mainnet.id),
    });

    await expect(client.getChainId()).resolves.toBe(mainnet.id);
    expect(browserWindow.fetch).toHaveBeenCalledOnce();
  });

  it.each(["https://dev.revnet.money", "http://localhost:3002"])(
    "uses the configured dev Center and app origin for %s",
    async (siteUrl) => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("window", undefined);
      const client = createPublicClient({
        chain: mainnet,
        transport: jbCenterRpcTransport(mainnet.id),
      });

      await expect(client.getChainId()).resolves.toBe(mainnet.id);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://dev.juicebox.center/v1/rpc/1");
      expect(new Headers(init.headers).get("origin")).toBe(siteUrl);
    },
  );
});
