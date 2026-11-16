import {
  encodeIpfsCid,
  useTierMedia,
  type TierMediaSource,
} from "@/app/[slug]/components/v6/shop/shopLib";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wagmi", () => ({ usePublicClient: () => undefined }));

const CID = "QmWxEUm7YCv5oDP1sssMErUrh5AYTxU2hnLCraFEH6BqdQ";
const HOOK = "0x0000000000000000000000000000000000000001" as const;
const EMPTY = `0x${"0".repeat(64)}` as const;
const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function inline(name: string): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify({ name }))}`;
}

function item(overrides: Partial<TierMediaSource> = {}): TierMediaSource {
  return { id: 1, encodedIpfsUri: EMPTY, resolvedUri: "", ...overrides };
}

afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});

describe("shop media query identity and recovery", () => {
  it("uses a new resolver URI after inventory refresh, sharing the result across shop consumers", async () => {
    const { wrapper, client } = setup();
    const initial = { hook: HOOK, tiers: [item({ resolvedUri: inline("Original") })] };
    const first = renderHook(({ shop }) => useTierMedia(1, shop), {
      wrapper,
      initialProps: { shop: initial },
    });
    await waitFor(() => expect(first.result.current.data[1]?.name).toBe("Original"));
    const second = renderHook(() => useTierMedia(1, initial), { wrapper });
    await waitFor(() => expect(second.result.current.data[1]?.name).toBe("Original"));
    expect(client.getQueryCache().findAll({ queryKey: ["v6Shop721TierMedia"] })).toHaveLength(1);
    first.rerender({
      shop: { hook: HOOK, tiers: [item({ resolvedUri: inline("Updated elsewhere") })] },
    });
    await waitFor(() => expect(first.result.current.data[1]?.name).toBe("Updated elsewhere"));
    expect(second.result.current.data[1]?.name).toBe("Original");
  });

  it("uses a new encoded IPFS digest after inventory refresh", async () => {
    const { wrapper } = setup();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: "Original" }) })
      .mockResolvedValue({ ok: true, json: async () => ({ name: "Updated elsewhere" }) });
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(
      ({ tier }) => useTierMedia(1, { hook: HOOK, tiers: [tier] }),
      {
        wrapper,
        initialProps: { tier: item({ encodedIpfsUri: encodeIpfsCid(CID) }) },
      },
    );
    await waitFor(() => expect(result.current.data[1]?.name).toBe("Original"));
    rerender({ tier: item({ encodedIpfsUri: `0x${"1".repeat(64)}` }) });
    await waitFor(() => expect(result.current.data[1]?.name).toBe("Updated elsewhere"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps successful sibling details and recovers a failed tier without changing its URI", async () => {
    const { wrapper, client } = setup();
    const fetcher = vi.fn().mockRejectedValue(new Error("gateway unavailable"));
    vi.stubGlobal("fetch", fetcher);
    const tiers = [
      item({ resolvedUri: inline("Available") }),
      item({ id: 2, encodedIpfsUri: encodeIpfsCid(CID) }),
    ];
    const { result } = renderHook(() => useTierMedia(1, { hook: HOOK, tiers }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data[1]?.name).toBe("Available");
    expect(result.current.data[2]).toBeUndefined();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["v6Shop721TierMedia"] })
        .map((query) => query.state.status)
        .sort(),
    ).toEqual(["error", "success"]);
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ name: "Recovered" }) });
    await act(async () => {
      await result.current.retryFailed();
    });
    await waitFor(() => expect(result.current.data[2]?.name).toBe("Recovered"));
    expect(result.current.data[1]?.name).toBe("Available");
    expect(result.current.isError).toBe(false);
  });

  it("treats an authoritatively absent or valid empty metadata document as success", async () => {
    const { wrapper } = setup();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetcher);
    const tiers = [item(), item({ id: 2, encodedIpfsUri: encodeIpfsCid(CID) })];
    const { result } = renderHook(() => useTierMedia(1, { hook: HOOK, tiers }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual({ 1: {}, 2: {} });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
