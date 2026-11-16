import {
  fetchPoolComposition,
  readPoolLpPositions,
  readUserLpPositions,
  type PoolSnapshot,
} from "@/app/[slug]/components/v6/owners/market/lib";
import {
  IndexedLpPositionsOperation,
  IndexedPoolRangesOperation,
} from "@/lib/bendystraw/operations";
import {
  UNISWAP_V4_INITIALIZE_TOPIC,
  uniswapV4PoolStateSlot,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { encodeAbiParameters, keccak256, numberToHex, zeroAddress, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  readContract: vi.fn(),
  request: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/bendystraw/client", () => ({ queryBendystrawFromBrowser: mocks.query }));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: mocks.client }));

const owner = "0x1111111111111111111111111111111111111111";
const projectToken = "0x2222222222222222222222222222222222222222";
let sequence = 0;
let pool: PoolSnapshot;

function range(overrides = {}) {
  return {
    chainId: pool.chainId,
    projectId: pool.projectId,
    version: 6,
    poolId: pool.poolId,
    tickLower: -60,
    tickUpper: 60,
    liquidity: "1000000000000000000",
    ...overrides,
  };
}

/** PoolManager storage for these ranges, laid out as v4-core's StateLibrary reads it. */
function poolStorage(ranges: { tickLower: number; tickUpper: number; liquidity: bigint }[]) {
  const stateSlot = BigInt(uniswapV4PoolStateSlot(pool.poolId));
  const slotOf = (key: number, offset: bigint) =>
    keccak256(
      encodeAbiParameters(
        [{ type: "int256" }, { type: "uint256" }],
        [BigInt(key), stateSlot + offset],
      ),
    );
  const nets = new Map<number, bigint>();
  for (const { tickLower, tickUpper, liquidity } of ranges) {
    nets.set(tickLower, (nets.get(tickLower) ?? 0n) + liquidity);
    nets.set(tickUpper, (nets.get(tickUpper) ?? 0n) - liquidity);
  }
  const words = new Map<number, bigint>();
  const storage = new Map<Hex, Hex>();
  for (const [tick, net] of nets) {
    const compressed = Math.floor(tick / pool.key.tickSpacing);
    const word = compressed >> 8;
    words.set(word, (words.get(word) ?? 0n) | (1n << BigInt(compressed & 0xff)));
    storage.set(slotOf(tick, 4n), numberToHex(BigInt.asUintN(128, net) << 128n, { size: 32 }));
  }
  for (const [word, bits] of words) {
    storage.set(slotOf(word, 5n), numberToHex(bits, { size: 32 }));
  }
  mocks.readContract.mockImplementation(async ({ args: [slots] }: { args: [Hex[]] }) =>
    slots.map((slot) => storage.get(slot) ?? numberToHex(0n, { size: 32 })),
  );
}

function refuseWideLogRanges() {
  const refuse = (from: bigint, to: bigint) => {
    if (to - from >= 500n) throw Object.assign(new Error("RPC request failed"), { code: -32005 });
  };
  mocks.getLogs.mockImplementation(async ({ fromBlock, toBlock }) => {
    refuse(fromBlock, toBlock);
    return [];
  });
  mocks.request.mockImplementation(async ({ params: [{ fromBlock, toBlock }] }) => {
    refuse(BigInt(fromBlock), BigInt(toBlock));
    return [{ topics: [UNISWAP_V4_INITIALIZE_TOPIC], blockNumber: 1n }];
  });
}

function position(tokenId = 1, overrides = {}) {
  return {
    chainId: pool.chainId,
    poolId: pool.poolId,
    tokenId: String(tokenId),
    owner,
    tickLower: -60,
    tickUpper: 60,
    liquidity: "1000000000000000000",
    feesClaimed0: "12",
    feesClaimed1: "34",
    ...overrides,
  };
}

beforeEach(() => {
  pool = {
    chainId: 1,
    projectId: 1,
    hook: zeroAddress,
    key: {
      currency0: zeroAddress,
      currency1: projectToken,
      fee: 3_000,
      tickSpacing: 60,
      hooks: zeroAddress,
    },
    poolId: `0x${(++sequence).toString(16).padStart(64, "0")}`,
    sqrtP: uniswapV4SqrtPriceX96AtTick(0),
    pair: { addr: zeroAddress, decimals: 18, symbol: "ETH", currency: 1 },
    pairIsC0: true,
    projectToken,
    price: 1,
    poolManager: "0x5555555555555555555555555555555555555555",
  };
  mocks.client.mockReturnValue(mocks);
  mocks.getBlockNumber.mockResolvedValue(100n);
  mocks.getLogs.mockImplementation(async ({ event }) =>
    event.name === "Initialize"
      ? [{ blockNumber: 1n }]
      : [{ blockNumber: 2n, args: { tickLower: -120, tickUpper: 120, liquidityDelta: 9n } }],
  );
  mocks.request.mockResolvedValue([{ topics: [UNISWAP_V4_INITIALIZE_TOPIC], blockNumber: 1n }]);
  poolStorage([{ tickLower: -120, tickUpper: 120, liquidity: 9n }]);
});

describe("indexed pool composition", () => {
  it("values all net ranges at the live price without downloading liquidity history", async () => {
    mocks.query
      .mockResolvedValueOnce({ buybackPoolRanges: { totalCount: 2, items: [range()] } })
      .mockResolvedValueOnce({
        buybackPoolRanges: { totalCount: 2, items: [range({ tickUpper: 120 })] },
      });

    const composition = await fetchPoolComposition(pool);
    expect(composition?.ranges).toHaveLength(2);
    expect(composition?.pairAmount).toBeGreaterThan(0n);
    expect(composition?.tokenAmount).toBeGreaterThan(0n);
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      IndexedPoolRangesOperation,
      {
        chainId: 1,
        projectId: 1,
        version: 6,
        poolId: pool.poolId,
        limit: 1000,
        offset: 1,
      },
      1,
    );
    expect(mocks.client).not.toHaveBeenCalled();

    mocks.query.mockResolvedValue({ buybackPoolRanges: { totalCount: 1, items: [range()] } });
    const aboveRange = await fetchPoolComposition({
      ...pool,
      sqrtP: uniswapV4SqrtPriceX96AtTick(180),
    });
    expect(aboveRange?.pairAmount).toBe(0n);
    expect(aboveRange?.tokenAmount).toBeGreaterThan(0n);
    const reversedPair = await fetchPoolComposition({
      ...pool,
      pairIsC0: false,
      sqrtP: uniswapV4SqrtPriceX96AtTick(180),
    });
    expect(reversedPair?.tokenAmount).toBe(0n);
    expect(reversedPair?.pairAmount).toBe(aboveRange?.tokenAmount);
  });

  it("keeps explicit zero ranges as a known withdrawn pool", async () => {
    mocks.query.mockResolvedValue({
      buybackPoolRanges: { totalCount: 1, items: [range({ liquidity: "0" })] },
    });
    await expect(fetchPoolComposition(pool)).resolves.toEqual({
      pairAmount: 0n,
      tokenAmount: 0n,
      ranges: [],
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    ["no rows", () => ({ totalCount: 0, items: [] })],
    ["wrong chain", () => ({ totalCount: 1, items: [range({ chainId: 10 })] })],
    ["wrong project", () => ({ totalCount: 1, items: [range({ projectId: 2 })] })],
    ["wrong version", () => ({ totalCount: 1, items: [range({ version: 5 })] })],
    ["wrong pool", () => ({ totalCount: 1, items: [range({ poolId: zeroAddress })] })],
    ["invalid range", () => ({ totalCount: 1, items: [range({ tickLower: 60 })] })],
    ["negative liquidity", () => ({ totalCount: 1, items: [range({ liquidity: "-1" })] })],
    ["missing count", () => ({ items: [range()] })],
    ["duplicate ranges", () => ({ totalCount: 2, items: [range(), range()] })],
  ])("reads live pool state for %s", async (_name, response) => {
    mocks.query.mockResolvedValue({ buybackPoolRanges: response() });
    const composition = await fetchPoolComposition(pool);
    expect(composition.ranges).toEqual([{ tickLower: -120, tickUpper: 120, liquidity: 9n }]);
    expect(mocks.getLogs).not.toHaveBeenCalled();
  });

  it.each(["truncated", "changed"])(
    "rejects %s pagination instead of showing partial reserves",
    async (kind) => {
      mocks.query
        .mockResolvedValueOnce({ buybackPoolRanges: { totalCount: 2, items: [range()] } })
        .mockResolvedValueOnce({
          buybackPoolRanges: { totalCount: kind === "changed" ? 1 : 2, items: [] },
        });
      expect((await fetchPoolComposition(pool)).ranges[0].liquidity).toBe(9n);
    },
  );
});

describe("pool composition without an index", () => {
  beforeEach(() => {
    mocks.query.mockResolvedValue({ buybackPoolRanges: { totalCount: 0, items: [] } });
    refuseWideLogRanges();
  });

  it("nets overlapping ranges across negative and positive ticks at one pinned block", async () => {
    poolStorage([
      { tickLower: -180_000, tickUpper: 60, liquidity: 5n },
      { tickLower: -60, tickUpper: 180_000, liquidity: 7n },
    ]);
    const composition = await fetchPoolComposition(pool);
    expect(composition.ranges).toEqual([
      { tickLower: -180_000, tickUpper: -60, liquidity: 5n },
      { tickLower: -60, tickUpper: 60, liquidity: 12n },
      { tickLower: 60, tickUpper: 180_000, liquidity: 7n },
    ]);
    expect(mocks.readContract.mock.calls.every(([call]) => call.blockNumber === 100n)).toBe(true);
  });

  it("reports an empty pool as no reserves instead of failing", async () => {
    poolStorage([]);
    await expect(fetchPoolComposition(pool)).resolves.toEqual({
      pairAmount: 0n,
      tokenAmount: 0n,
      ranges: [],
    });
  });

  it("stays under Center's request size on the narrowest tick spacing", async () => {
    pool.key = { ...pool.key, tickSpacing: 1 };
    poolStorage([{ tickLower: -1, tickUpper: 1, liquidity: 3n }]);
    const composition = await fetchPoolComposition(pool);
    expect(composition.ranges).toEqual([{ tickLower: -1, tickUpper: 1, liquidity: 3n }]);
    const sizes = mocks.readContract.mock.calls.map(([call]) => call.args[0].length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1_000);
  });

  it("rejects tick state that does not net to zero", async () => {
    poolStorage([{ tickLower: -60, tickUpper: 60, liquidity: 3n }]);
    const read = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async (call) => {
      const values: Hex[] = await read(call);
      return values.map((value, index) =>
        index === 0 && BigInt(value) >> 128n ? numberToHex(1n << 128n, { size: 32 }) : value,
      );
    });
    await expect(fetchPoolComposition(pool)).rejects.toThrow();
  });

  it("lets a failed state read surface so the card can offer a retry", async () => {
    mocks.readContract.mockRejectedValue(new Error("RPC down"));
    await expect(fetchPoolComposition(pool)).rejects.toThrow("RPC down");
  });
});

describe("indexed LP ownership", () => {
  it("includes positions past the first 250 and retains ownership and claimed fees", async () => {
    mocks.query.mockImplementation(async (_operation, { offset }) => ({
      buybackPoolPositions: {
        totalCount: 251,
        items:
          offset === 0
            ? Array.from({ length: 250 }, (_, i) => position(i + 1, { owner: projectToken }))
            : [position(251)],
      },
    }));
    const positions = await readPoolLpPositions(pool);
    expect(positions).toHaveLength(251);
    expect(positions[250]).toMatchObject({
      tokenId: 251n,
      owner,
      claimedPairFees: 12n,
      claimedTokenFees: 34n,
    });
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      IndexedLpPositionsOperation,
      {
        chainId: 1,
        poolId: pool.poolId,
        limit: 250,
        offset: 250,
      },
      1,
    );
    expect((await readUserLpPositions(pool, owner)).map((item) => item.tokenId)).toEqual([251n]);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["truncated", "duplicate", "wrong pool"])(
    "falls back rather than accepting %s position pages",
    async (kind) => {
      mocks.query
        .mockResolvedValueOnce({ buybackPoolPositions: { totalCount: 2, items: [position()] } })
        .mockResolvedValueOnce({
          buybackPoolPositions: {
            totalCount: 2,
            items:
              kind === "truncated"
                ? []
                : [
                    position(
                      kind === "duplicate" ? 1 : 2,
                      kind === "wrong pool" ? { poolId: zeroAddress } : {},
                    ),
                  ],
          },
        });
      await expect(readPoolLpPositions(pool)).resolves.toEqual([]);
      expect(mocks.request).toHaveBeenCalledOnce();
    },
  );

  it("walks history in windows the RPC accepts, including a later revisit", async () => {
    mocks.query.mockResolvedValue({ buybackPoolPositions: { totalCount: 0, items: [] } });
    refuseWideLogRanges();
    mocks.getBlockNumber.mockResolvedValue(5_000n);
    await expect(readPoolLpPositions(pool)).resolves.toEqual([]);

    mocks.getBlockNumber.mockResolvedValue(9_000n);
    await expect(readPoolLpPositions(pool)).resolves.toEqual([]);
    expect(mocks.request.mock.calls.length).toBeGreaterThan(1);
  });

  it("knows an empty pool has no positions without walking its history", async () => {
    mocks.query.mockResolvedValue({ buybackPoolPositions: { totalCount: 0, items: [] } });
    poolStorage([]);
    refuseWideLogRanges();
    await expect(readPoolLpPositions(pool)).resolves.toEqual([]);
    await expect(readUserLpPositions(pool, owner)).resolves.toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
