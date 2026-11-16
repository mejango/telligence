import {
  BUFFER_PERIOD,
  MARKEE_ADMIN,
  MARKEE_BENEFICIARY,
  MARKEE_FACTORY,
  SECONDS_IN_MONTH,
  STREAMING_BASE,
  boardAbi,
  bufferFor,
  buildMoveStreamOps,
  buildOpenStreamOps,
  buildStopStreamOps,
  buildUpdateStreamOps,
  decodeBoardCreated,
  decodeMarkeeCreated,
  factoryAbi,
  getRequiredWrap,
  monthlyToRatePerSec,
  parseMonthlyRate,
  readMarkeeBoard,
  readMarkeeExitBoard,
  readMarkeeMessage,
  recommendedTakeoverMonthlyRate,
  validateMarkeeText,
} from "@/lib/markee";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const params = {
  ethx: STREAMING_BASE.ethx,
  board: address("1"),
  markee: address("2"),
  backer: address("3"),
  cfaAgreement: address("4"),
  gdaAgreement: address("5"),
  pool: address("6"),
  ratePerSec: 100n,
  buffer: 1440000n,
  wrapValue: 2000000n,
};
const flowAbi = [
  {
    type: "function",
    name: "createFlow",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "address" }, { type: "int96" }, { type: "bytes" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "deleteFlow",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "updateFlow",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "address" }, { type: "int96" }, { type: "bytes" }],
    outputs: [{ type: "bytes" }],
  },
] as const;
function flow(op: ReturnType<typeof buildOpenStreamOps>[number]) {
  const [call, tag] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], op.data);
  return { decoded: decodeFunctionData({ abi: flowAbi, data: call }), tag };
}
describe("Markee streaming protocol", () => {
  it("honors minimum at floor boundary and ceilings when required", () => {
    const wei = 1000000000000000n;
    const floored = wei / SECONDS_IN_MONTH;
    expect(monthlyToRatePerSec(wei, 999999997884000n)).toBe(floored);
    expect(monthlyToRatePerSec(wei, wei) * SECONDS_IN_MONTH).toBeGreaterThanOrEqual(wei);
    expect(() => monthlyToRatePerSec(wei - 1n, wei)).toThrow(/minimum/);
    expect(() => parseMonthlyRate("Infinity", 0n)).toThrow();
    expect(() => parseMonthlyRate("-1", 0n)).toThrow();
    expect(() => parseMonthlyRate("0.0000000000000000001", 0n)).toThrow();
    expect(() => monthlyToRatePerSec((1n << 95n) * SECONDS_IN_MONTH)).toThrow(/int96/);
  });
  it("recommends next minimum multiple above effective legacy floors, including zero minimum", () => {
    const minimum = 999999997884000n;
    const current = monthlyToRatePerSec(1000000000000000n, minimum);
    expect(recommendedTakeoverMonthlyRate(minimum, current)).toBe(2000000000000000n);
    for (const top of [0n, current, current * 11n + 10n, 100000000000n]) {
      const quote = recommendedTakeoverMonthlyRate(minimum, top);
      expect(monthlyToRatePerSec(quote, minimum)).toBeGreaterThan(top);
    }
    expect(monthlyToRatePerSec(recommendedTakeoverMonthlyRate(0n, current), 0n)).toBeGreaterThan(
      current,
    );
    expect(() => recommendedTakeoverMonthlyRate(0n, (1n << 95n) - 1n)).toThrow(/int96/);
  });
  it("accounts separately for board deposit and CFA wallet buffer", () => {
    expect(bufferFor(100n)).toBe(100n * BUFFER_PERIOD);
    expect(getRequiredWrap(0n, 100n, 0n, 1000n)).toEqual({
      buffer: 1440000n,
      depositTopUp: 1440000n,
      wrapValue: 2881001n,
    });
    expect(getRequiredWrap(2881001n, 100n, 0n, 1000n).wrapValue).toBe(0n);
    expect(getRequiredWrap(0n, 100n, 1440000n, 1000n).depositTopUp).toBe(0n);
  });
  it("opens tagged flow after wrap/deposit and connects refunds for the backer", () => {
    const ops = buildOpenStreamOps(params);
    expect(ops.map((op) => op.operationType)).toEqual([301, 301, 201, 201]);
    expect(ops.map((op) => op.target)).toEqual([
      params.ethx,
      params.board,
      params.cfaAgreement,
      params.gdaAgreement,
    ]);
    expect(flow(ops[2]).decoded.functionName).toBe("createFlow");
    expect(decodeAbiParameters([{ type: "address" }], flow(ops[2]).tag)[0]).toBe(params.markee);
    expect(decodeFunctionData({ abi: boardAbi, data: ops[1].data }).args).toEqual([
      params.backer,
      params.buffer,
    ]);
    expect(buildOpenStreamOps({ ...params, wrapValue: 0n })).toHaveLength(3);
  });
  it("retargets by atomic delete/create; update preserves old tag; stop only deletes", () => {
    const move = buildMoveStreamOps({ ...params, depositTopUp: 0n, wrapValue: 0n });
    expect(move).toHaveLength(3);
    expect(flow(move[0]).decoded.functionName).toBe("deleteFlow");
    expect(flow(move[1]).decoded.functionName).toBe("createFlow");
    expect(decodeAbiParameters([{ type: "address" }], flow(move[1]).tag)[0]).toBe(params.markee);
    const update = buildUpdateStreamOps({ ...params, depositTopUp: 1n });
    expect(decodeFunctionData({ abi: boardAbi, data: update[1].data }).args).toEqual([
      params.backer,
      1n,
    ]);
    expect(flow(update[2])).toMatchObject({ decoded: { functionName: "updateFlow" }, tag: "0x" });
    expect(flow(buildStopStreamOps(params)[0])).toMatchObject({
      decoded: { functionName: "deleteFlow" },
      tag: "0x",
    });
  });
  it("enforces UTF-8 bytes and rejects malformed surrogate input", () => {
    expect(() => validateMarkeeText("😀", 4n)).not.toThrow();
    expect(() => validateMarkeeText("😀", 3n)).toThrow(/byte/);
    expect(() => validateMarkeeText("\ud800", 100n)).toThrow(/Unicode/);
  });
  it("only accepts canonical creation evidence with intended recipient/admin", () => {
    const topics = encodeEventTopics({
      abi: factoryAbi,
      eventName: "LeaderboardCreated",
      args: {
        leaderboardAddress: params.board,
        admin: MARKEE_ADMIN,
        beneficiaryAddress: MARKEE_BENEFICIARY,
      },
    });
    const log = {
      address: MARKEE_FACTORY,
      topics: topics as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        [{ type: "string" }, { type: "address" }],
        ["revnet.money", params.markee],
      ),
    };
    expect(decodeBoardCreated([log])).toEqual({ board: params.board, seedMarkee: params.markee });
    expect(() => decodeBoardCreated([{ ...log, address: params.board }])).toThrow();
    expect(() => decodeBoardCreated([log, log])).toThrow();
    expect(() =>
      decodeBoardCreated([
        {
          ...log,
          topics: encodeEventTopics({
            abi: factoryAbi,
            eventName: "LeaderboardCreated",
            args: {
              leaderboardAddress: params.board,
              admin: MARKEE_ADMIN,
              beneficiaryAddress: zeroAddress,
            },
          }) as [Hex, ...Hex[]],
        },
      ]),
    ).toThrow();
  });
  it("checks exact message creation owner, contents and emitting board", () => {
    const log = {
      address: params.board,
      topics: encodeEventTopics({
        abi: boardAbi,
        eventName: "MarkeeCreated",
        args: { markeeAddress: params.markee, owner: params.backer },
      }) as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }], ["hello", "title"]),
    };
    expect(decodeMarkeeCreated([log], params.board, params.backer, "hello", "title")).toBe(
      params.markee,
    );
    expect(() =>
      decodeMarkeeCreated([log], params.board, params.backer, "changed", "title"),
    ).toThrow();
    expect(() => decodeMarkeeCreated([log], params.board, zeroAddress, "hello", "title")).toThrow();
    expect(() =>
      decodeMarkeeCreated(
        [{ ...log, address: params.markee }],
        params.board,
        params.backer,
        "hello",
        "title",
      ),
    ).toThrow();
  });
  it("reads canonical message identity and refuses migrated or unregistered advertisements", async () => {
    const values: Record<string, unknown> = {
      isMarkeeOnLeaderboard: true,
      pricingStrategy: params.board,
      owner: params.backer,
      message: "hello",
      name: "title",
    };
    const client = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => values[functionName],
      ),
    } as unknown as PublicClient;
    await expect(
      readMarkeeMessage(client, { address: params.board }, params.markee),
    ).resolves.toEqual({ owner: params.backer, message: "hello", name: "title" });
    values.pricingStrategy = zeroAddress;
    await expect(
      readMarkeeMessage(client, { address: params.board }, params.markee),
    ).rejects.toThrow(/strategy/);
    values.pricingStrategy = params.board;
    values.isMarkeeOnLeaderboard = false;
    await expect(
      readMarkeeMessage(client, { address: params.board }, params.markee),
    ).rejects.toThrow(/registered/);
  });
  it("allows exits after admin, recipient, implementation pointer and jail status change", async () => {
    const values: Record<string, unknown> = {
      HOST: STREAMING_BASE.host,
      ETHX: STREAMING_BASE.ethx,
      factory: MARKEE_FACTORY,
      VERSION: "streaming-1.0.0",
      isFactoryLeaderboard: true,
      admin: zeroAddress,
      beneficiaryAddress: zeroAddress,
      leaderboardImplementation: address("7"),
      markeeImplementation: address("8"),
      percentToBeneficiary: 6200n,
      percentToPlatformFeeReceiver: 0n,
      isAppJailed: true,
    };
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => values[functionName],
    );
    const client = {
      getChainId: vi.fn(async () => 8453),
      getCode: vi.fn(
        async () =>
          "0x363d3d373d3d3d363d73d2038c21efcf5245547a66f85229cd654c7664b75af43d82803e903d91602b57fd5bf3",
      ),
      readContract,
    } as unknown as PublicClient;
    await expect(readMarkeeExitBoard(client, params.board)).resolves.toEqual({
      address: params.board,
    });
    expect(readContract.mock.calls.map(([p]) => p.functionName)).not.toContain(
      "leaderboardImplementation",
    );
    await expect(readMarkeeBoard(client, params.board)).rejects.toThrow(/admin/);
    values.ETHX = zeroAddress;
    await expect(readMarkeeExitBoard(client, params.board)).rejects.toThrow(/token/);
    values.ETHX = STREAMING_BASE.ethx;
    values.isFactoryLeaderboard = false;
    await expect(readMarkeeExitBoard(client, params.board)).rejects.toThrow(/provenance/);
  });
  it("refuses a factory-registered board whose recipient has changed", async () => {
    const values: Record<string, unknown> = {
      HOST: STREAMING_BASE.host,
      ETHX: STREAMING_BASE.ethx,
      leaderboardImplementation: address("7"),
      markeeImplementation: address("8"),
      defaultMinimumMonthlyRate: 1n,
      defaultMaxMessageLength: 100n,
      defaultMaxNameLength: 20n,
      percentToBeneficiary: 6200n,
      percentToPlatformFeeReceiver: 0n,
      revNetEnabled: false,
      VERSION: "streaming-1.0.0",
      isFactoryLeaderboard: true,
      factory: MARKEE_FACTORY,
      admin: MARKEE_ADMIN,
      beneficiaryAddress: zeroAddress,
      leaderboardName: "revnet.money",
      minimumMonthlyRate: 1n,
      maxMessageLength: 100n,
      maxNameLength: 20n,
      topMarkee: zeroAddress,
      topRate: 0n,
      boardPlatform: ["website", "revnet.money"],
      isApp: true,
      isAppJailed: false,
    };
    const client = {
      getChainId: vi.fn(async () => 8453),
      getCode: vi.fn(
        async () => `0x363d3d373d3d3d363d73${address("7").slice(2)}5af43d82803e903d91602b57fd5bf3`,
      ),
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => values[functionName],
      ),
    } as unknown as PublicClient;
    await expect(readMarkeeBoard(client, params.board)).rejects.toThrow(/beneficiary/);
    values.beneficiaryAddress = MARKEE_BENEFICIARY;
    values.revNetEnabled = true;
    await expect(readMarkeeBoard(client, params.board)).resolves.toMatchObject({
      address: params.board,
      topMarkee: zeroAddress,
      message: "",
      beneficiaryBps: 6200n,
    });
    values.isAppJailed = true;
    await expect(readMarkeeBoard(client, params.board)).rejects.toThrow(/inactive/);
  });
});
