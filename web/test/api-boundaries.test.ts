import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryBendystraw: vi.fn() }));

vi.mock("@/lib/bendystraw/query.server", () => ({
  queryBendystraw: mocks.queryBendystraw,
}));

import { POST as proxyBendystraw } from "@/app/api/bendystraw/[net]/query/route";
import { ProjectOperation } from "@/lib/bendystraw/operations";

const SITE = "https://app.revnet.example";

function jsonRequest(url: string, body: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL = "https://bendystraw.example/base/path";
  process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL = "https://testnet.bendystraw.example";
  mocks.queryBendystraw.mockReset();
});

describe("Bendystraw proxy boundary", () => {
  it("rejects unknown networks, arbitrary queries, and malformed operation bodies", async () => {
    expect(
      (
        await proxyBendystraw(jsonRequest(`${SITE}/api/bendystraw/dev/query`, "{}"), {
          params: Promise.resolve({ net: "dev" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await proxyBendystraw(
          jsonRequest(
            `${SITE}/api/bendystraw/mainnet/query`,
            JSON.stringify({ query: "query Project { project { id } }" }),
          ),
          { params: Promise.resolve({ net: "mainnet" }) },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await proxyBendystraw(jsonRequest(`${SITE}/api/bendystraw/mainnet/query`, "{}"), {
          params: Promise.resolve({ net: "mainnet" }),
        })
      ).status,
    ).toBe(400);
    expect(mocks.queryBendystraw).not.toHaveBeenCalled();
  });

  it("rejects invalid variables before any upstream request", async () => {
    const body = JSON.stringify({
      operation: ProjectOperation.id,
      variables: { chainId: "1", projectId: 1, version: 6 },
    });
    expect(
      (
        await proxyBendystraw(jsonRequest(`${SITE}/api/bendystraw/mainnet/query`, body), {
          params: Promise.resolve({ net: "mainnet" }),
        })
      ).status,
    ).toBe(400);
    expect(mocks.queryBendystraw).not.toHaveBeenCalled();
  });

  it("executes only the registered operation and returns uncached JSON", async () => {
    const data = { project: null };
    mocks.queryBendystraw.mockResolvedValue(data);
    const variables = { chainId: 1, projectId: 1, version: 6 };
    const body = JSON.stringify({ operation: ProjectOperation.id, variables });

    const response = await proxyBendystraw(
      jsonRequest(`${SITE}/api/bendystraw/mainnet/query`, body),
      { params: Promise.resolve({ net: "mainnet" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.queryBendystraw).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: ProjectOperation.id }),
      variables,
    );
  });
});
