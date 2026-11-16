// @vitest-environment node
import { GET } from "@/app/api/stages/route";
import { GET as llms } from "@/app/llms.txt/route";
import { getJBContractAddress, RevnetCoreContracts } from "@bananapus/nana-sdk-core";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/lib/wagmiTransports", () => ({
  getViemPublicClient: () => ({ getBlockNumber: async () => 1234n, readContract: mocks.read }),
}));

const request = (query: string) => new NextRequest(`https://revnet.money/api/stages?${query}`);
const REV_OWNER = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, 84532);
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const packed = (reservedPercent: bigint, cashOutTaxRate: bigint, baseCurrency: bigint) =>
  (reservedPercent << 4n) | (cashOutTaxRate << 20n) | (baseCurrency << 36n);
// JBRulesets.allOf answers newest first.
const rulesets = [
  {
    id: 2,
    basedOnId: 1,
    start: NOW + 30 * DAY,
    duration: 0,
    weight: 1_000n * 10n ** 18n,
    weightCutPercent: 0,
    metadata: packed(0n, 2_000n, 1n),
  },
  {
    id: 1,
    basedOnId: 0,
    start: NOW - 30 * DAY,
    duration: 7 * DAY,
    weight: 6_200n * 10n ** 18n,
    weightCutPercent: 380_000_000,
    metadata: packed(6_200n, 1_000n, 1n),
  },
];

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue({
    storeAutoIssuanceAmountEvents: {
      items: [
        { stageId: "1", count: (1_500n * 10n ** 18n).toString() },
        { stageId: "1", count: (500n * 10n ** 18n).toString() },
      ],
    },
  });
  mocks.read.mockReset().mockImplementation(async ({ functionName, args }) => {
    if (functionName === "ownerOf") return REV_OWNER;
    if (functionName === "allOf") return rulesets;
    if (functionName === "currentOf") return { id: 1, weight: 568_002_355_840_000_000_000n };
    if (functionName === "splitsOf") return args[1] === 1n ? [{ percent: 1_000_000_000 }] : [];
    throw new Error(`unexpected read ${functionName}`);
  });
});

describe("revnet stages endpoint", () => {
  it.each(["", "chainId=1&projectId=0", "chainId=999&projectId=1", "chainId=1&projectId=1.5"])(
    "rejects invalid scope before any reads: %s",
    async (query) => {
      expect((await GET(request(query))).status).toBe(400);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it("lists stages oldest first in the Terms tab's units, beside the onchain values", async () => {
    const response = await GET(request("chainId=84532&projectId=1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=86400",
    );
    expect(body).toMatchObject({
      chainId: 84532,
      projectId: 1,
      blockNumber: "1234",
      currentStage: 0,
      currentIssuance: { value: "568.002", raw: "568002355840000000000" },
    });
    expect(body.stages).toEqual([
      {
        rulesetId: 1,
        start: { value: new Date((NOW - 30 * DAY) * 1000).toISOString(), raw: NOW - 30 * DAY },
        issuance: { value: "6,200", raw: "6200000000000000000000" },
        baseCurrency: { value: "ETH", raw: 1 },
        issuanceCutPercent: { value: "38%", raw: 380_000_000 },
        issuanceCutFrequency: { value: 7, raw: 7 * DAY },
        splitPercent: { value: "62%", raw: 6_200 },
        cashOutTax: { value: "0.1", raw: 1_000 },
        autoIssuance: { value: "2,000", raw: "2000000000000000000000" },
      },
      {
        rulesetId: 2,
        start: { value: new Date((NOW + 30 * DAY) * 1000).toISOString(), raw: NOW + 30 * DAY },
        issuance: { value: "1,000", raw: "1000000000000000000000" },
        baseCurrency: { value: "ETH", raw: 1 },
        issuanceCutPercent: { value: "0%", raw: 0 },
        issuanceCutFrequency: { value: 0, raw: 0 },
        splitPercent: { value: null, raw: 0 },
        cashOutTax: { value: "0.2", raw: 2_000 },
        autoIssuance: { value: "0", raw: "0" },
      },
    ]);
    expect(Object.keys(body.units)).toEqual(
      expect.arrayContaining(["issuance", "splitPercent", "cashOutTax", "currentStage"]),
    );
    // Every chain read answers for the block the response names.
    for (const [call] of mocks.read.mock.calls) expect(call.blockNumber).toBe(1234n);
  });

  it("is the stages source /llms.txt points agents at", async () => {
    const map = await llms().text();
    expect(map).toContain("`GET /api/stages?chainId=<id>&projectId=<id>`");
    expect(map).not.toContain("stages are not in the page HTML or");
  });

  it("keeps the stages when the indexed auto issuance record is unavailable", async () => {
    mocks.query.mockRejectedValue(new Error("private indexer URL"));
    const body = await (await GET(request("chainId=84532&projectId=1"))).json();
    expect(body.stages.map((stage: { autoIssuance: unknown }) => stage.autoIssuance)).toEqual([
      null,
      null,
    ]);
  });

  it("answers 404 for a project that is not a revnet, and 503 when the chain read fails", async () => {
    mocks.read.mockImplementation(async () => "0x00000000000000000000000000000000000000bb");
    const notRevnet = await GET(request("chainId=84532&projectId=7"));
    expect(notRevnet.status).toBe(404);
    expect(await notRevnet.json()).toEqual({
      error: "Project 7 on chain 84532 is not a revnet.",
    });
    expect(notRevnet.headers.get("Cache-Control")).toBeNull();

    mocks.read.mockRejectedValue(new Error("rpc API_KEY=secret"));
    const failed = await GET(request("chainId=84532&projectId=1"));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toMatch(/API_KEY|secret/);
  });
});
