import { readComputeProject, readComputeProjects } from "@/lib/telligence/project.server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("public compute metadata", () => {
  it("does not invent projects or call an unconfigured gateway during a static build", async () => {
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await readComputeProjects()).toEqual([]);
    expect(await readComputeProject("base-12")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unsafe configured origins and untrusted project paths before any fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const origin of [
      "https://api.example.test@evil.test",
      "https://api.example.test/?token=secret",
      "https://api.example.test/#fragment",
      "http://api.example.test",
    ]) {
      vi.stubEnv("TELLIGENCE_GATEWAY_URL", origin);
      expect(await readComputeProjects()).toEqual([]);
    }
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", "https://api.example.test");
    expect(await readComputeProject("../admin")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds public fetches, forbids redirects and survives gateway outages", async () => {
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", "https://api.example.test");
    const fetch = vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    expect(await readComputeProjects()).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/v1/projects",
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: { Accept: "application/json" },
      }),
    );
  });
});

describe("last-known-good public reads", () => {
  const snapshot = (id: string) => ({
    project: {
      id,
      chainId: 8453,
      revnetId: "12",
      name: "Public archive",
      purpose: "Make historical research accessible to everyone.",
      workload: "Summarize archival documents",
      targetDailyCreditUsd: null,
      status: "active",
      policyVersion: "1",
      createdAt: "2026-09-09T12:00:00Z",
      wrapperAddress: "0x1111111111111111111111111111111111111111",
      vaultAddress: "0x2222222222222222222222222222222222222222",
      creatorAddress: "0x3333333333333333333333333333333333333333",
      capacity: { status: "ready", dailyCreditUsd: "1", remainingCreditUsd: "1", observedAt: null },
    },
  });
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  it("serves the last successful copy, marked stale with its time, when the gateway fails", async () => {
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", "https://api.example.test");
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-09T12:00:00Z"));
    const fetch = vi.fn().mockResolvedValueOnce(ok(snapshot("stale-1")));
    vi.stubGlobal("fetch", fetch);
    const { readComputeProjectRecord } = await import("@/lib/telligence/project.server");
    const fresh = await readComputeProjectRecord("stale-1");
    expect(fresh).toMatchObject({ stale: false, at: "2026-09-09T12:00:00.000Z" });
    expect(fresh?.project.name).toBe("Public archive");
    vi.setSystemTime(Date.parse("2026-09-09T12:30:00Z"));
    fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const saved = await readComputeProjectRecord("stale-1");
    expect(saved).toMatchObject({ stale: true, at: "2026-09-09T12:00:00.000Z" });
    expect(saved?.project.id).toBe("stale-1");
    fetch.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect(await readComputeProjectRecord("stale-1")).toMatchObject({ stale: true });
    // A project that was never read successfully still has nothing to show.
    fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await readComputeProjectRecord("stale-2")).toBeNull();
    vi.useRealTimers();
  });

  it("keeps the plain reader's contract and bounds the saved copies", async () => {
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", "https://api.example.test");
    const fetch = vi
      .fn()
      .mockImplementation(async (url: string) =>
        ok(snapshot(decodeURIComponent(String(url).split("/").at(-1)!))),
      );
    vi.stubGlobal("fetch", fetch);
    const { readComputeProject, readComputeProjectRecord, PUBLIC_READ_CACHE_LIMIT } =
      await import("@/lib/telligence/project.server");
    expect((await readComputeProject("bound-0"))?.id).toBe("bound-0");
    for (let i = 1; i <= PUBLIC_READ_CACHE_LIMIT; i += 1) await readComputeProject(`bound-${i}`);
    fetch.mockRejectedValue(new Error("down"));
    // The oldest entry was evicted; the newest survives.
    expect(await readComputeProjectRecord("bound-0")).toBeNull();
    expect(await readComputeProjectRecord(`bound-${PUBLIC_READ_CACHE_LIMIT}`)).toMatchObject({
      stale: true,
    });
  });
});
