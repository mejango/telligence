import { jbCenterAppOrigin, jbCenterBaseUrl } from "@/lib/jbcenter-config";
import { jbCenterRpcTransport } from "@/lib/jbcenter-rpc";
import { createPublicClient } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Juicebox Center RPC transport", () => {
  it("paces browser egress across chain clients without waiting for responses", async () => {
    vi.resetModules();
    const { jbCenterRpcTransport: pacedTransport } = await import("@/lib/jbcenter-rpc");
    vi.useFakeTimers();
    const finish: (() => void)[] = [];
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          const chainId = Number(url.split("/").at(-1));
          finish.push(() =>
            resolve(
              new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: `0x${chainId.toString(16)}`,
                }),
                { headers: { "content-type": "application/json" } },
              ),
            ),
          );
        }),
    );
    vi.stubGlobal("window", { fetch: fetchMock });
    const chains = Array.from(
      { length: 12 },
      (_, index) => [mainnet, optimism, base, arbitrum][index % 4]!,
    );
    const requests = chains.map((chain) =>
      createPublicClient({
        chain,
        transport: pacedTransport(chain.id),
      }).getChainId(),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(374);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    finish.forEach((resolve) => resolve());
    await expect(Promise.all(requests)).resolves.toEqual(chains.map(({ id }) => id));
  });

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

it("waits through a 60-second browser cooldown before starting request timeouts", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { jbCenterRpcTransport: transport } = await import("@/lib/jbcenter-rpc");
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    if (fetchMock.mock.calls.length === 1) {
      return Response.json({}, { status: 429, headers: { "Retry-After": "60" } });
    }
    const { id } = JSON.parse(String(init?.body)) as { id: number };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("window", { fetch: fetchMock });
  const outcomes: unknown[] = [];
  const requests = [1, 1].map(() =>
    createPublicClient({ transport: transport(1) })
      .getChainId()
      .then(
        (result) => {
          outcomes.push(result);
        },
        (error) => {
          outcomes.push(error);
        },
      ),
  );
  await vi.advanceTimersByTimeAsync(59_999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(outcomes).toEqual([]);
  await vi.advanceTimersByTimeAsync(1_001);
  await Promise.all(requests);
  expect(outcomes).toEqual([1, 1]);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
