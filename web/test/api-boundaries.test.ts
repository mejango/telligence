import { BendystrawRequestError } from "@bananapus/nana-sdk-core";
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

describe("Bendystraw proxy failures", () => {
  const relay = () =>
    proxyBendystraw(
      jsonRequest(
        `${SITE}/api/bendystraw/mainnet/query`,
        JSON.stringify({
          operation: ProjectOperation.id,
          variables: { chainId: 1, projectId: 1, version: 6 },
        }),
      ),
      { params: Promise.resolve({ net: "mainnet" }) },
    );

  // The relay logs why it failed. Silencing the log keeps the run's output clean, and the spy lets a test read it.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    [
      "an indexer error",
      new BendystrawRequestError('relation "secret_table" does not exist', 502),
      502,
      "Bendystraw unavailable",
      'BendystrawRequestError: relation "secret_table" does not exist',
    ],
    [
      "a timeout",
      Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }),
      504,
      "Bendystraw timed out",
      "TimeoutError: The operation timed out",
    ],
    [
      "a request the indexer refuses",
      new BendystrawRequestError("Bendystraw request failed (403)", 403),
      400,
      "invalid operation request",
      "BendystrawRequestError: Bendystraw request failed (403)",
    ],
  ])(
    "answers %s with its own status and message, and logs the cause once",
    async (_name, failure, status, message, logged) => {
      mocks.queryBendystraw.mockRejectedValue(failure);

      const response = await relay();

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: message });
      expect(console.error).toHaveBeenCalledExactlyOnceWith("Bendystraw relay failed:", logged);
    },
  );

  it("logs a cause on one line, without the control characters a terminal or a log viewer would act on", async () => {
    // A line break could forge a log line, ESC starts a terminal sequence, and NUL cuts a line in some viewers. U+0085 (NEL), U+009B (CSI) and DEL are controls that `\s` does not match.
    mocks.queryBendystraw.mockRejectedValue(
      new BendystrawRequestError(
        "first line\r\n2026-09-29 ERROR forged line\n\tindented \u001b[31mred\u001b[0m\u0000nul \u0085 nel \u009b csi \u007f del",
        502,
      ),
    );

    const response = await relay();

    await expect(response.json()).resolves.toEqual({ error: "Bendystraw unavailable" });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Bendystraw relay failed:",
      "BendystrawRequestError: first line 2026-09-29 ERROR forged line indented [31mred [0m nul nel csi del",
    );
  });

  it("logs nothing when the relay answers", async () => {
    mocks.queryBendystraw.mockResolvedValue({ project: null });

    expect((await relay()).status).toBe(200);
    expect(console.error).not.toHaveBeenCalled();
  });
});
