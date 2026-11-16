// @vitest-environment node
import { GET } from "@/app/api/project-route/route";
import { describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/app/[slug]/resolveProjectRoute.server", () => ({ resolveProjectRoute: read }));

describe("project alias verification API", () => {
  it("reuses the authoritative resolver and returns uncacheable proof age", async () => {
    read.mockResolvedValue({
      chainId: 1,
      projectId: 42n,
      verifiedOperator: `0x${"a".repeat(40)}`,
      checkedAt: Date.now() - 500,
    });
    const response = await GET(
      new Request("https://revnet.example/api/project-route?slug=%40name"),
    );
    expect(read).toHaveBeenCalledExactlyOnceWith("@name");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      chainId: 1,
      projectId: "42",
      authority: `0x${"a".repeat(40)}`,
      checkedAt: expect.any(Number),
      serverNow: expect.any(Number),
    });
  });
  it("rejects invalid/revoked identities without manufacturing proof", async () => {
    expect(
      (await GET(new Request("https://revnet.example/api/project-route?slug=eth:1"))).status,
    ).toBe(400);
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValue(null);
    const response = await GET(
      new Request("https://revnet.example/api/project-route?slug=%40name"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("checkedAt");
  });
});
