// @vitest-environment node
import { GET } from "@/app/api/project-diagnostics/route";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/projectDiagnostics.server", () => ({ readProjectDiagnostics: read }));
const request = (query: string) =>
  new NextRequest(`https://revnet.money/api/project-diagnostics?${query}`);

beforeEach(() => {
  read.mockReset();
});

describe("public read-only project diagnostics", () => {
  it.each([
    "",
    "chainId=1&projectId=0",
    "chainId=1&projectId=1.5",
    "chainId=999&projectId=1",
    "chainId=1&projectId=9007199254740992",
    "chainId=1&projectId=1&operator=invalid",
  ])("rejects invalid scope before any reads: %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns fresh evidence for the exact chain, project and optional operator", async () => {
    const report = {
      deployment: { checks: [] },
      indexer: { project: "available", group: "not-checked" },
    };
    const operator = "0x1111111111111111111111111111111111111111";
    read.mockResolvedValue(report);
    const response = await GET(request(`chainId=84532&projectId=45&operator=${operator}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(report);
    expect(read).toHaveBeenCalledWith(84532, 45n, operator);
  });

  it("sanitizes unexpected transport errors", async () => {
    read.mockRejectedValue(new Error("https://private-rpc.invalid/secret-key"));
    const response = await GET(request("chainId=1&projectId=45"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Deployment checks are unavailable." });
  });
});
