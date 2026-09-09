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
