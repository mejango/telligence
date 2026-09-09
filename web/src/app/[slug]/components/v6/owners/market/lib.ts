import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import {
  IndexedLpPositionsOperation,
  IndexedPoolLiquidityEventsOperation,
} from "@/lib/bendystraw/operations";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  JBBuybackHookContracts,
  jbBuybackHookRegistryAbi,
  JBChainId,
  jbContractAddress,
  jbControllerAbi,
  JBCoreContracts,
  jbDirectoryAbi,
  jbOmnichainDeployerAbi,
  JBOmnichainDeployerContracts,
  jbPricesAbi,
  jbSplitsAbi,
  jbUniswapV4LpSplitHookAbi,
  NATIVE_TOKEN,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import {
  buildCollectUniswapV4FeesTx,
  getAccountingContexts,
  getCashOutQuote,
  getCurrentRuleset,
  readUniswapV4PositionFees,
  UNISWAP_PERMIT2_ADDRESS,
  UNISWAP_V4_INITIALIZE_TOPIC,
  UNISWAP_V4_MAX_TICK,
  UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC,
  UNISWAP_V4_POOL_MANAGER_ADDRESSES,
  UNISWAP_V4_POSITION_MANAGER_ADDRESSES,
  uniswapV4AlignTickDown,
  uniswapV4AlignTickUp,
  uniswapV4AmountsForLiquidity,
  uniswapV4LiquidityForAmounts,
  uniswapV4PoolId,
  uniswapV4PoolStateSlot,
  uniswapV4PositionTicks,
  uniswapV4PositionTokenIdFromLog,
  uniswapV4PriceFromSqrtPriceX96,
  uniswapV4SqrtPriceX96AtTick,
  uniswapV4SqrtPriceX96FromSlot0,
  type UniswapV4PoolKey,
} from "@bananapus/nana-sdk-core/v6";
import {
  Address,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  Hex,
  parseAbiItem,
  PublicClient,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { ChainProject } from "../settlement/lib";

// ── Uniswap V4 singletons (from deploy-all-v6 Deploy.s.sol) ──────────────────

const POOL_MANAGER_BY_CHAIN = UNISWAP_V4_POOL_MANAGER_ADDRESSES as Readonly<
  Partial<Record<number, Address>>
>;
export const POSITION_MANAGER_BY_CHAIN = UNISWAP_V4_POSITION_MANAGER_ADDRESSES as Readonly<
  Partial<Record<number, Address>>
>;

const POOL_KEY_OF_ABI = [
  {
    type: "function",
    name: "poolKeyOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
  },
] as const;

const EXTSLOAD_ABI = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "positionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPoolAndPositionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "info", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPositionLiquidity",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

type PoolKey = UniswapV4PoolKey;

// ── Buyback hook resolution ───────────────────────────────────────────────────

function v6Address(contract: string, chainId: JBChainId): Address | null {
  const byChain = (jbContractAddress[6] as Record<string, Record<string, string>>)[contract];
  return (byChain?.[String(chainId)] as Address | undefined) ?? null;
}

interface DataHookInfo {
  dataHook: Address;
  rulesetId: bigint;
  weight: bigint;
}

/** The project's current ruleset data hook + id + weight, controller resolved from the directory. */
async function projectDataHook(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<DataHookInfo | null> {
  const directory = jbContractAddress[6][JBCoreContracts.JBDirectory][chainId] as Address;
  const controller = await client.readContract({
    address: directory,
    abi: jbDirectoryAbi,
    functionName: "controllerOf",
    args: [projectId],
  });
  if (!controller || controller === zeroAddress) return null;
  const [ruleset, metadata] = await client.readContract({
    address: controller,
    abi: jbControllerAbi,
    functionName: "currentRulesetOf",
    args: [projectId],
  });
  return { dataHook: metadata.dataHook, rulesetId: BigInt(ruleset.id), weight: ruleset.weight };
}

/**
 * The project's ACTUAL buyback hook, or null when it has no buyback pool.
 * Recognizes the ruleset data hook against the known singleton wrappers — the
 * defaulting hookOf/terminal getters must NOT be trusted for a project that
 * doesn't route through the registry (they return a default → wrong pool):
 * REVOwner / JBBuybackHookRegistry → registry.hookOf(projectId);
 * JBOmnichainDeployer → unwrap extraDataHookOf and recognize that;
 * the concrete JBBuybackHook wired directly → itself; anything else → null.
 */
async function projectBuybackHook(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<{ hook: Address | null; info: DataHookInfo | null }> {
  const info = await projectDataHook(client, chainId, projectId).catch(() => null);
  if (!info || info.dataHook === zeroAddress) return { hook: null, info };

  const registry = v6Address(JBBuybackHookContracts.JBBuybackHookRegistry, chainId);
  const revOwner = v6Address(RevnetCoreContracts.REVOwner, chainId);
  const omni = v6Address(JBOmnichainDeployerContracts.JBOmnichainDeployer, chainId);
  const concrete = v6Address(JBBuybackHookContracts.JBBuybackHook, chainId);
  const lc = (a: string | null) => (a ?? "").toLowerCase();

  const recognize = async (dataHook: Address): Promise<Address | null> => {
    const d = dataHook.toLowerCase();
    if (registry && (d === lc(registry) || d === lc(revOwner))) {
      try {
        const hook = await client.readContract({
          address: registry,
          abi: jbBuybackHookRegistryAbi,
          functionName: "hookOf",
          args: [projectId],
        });
        return hook && hook !== zeroAddress ? hook : null;
      } catch {
        return null;
      }
    }
    if (concrete && d === lc(concrete)) return dataHook;
    return null;
  };

  let hook = await recognize(info.dataHook);
  if (!hook && omni && info.dataHook.toLowerCase() === lc(omni)) {
    // The omnichain deployer inserts ITSELF as the data hook and stores the real one.
    try {
      const extra = await client.readContract({
        address: omni,
        abi: jbOmnichainDeployerAbi,
        functionName: "extraDataHookOf",
        args: [projectId, info.rulesetId],
      });
      if (extra.dataHook && extra.dataHook !== zeroAddress) hook = await recognize(extra.dataHook);
    } catch {
      hook = null;
    }
  }
  return { hook, info };
}

// ── Pool state ────────────────────────────────────────────────────────────────

interface PairToken {
  /** Pool-currency form: native ETH = zero address, else the ERC-20. */
  addr: Address;
  decimals: number;
  symbol: string;
  /** The accounting context's currency id — token-keyed, not a standard id. */
  currency: number;
}

export interface PoolSnapshot {
  chainId: JBChainId;
  projectId: number;
  hook: Address;
  key: PoolKey;
  poolId: Hex;
  sqrtP: bigint;
  pair: PairToken;
  pairIsC0: boolean;
  projectToken: Address;
  /** Human pair-token per project token. */
  price: number | null;
  poolManager: Address;
}

async function pairTokenFor(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<PairToken | null> {
  const contexts = await getAccountingContexts(client, { chainId, projectId }).catch(() => null);
  const primary = contexts?.[0];
  if (!primary) return null;
  const native =
    primary.token.toLowerCase() === NATIVE_TOKEN.toLowerCase() || primary.token === zeroAddress;
  let symbol = "ETH";
  if (!native) {
    symbol = await client
      .readContract({ address: primary.token, abi: erc20Abi, functionName: "symbol" })
      .catch(() => "tokens");
  }
  return {
    addr: native ? zeroAddress : (primary.token.toLowerCase() as Address),
    decimals: primary.decimals,
    symbol,
    currency: Number(primary.currency),
  };
}

/**
 * The buyback pool's key + live price. The hook keys its pool by
 * (projectId, terminalToken) — pass the project's actual PAIR/accounting token,
 * never a hardcoded native 0x0, or a USDC pool is never found.
 */
export async function readPoolSnapshot(
  chainId: JBChainId,
  projectId: bigint,
  providedClient?: PublicClient,
): Promise<{ hook: Address | null; pool: PoolSnapshot | null }> {
  const client = providedClient ?? (getViemPublicClient(chainId) as PublicClient);
  const poolManager = POOL_MANAGER_BY_CHAIN[Number(chainId)];
  // The pair token comes from the accounting contexts, not the hook, so both
  // resolve concurrently.
  const [{ hook }, pair] = await Promise.all([
    projectBuybackHook(client, chainId, projectId),
    pairTokenFor(client, chainId, projectId),
  ]);
  if (!hook || !poolManager) return { hook: hook ?? null, pool: null };
  if (!pair) return { hook, pool: null };

  let key: PoolKey;
  try {
    key = (await client.readContract({
      address: hook,
      abi: POOL_KEY_OF_ABI,
      functionName: "poolKeyOf",
      args: [projectId, pair.addr],
    })) as PoolKey;
  } catch {
    return { hook, pool: null };
  }
  const c0 = key.currency0.toLowerCase();
  const c1 = key.currency1.toLowerCase();
  if (c0 === zeroAddress && c1 === zeroAddress) return { hook, pool: null };

  const poolId = uniswapV4PoolId(key);
  const stateSlot = uniswapV4PoolStateSlot(poolId);
  let sqrtP = 0n;
  try {
    const slot0 = await client.readContract({
      address: poolManager,
      abi: EXTSLOAD_ABI,
      functionName: "extsload",
      args: [stateSlot],
    });
    sqrtP = uniswapV4SqrtPriceX96FromSlot0(slot0);
  } catch {
    return { hook, pool: null };
  }
  if (sqrtP === 0n) return { hook, pool: null };

  const pairIsC0 = c0 === pair.addr.toLowerCase();
  const projectToken = (pairIsC0 ? key.currency1 : key.currency0) as Address;
  if (projectToken === zeroAddress || projectToken.toLowerCase() === pair.addr.toLowerCase()) {
    return { hook, pool: null };
  }
  const price = uniswapV4PriceFromSqrtPriceX96(sqrtP, pairIsC0, pair.decimals);

  return {
    hook,
    pool: {
      chainId,
      projectId: Number(projectId),
      hook,
      key,
      poolId,
      sqrtP,
      pair,
      pairIsC0,
      projectToken,
      price,
      poolManager,
    },
  };
}

// ── Pool composition via net ModifyLiquidity deltas ───────────────────────────

const INIT_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);
const MODIFY_EVENT = parseAbiItem(
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
);

const SCAN_WINDOW = 45_000n;
const SCAN_BATCH = 8;
const SCAN_MAX_WINDOWS = 80; // ~3.6M blocks back before giving up
const SCAN_REORG_OVERLAP = 128n;

interface PoolLiquidityRange {
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

export interface PoolComposition {
  /** Exact pool reserves at the current price (fees excluded). */
  pairAmount: bigint;
  tokenAmount: bigint;
  /** Every active tick range used to reconstruct the reserves above. */
  ranges: PoolLiquidityRange[];
}

interface PoolLiquidityEvent {
  key: string;
  blockNumber: bigint;
  tickLower: number;
  tickUpper: number;
  delta: bigint;
}

interface PoolHistoryCache {
  initializeBlock: bigint;
  throughBlock: bigint;
  events: PoolLiquidityEvent[];
}

const compositionCache = new Map<string, PoolHistoryCache>();

async function modifyLogsInRange(
  client: PublicClient,
  pool: PoolSnapshot,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolLiquidityEvent[]> {
  if (fromBlock > toBlock) return [];
  const logs = await client.getLogs({
    address: pool.poolManager,
    event: MODIFY_EVENT,
    args: { id: pool.poolId },
    fromBlock,
    toBlock,
  });
  return logs.map((log, index) => ({
    key: `${log.transactionHash ?? log.blockHash ?? log.blockNumber}:${log.logIndex ?? index}`,
    blockNumber: log.blockNumber ?? 0n,
    tickLower: Number(log.args.tickLower),
    tickUpper: Number(log.args.tickUpper),
    delta: log.args.liquidityDelta ?? 0n,
  }));
}

async function scanKnownPoolRange(
  client: PublicClient,
  pool: PoolSnapshot,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PoolLiquidityEvent[]> {
  const events: PoolLiquidityEvent[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const spans: { lo: bigint; hi: bigint }[] = [];
    for (let n = 0; n < SCAN_BATCH && cursor <= toBlock; n++) {
      const hi = cursor + SCAN_WINDOW - 1n > toBlock ? toBlock : cursor + SCAN_WINDOW - 1n;
      spans.push({ lo: cursor, hi });
      cursor = hi + 1n;
    }
    const batches = await Promise.all(
      spans.map(({ lo, hi }) => modifyLogsInRange(client, pool, lo, hi)),
    );
    for (const batch of batches) events.push(...batch);
  }
  return events;
}

/** Value the pool's live ranges at its current price. */
function compositionFromRanges(
  pool: PoolSnapshot,
  ranges: { tickLower: number; tickUpper: number; liquidity: bigint }[],
): PoolComposition {
  const activeRanges = ranges
    .filter((range) => range.liquidity > 0n)
    .sort((a, b) => a.tickLower - b.tickLower || a.tickUpper - b.tickUpper);
  let amount0 = 0n;
  let amount1 = 0n;
  for (const r of activeRanges) {
    const amounts = uniswapV4AmountsForLiquidity(
      pool.sqrtP,
      uniswapV4SqrtPriceX96AtTick(r.tickLower),
      uniswapV4SqrtPriceX96AtTick(r.tickUpper),
      r.liquidity,
    );
    amount0 += amounts.amount0;
    amount1 += amounts.amount1;
  }
  return {
    pairAmount: pool.pairIsC0 ? amount0 : amount1,
    tokenAmount: pool.pairIsC0 ? amount1 : amount0,
    ranges: activeRanges,
  };
}

/**
 * The composition from bendystraw's ModifyLiquidity history: every indexed
 * delta netted per tick range — a few small queries instead of a log scan.
 * Null when the index has nothing for this pool, which reads the same as
 * "not indexed yet", so the caller scans onchain rather than presenting an
 * empty pool as fact.
 */
async function readIndexedPoolComposition(pool: PoolSnapshot): Promise<PoolComposition | null> {
  try {
    const ranges = new Map<string, { tickLower: number; tickUpper: number; liquidity: bigint }>();
    let seen = 0;
    let offset = 0;
    let totalCount = 0;
    do {
      const result = await queryBendystrawFromBrowser(
        IndexedPoolLiquidityEventsOperation,
        {
          projectId: pool.projectId,
          chainId: Number(pool.chainId),
          version: 6,
          limit: 1000,
          offset,
        },
        Number(pool.chainId),
      );
      const page = result.buybackPoolLiquidityEvents?.items ?? [];
      totalCount = result.buybackPoolLiquidityEvents?.totalCount ?? page.length;
      if (!page.length) break;
      offset += page.length;
      for (const item of page) {
        if (item.poolId.toLowerCase() !== pool.poolId.toLowerCase()) continue;
        seen++;
        const key = `${item.tickLower}:${item.tickUpper}`;
        const entry = ranges.get(key) ?? {
          tickLower: item.tickLower,
          tickUpper: item.tickUpper,
          liquidity: 0n,
        };
        entry.liquidity += BigInt(item.liquidityDelta);
        ranges.set(key, entry);
      }
    } while (offset < totalCount);
    if (!seen) return null;
    return compositionFromRanges(pool, [...ranges.values()]);
  } catch {
    return null;
  }
}

/**
 * The pool's current reserves, reconstructed by netting every ModifyLiquidity
 * delta per tick range (all senders — composition covers the whole pool) back to
 * the pool's Initialize event, then valuing each surviving range at the current
 * price. Null when the RPC can't return the complete history.
 */
export async function fetchPoolComposition(pool: PoolSnapshot): Promise<PoolComposition | null> {
  const indexed = await readIndexedPoolComposition(pool);
  if (indexed) return indexed;

  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const cacheKey = `${pool.chainId}:${pool.poolId}`;
  const latest = await client.getBlockNumber();
  let cached = compositionCache.get(cacheKey);
  if (cached && latest < cached.throughBlock) {
    compositionCache.delete(cacheKey);
    cached = undefined;
  }

  let initializeBlock: bigint | null = cached?.initializeBlock ?? null;
  let events: PoolLiquidityEvent[] = [];
  if (cached) {
    const overlapStart =
      cached.throughBlock > SCAN_REORG_OVERLAP
        ? cached.throughBlock - SCAN_REORG_OVERLAP + 1n
        : cached.initializeBlock;
    const fromBlock = overlapStart < cached.initializeBlock ? cached.initializeBlock : overlapStart;
    events = cached.events.filter((event) => event.blockNumber < fromBlock);
    events.push(...(await scanKnownPoolRange(client, pool, fromBlock, latest)));
  } else {
    // A pool-id-filtered Initialize lookup is normally one cheap request and
    // gives an authoritative lower bound for every subsequent range scan.
    try {
      const inits = await client.getLogs({
        address: pool.poolManager,
        event: INIT_EVENT,
        args: { id: pool.poolId },
        fromBlock: 0n,
        toBlock: latest,
      });
      initializeBlock = inits.reduce<bigint | null>((earliest, log) => {
        const block = log.blockNumber;
        if (block == null) return earliest;
        return earliest == null || block < earliest ? block : earliest;
      }, null);
    } catch {
      initializeBlock = null;
    }

    if (initializeBlock != null) {
      events = await scanKnownPoolRange(client, pool, initializeBlock, latest);
    } else {
      // Range-limited RPC fallback: walk backwards in parallel batches until
      // the Initialize event proves that the collected history is complete.
      let cursor = latest;
      let windows = 0;
      while (initializeBlock == null && cursor >= 0n && windows < SCAN_MAX_WINDOWS) {
        const spans: { lo: bigint; hi: bigint }[] = [];
        for (let n = 0; n < SCAN_BATCH && cursor >= 0n && windows < SCAN_MAX_WINDOWS; n++) {
          const hi = cursor;
          const lo = hi >= SCAN_WINDOW ? hi - SCAN_WINDOW + 1n : 0n;
          spans.push({ lo, hi });
          cursor = lo === 0n ? -1n : lo - 1n;
          windows++;
        }
        const results = await Promise.all(
          spans.map(async ({ lo, hi }) => {
            const [inits, mods] = await Promise.all([
              client.getLogs({
                address: pool.poolManager,
                event: INIT_EVENT,
                args: { id: pool.poolId },
                fromBlock: lo,
                toBlock: hi,
              }),
              modifyLogsInRange(client, pool, lo, hi),
            ]);
            return { inits, mods };
          }),
        );
        for (const result of results) {
          events.push(...result.mods);
          for (const log of result.inits) {
            const block = log.blockNumber;
            if (block != null && (initializeBlock == null || block < initializeBlock)) {
              initializeBlock = block;
            }
          }
        }
      }
    }
  }
  if (initializeBlock == null) return null; // incomplete history — never show an invented composition

  const uniqueEvents = new Map(events.map((event) => [event.key, event]));
  events = [...uniqueEvents.values()].sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.key.localeCompare(b.key),
  );
  compositionCache.set(cacheKey, { initializeBlock, throughBlock: latest, events });

  const ranges = new Map<string, { tickLower: number; tickUpper: number; liquidity: bigint }>();
  for (const event of events) {
    const key = `${event.tickLower}:${event.tickUpper}`;
    const entry = ranges.get(key) ?? {
      tickLower: event.tickLower,
      tickUpper: event.tickUpper,
      liquidity: 0n,
    };
    entry.liquidity += event.delta;
    ranges.set(key, entry);
  }

  const value = compositionFromRanges(pool, [...ranges.values()]);
  return value;
}

// ── Wallet LP positions + full-exit removal ─────────────────────────────────

type RawPoolLog = {
  topics?: readonly (string | null)[];
  data?: string;
  blockNumber?: bigint | string | number;
};

export interface UserLpPosition {
  tokenId: bigint;
  owner: Address;
  info: bigint;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  pairAmount: bigint;
  tokenAmount: bigint;
  /** Fees already taken, from the index; undefined when it hasn't indexed this pool. */
  claimedPairFees?: bigint;
  claimedTokenFees?: bigint;
}

export interface RemoveLiquidityPlan {
  unlockData: Hex;
  deadline: bigint;
  pairMinimum: bigint;
  tokenMinimum: bigint;
}

async function rawPoolLogs(
  client: PublicClient,
  pool: PoolSnapshot,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawPoolLog[]> {
  return (await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: pool.poolManager,
        topics: [[UNISWAP_V4_INITIALIZE_TOPIC, UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC], pool.poolId],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ],
  } as never)) as RawPoolLog[];
}

/**
 * Enumerate every canonical PositionManager NFT in this pool. A capped or
 * failed history is rejected: silently omitting an owned position would make
 * the management surface incorrect.
 */
/** Windows fetched concurrently per round while walking back to the pool's Initialize. */
const SCAN_BATCH_WINDOWS = 6;

/**
 * Session cache of a pool's scanned history, keyed by chain + pool + position
 * manager. A pool's Initialize block and the positions minted before
 * `throughBlock` never change, so a revisit only scans forward from there
 * instead of walking hundreds of thousands of blocks again.
 */
const poolHistoryCache = new Map<
  string,
  { initializeBlock: bigint; throughBlock: bigint; ids: Map<string, bigint> }
>();

async function poolPositionTokenIds(
  client: PublicClient,
  pool: PoolSnapshot,
  positionManager: Address,
): Promise<bigint[]> {
  const latest = await client.getBlockNumber();
  const cacheKey = `${pool.chainId}:${pool.poolId.toLowerCase()}:${positionManager.toLowerCase()}`;
  const cached = poolHistoryCache.get(cacheKey);

  const ids = new Map<string, bigint>(cached?.ids);
  let initializeBlock = cached?.initializeBlock ?? null;

  const absorb = (logs: RawPoolLog[]) => {
    for (const log of logs) {
      const topic = String(log.topics?.[0] ?? "").toLowerCase();
      if (topic === UNISWAP_V4_INITIALIZE_TOPIC.toLowerCase()) {
        const block = BigInt(log.blockNumber ?? 0);
        if (initializeBlock == null || block < initializeBlock) initializeBlock = block;
      }
      const tokenId = uniswapV4PositionTokenIdFromLog(log, positionManager);
      if (tokenId != null) ids.set(tokenId.toString(), tokenId);
    }
  };

  if (cached) {
    // Known pool: only the blocks added since the last scan are unseen. A short
    // overlap keeps a shallow reorg from dropping a position.
    const from = cached.throughBlock > 16n ? cached.throughBlock - 16n : 0n;
    if (latest >= from) absorb(await rawPoolLogs(client, pool, from, latest));
  } else {
    // Cold pool: walk back toward Initialize, several windows per round trip.
    // Sequential windows made this a minute-long wait on a pool a few hundred
    // thousand blocks deep.
    let cursor = latest;
    let windows = 0;
    while (initializeBlock == null && cursor >= 0n && windows < SCAN_MAX_WINDOWS) {
      const ranges: { from: bigint; to: bigint }[] = [];
      for (
        let n = 0;
        n < SCAN_BATCH_WINDOWS && cursor >= 0n && windows < SCAN_MAX_WINDOWS;
        n += 1
      ) {
        const from = cursor >= SCAN_WINDOW ? cursor - SCAN_WINDOW + 1n : 0n;
        ranges.push({ from, to: cursor });
        windows += 1;
        if (from === 0n) {
          cursor = -1n;
          break;
        }
        cursor = from - 1n;
      }
      const batches = await Promise.all(
        ranges.map((range) => rawPoolLogs(client, pool, range.from, range.to)),
      );
      batches.forEach(absorb);
    }
  }

  if (initializeBlock == null) {
    throw new Error("Could not verify the complete LP position history.");
  }
  poolHistoryCache.set(cacheKey, { initializeBlock, throughBlock: latest, ids: new Map(ids) });
  return [...ids.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function positionFor(
  client: PublicClient,
  pool: PoolSnapshot,
  positionManager: Address,
  tokenId: bigint,
): Promise<UserLpPosition | null> {
  const [info, liquidity, owner] = await Promise.all([
    client.readContract({
      address: positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "positionInfo",
      args: [tokenId],
    }),
    client.readContract({
      address: positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "getPositionLiquidity",
      args: [tokenId],
    }),
    client
      .readContract({
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      })
      .catch(() => null),
  ]);
  if (!owner || info === 0n || liquidity === 0n) return null;
  const [key, verifiedInfo] = await client.readContract({
    address: positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: "getPoolAndPositionInfo",
    args: [tokenId],
  });
  if (verifiedInfo !== info || uniswapV4PoolId(key).toLowerCase() !== pool.poolId.toLowerCase()) {
    throw new Error("PositionManager returned inconsistent pool data.");
  }
  const ticks = uniswapV4PositionTicks(info);
  const amounts = uniswapV4AmountsForLiquidity(
    pool.sqrtP,
    uniswapV4SqrtPriceX96AtTick(ticks.lower),
    uniswapV4SqrtPriceX96AtTick(ticks.upper),
    liquidity,
  );
  return {
    tokenId,
    owner,
    info,
    liquidity,
    tickLower: ticks.lower,
    tickUpper: ticks.upper,
    pairAmount: pool.pairIsC0 ? amounts.amount0 : amounts.amount1,
    tokenAmount: pool.pairIsC0 ? amounts.amount1 : amounts.amount0,
  };
}

/**
 * A pool's positions from bendystraw, or null when the index has nothing for it
 * — which reads the same as "not indexed yet", so callers fall back to the
 * onchain scan rather than presenting an empty pool as fact.
 *
 * `feesClaimed*` is the part no client can derive: the pool overwrites a
 * position's fee checkpoint on every collect, so live state only ever shows
 * what is currently unclaimed.
 */
async function readIndexedLpPositions(pool: PoolSnapshot): Promise<UserLpPosition[] | null> {
  try {
    const result = await queryBendystrawFromBrowser(
      IndexedLpPositionsOperation,
      { chainId: Number(pool.chainId), poolId: pool.poolId, limit: 250 },
      Number(pool.chainId),
    );
    const items = result.buybackPoolPositions?.items ?? [];
    if (!items.length) return null;
    return items
      .map((item) => {
        const liquidity = BigInt(item.liquidity);
        const amounts = uniswapV4AmountsForLiquidity(
          pool.sqrtP,
          uniswapV4SqrtPriceX96AtTick(item.tickLower),
          uniswapV4SqrtPriceX96AtTick(item.tickUpper),
          liquidity,
        );
        const claimed0 = BigInt(item.feesClaimed0);
        const claimed1 = BigInt(item.feesClaimed1);
        return {
          tokenId: BigInt(item.tokenId),
          owner: item.owner as Address,
          info: 0n,
          liquidity,
          tickLower: item.tickLower,
          tickUpper: item.tickUpper,
          pairAmount: pool.pairIsC0 ? amounts.amount0 : amounts.amount1,
          tokenAmount: pool.pairIsC0 ? amounts.amount1 : amounts.amount0,
          claimedPairFees: pool.pairIsC0 ? claimed0 : claimed1,
          claimedTokenFees: pool.pairIsC0 ? claimed1 : claimed0,
        };
      })
      .filter((position) => position.liquidity > 0n);
  } catch {
    return null;
  }
}

/**
 * Every position in the pool, whoever owns it — the index when it has this
 * pool, the onchain scan otherwise.
 */
export async function readPoolLpPositions(pool: PoolSnapshot): Promise<UserLpPosition[]> {
  const indexed = await readIndexedLpPositions(pool);
  if (indexed) return indexed;

  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) return [];
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const ids = await poolPositionTokenIds(client, pool, positionManager);
  const positions = await Promise.all(
    ids.map((tokenId) => positionFor(client, pool, positionManager, tokenId)),
  );
  return positions.filter(
    (position): position is UserLpPosition => position != null && position.liquidity > 0n,
  );
}

export async function readUserLpPositions(
  pool: PoolSnapshot,
  account: Address,
): Promise<UserLpPosition[]> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) return [];

  const indexed = await readIndexedLpPositions(pool);
  if (indexed) {
    return indexed.filter((position) => position.owner.toLowerCase() === account.toLowerCase());
  }

  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const ids = await poolPositionTokenIds(client, pool, positionManager);
  const positions = await Promise.all(
    ids.map((tokenId) => positionFor(client, pool, positionManager, tokenId)),
  );
  return positions.filter(
    (position): position is UserLpPosition =>
      position != null && position.owner.toLowerCase() === account.toLowerCase(),
  );
}

/**
 * The pool's live price and one of the wallet's positions valued at it, read
 * together so a reviewed edit never sizes a fresh position against a stale
 * price. The pool identity is re-verified by getPoolAndPositionInfo inside
 * positionFor.
 */
export async function refreshPoolAndPosition(
  pool: PoolSnapshot,
  tokenId: bigint,
  account: Address,
): Promise<{ pool: PoolSnapshot; position: UserLpPosition }> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) throw new Error("LP management is unavailable on this chain.");
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const slot0 = await client.readContract({
    address: pool.poolManager,
    abi: EXTSLOAD_ABI,
    functionName: "extsload",
    args: [uniswapV4PoolStateSlot(pool.poolId)],
  });
  const sqrtP = uniswapV4SqrtPriceX96FromSlot0(slot0);
  const refreshedPool: PoolSnapshot = {
    ...pool,
    sqrtP,
    price: uniswapV4PriceFromSqrtPriceX96(sqrtP, pool.pairIsC0, pool.pair.decimals),
  };
  const position = await positionFor(client, refreshedPool, positionManager, tokenId);
  if (!position || position.owner.toLowerCase() !== account.toLowerCase()) {
    throw new Error("The connected wallet no longer owns this LP position.");
  }
  return { pool: refreshedPool, position };
}

export async function refreshUserLpPosition(
  pool: PoolSnapshot,
  tokenId: bigint,
  account: Address,
): Promise<UserLpPosition> {
  return (await refreshPoolAndPosition(pool, tokenId, account)).position;
}

/** An EOA reviews and signs in one sitting, so 20 minutes covers the round trip. */
const LP_DEADLINE_SECONDS = 20 * 60;
/**
 * A Safe's co-signer collection routinely outlives 20 minutes, and the deadline
 * is stamped when the transaction is PROPOSED — a 20-minute window means the
 * last owner's signature lands on a call that can no longer execute. Match the
 * 30-day Permit2 approval windows. The longer window widens MEV exposure only
 * within the already-frozen minimum amounts.
 */
const SAFE_LP_DEADLINE_SECONDS = 30 * 24 * 60 * 60;

/** The unix deadline for a liquidity transaction proposed now. */
export function lpDeadline(isSafe: boolean, nowSeconds = Math.floor(Date.now() / 1000)): bigint {
  return BigInt(nowSeconds + (isSafe ? SAFE_LP_DEADLINE_SECONDS : LP_DEADLINE_SECONDS));
}

function retainedFloor(value: bigint): bigint {
  if (value <= 0n) return 0n;
  const floor = (value * 9_500n) / 10_000n;
  return floor > 0n ? floor : 1n;
}

export function prepareRemoveLiquidity(
  pool: PoolSnapshot,
  position: UserLpPosition,
  recipient: Address,
  isSafe = false,
  nowSeconds = Math.floor(Date.now() / 1000),
): RemoveLiquidityPlan {
  const pairMinimum = retainedFloor(position.pairAmount);
  const tokenMinimum = retainedFloor(position.tokenAmount);
  const amount0Minimum = pool.pairIsC0 ? pairMinimum : tokenMinimum;
  const amount1Minimum = pool.pairIsC0 ? tokenMinimum : pairMinimum;
  const burn = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
    [position.tokenId, amount0Minimum, amount1Minimum, "0x"],
  );
  const takePair = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [pool.key.currency0, pool.key.currency1, recipient],
  );
  return {
    unlockData: encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      ["0x0311", [burn, takePair]],
    ),
    deadline: lpDeadline(isSafe, nowSeconds),
    pairMinimum,
    tokenMinimum,
  };
}

export interface LpPositionFees {
  /** Unclaimed pair-token fees, in the pair token's decimals. */
  pairFees: bigint;
  /** Unclaimed project-token fees, 18 decimals. */
  tokenFees: bigint;
}

/**
 * A position's UNCLAIMED fees, mapped into pair/token terms.
 *
 * Not lifetime earnings: the pool rewrites the position's fee checkpoint on
 * every collect, so anything already claimed is no longer visible here.
 */
export async function readLpPositionFees(
  client: PublicClient,
  pool: PoolSnapshot,
  position: Pick<UserLpPosition, "tokenId" | "tickLower" | "tickUpper">,
): Promise<LpPositionFees | null> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) return null;
  const fees = await readUniswapV4PositionFees(client, {
    chainId: pool.chainId,
    poolId: pool.poolId,
    positionManager,
    tokenId: position.tokenId,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
  });
  return {
    pairFees: pool.pairIsC0 ? fees.amount0 : fees.amount1,
    tokenFees: pool.pairIsC0 ? fees.amount1 : fees.amount0,
  };
}

/**
 * Claim a position's fees without touching its liquidity — a zero-liquidity
 * decrease paired with a take. No minimums: nothing is swapped, so the amounts
 * are whatever the pool already accrued and a floor could only make a valid
 * claim revert.
 */
export function prepareCollectLpFees(
  pool: PoolSnapshot,
  position: Pick<UserLpPosition, "tokenId">,
  recipient: Address,
  isSafe = false,
  nowSeconds = Math.floor(Date.now() / 1000),
): { unlockData: Hex; deadline: bigint } {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) throw new Error("No position manager on this chain.");
  const deadline = lpDeadline(isSafe, nowSeconds);
  const tx = buildCollectUniswapV4FeesTx({
    positionManager,
    tokenId: position.tokenId,
    currency0: pool.key.currency0,
    currency1: pool.key.currency1,
    recipient,
    deadline,
  });
  // The caller sends through wagmi with the same ABI it uses for removals, so
  // hand back the arguments rather than the encoded call.
  const [unlockData] = decodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    data: tx.data,
  }).args as readonly [Hex, bigint];
  return { unlockData, deadline };
}

/**
 * Claim the fees of several positions (a market's two sides) in one unlock:
 * a zero-liquidity decrease per position, then one take of both currencies.
 * Same shape as the single collect, just repeated before the take.
 */
export function prepareCollectMarketFees(
  pool: PoolSnapshot,
  tokenIds: readonly bigint[],
  recipient: Address,
): { unlockData: Hex } {
  if (!tokenIds.length) throw new Error("No positions to claim from.");
  const decreases = tokenIds.map((tokenId) =>
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "bytes" },
      ],
      [tokenId, 0n, 0n, 0n, "0x"],
    ),
  );
  const takePair = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [pool.key.currency0, pool.key.currency1, recipient],
  );
  return {
    unlockData: encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      [`0x${"01".repeat(tokenIds.length)}11` as Hex, [...decreases, takePair]],
    ),
  };
}

// ── Add liquidity ────────────────────────────────────────────────────────────

const ACTION_MINT_POSITION = "02";
const ACTION_CLOSE_CURRENCY = "12";
const ACTION_SWEEP = "14";

export const PERMIT2_ADDRESS = UNISWAP_PERMIT2_ADDRESS;
export const PERMIT2_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "address" }],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

export interface AddLiquidityPlan {
  poolId: Hex;
  unlockData: Hex;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  pairMaximum: bigint;
  tokenMaximum: bigint;
  value: bigint;
  erc20Sides: Array<{ currency: Address; max: bigint }>;
  recipient: Address;
}

/**
 * Build a reviewed V4 MINT_POSITION plan. The position can be two-sided or
 * single-sided; maxima include 1% price headroom and unused native value is
 * swept back to the recipient.
 */
export function prepareAddLiquidity(
  pool: PoolSnapshot,
  amounts: { pairAmount: bigint; tokenAmount: bigint },
  range: { minimumPrice: number; maximumPrice: number },
  recipient: Address,
): AddLiquidityPlan {
  if (!(range.minimumPrice > 0) || !(range.maximumPrice > range.minimumPrice)) {
    throw new Error("Set a valid positive price range.");
  }
  const amount0 = pool.pairIsC0 ? amounts.pairAmount : amounts.tokenAmount;
  const amount1 = pool.pairIsC0 ? amounts.tokenAmount : amounts.pairAmount;
  if (amount0 <= 0n && amount1 <= 0n) throw new Error("Enter an amount.");

  const spacing = Number(pool.key.tickSpacing);
  const maxUsable = Math.trunc(UNISWAP_V4_MAX_TICK / spacing) * spacing;
  const minUsable = Math.trunc(-UNISWAP_V4_MAX_TICK / spacing) * spacing;
  const rawPrice = (price: number) =>
    pool.pairIsC0
      ? 10 ** (18 - pool.pair.decimals) / price
      : price * 10 ** (pool.pair.decimals - 18);
  const tickA = Math.log(rawPrice(range.minimumPrice)) / Math.log(1.0001);
  const tickB = Math.log(rawPrice(range.maximumPrice)) / Math.log(1.0001);
  let tickLower = Math.max(
    minUsable,
    uniswapV4AlignTickDown(Math.floor(Math.min(tickA, tickB)), spacing),
  );
  let tickUpper = Math.min(
    maxUsable,
    uniswapV4AlignTickUp(Math.ceil(Math.max(tickA, tickB)), spacing),
  );
  if (tickUpper <= tickLower) tickUpper = Math.min(maxUsable, tickLower + spacing);

  const currentTick = Math.floor((2 * Math.log(Number(pool.sqrtP) / 2 ** 96)) / Math.log(1.0001));
  if (amount1 <= 0n && amount0 > 0n && currentTick >= tickLower) {
    tickLower = Math.min(maxUsable, uniswapV4AlignTickUp(currentTick + 1, spacing));
  }
  if (amount0 <= 0n && amount1 > 0n && currentTick < tickUpper) {
    tickUpper = Math.max(minUsable, uniswapV4AlignTickDown(currentTick, spacing));
  }
  if (tickUpper <= tickLower) tickUpper = Math.min(maxUsable, tickLower + spacing);

  const sqrtA = uniswapV4SqrtPriceX96AtTick(tickLower);
  const sqrtB = uniswapV4SqrtPriceX96AtTick(tickUpper);
  const liquidity = uniswapV4LiquidityForAmounts(pool.sqrtP, sqrtA, sqrtB, amount0, amount1);
  if (liquidity <= 0n) throw new Error("Amounts are too small for this range.");
  const required = uniswapV4AmountsForLiquidity(pool.sqrtP, sqrtA, sqrtB, liquidity);
  const amount0Max = required.amount0 + required.amount0 / 100n + 1n;
  const amount1Max = required.amount1 + required.amount1 / 100n + 1n;
  const nativeIsC0 = pool.pairIsC0 && pool.pair.addr === zeroAddress;
  const nativeIsC1 = !pool.pairIsC0 && pool.pair.addr === zeroAddress;
  const value = nativeIsC0 ? amount0Max : nativeIsC1 ? amount1Max : 0n;
  const erc20Sides: Array<{ currency: Address; max: bigint }> = [];
  if (!nativeIsC0 && amount0Max > 1n) {
    erc20Sides.push({ currency: pool.key.currency0, max: amount0Max });
  }
  if (!nativeIsC1 && amount1Max > 1n) {
    erc20Sides.push({ currency: pool.key.currency1, max: amount1Max });
  }

  const mint = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
      },
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      [pool.key.currency0, pool.key.currency1, pool.key.fee, pool.key.tickSpacing, pool.key.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      recipient,
      "0x",
    ],
  );
  const close0 = encodeAbiParameters([{ type: "address" }], [pool.key.currency0]);
  const close1 = encodeAbiParameters([{ type: "address" }], [pool.key.currency1]);
  const parameters: Hex[] = [mint, close0, close1];
  let actions = `0x${ACTION_MINT_POSITION}${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}` as Hex;
  if (value > 0n) {
    parameters.push(
      encodeAbiParameters([{ type: "address" }, { type: "address" }], [pool.pair.addr, recipient]),
    );
    actions =
      `0x${ACTION_MINT_POSITION}${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}${ACTION_SWEEP}` as Hex;
  }

  return {
    poolId: pool.poolId,
    unlockData: encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      [actions, parameters],
    ),
    tickLower,
    tickUpper,
    liquidity,
    amount0Max,
    amount1Max,
    pairMaximum: pool.pairIsC0 ? amount0Max : amount1Max,
    tokenMaximum: pool.pairIsC0 ? amount1Max : amount0Max,
    value,
    erc20Sides,
    recipient,
  };
}

// ── Edit liquidity ───────────────────────────────────────────────────────────

const ACTION_INCREASE_LIQUIDITY = "00";
const ACTION_DECREASE_LIQUIDITY = "01";
const ACTION_BURN_POSITION = "03";
const ACTION_TAKE_PAIR = "11";

type EditLiquidityKind = "increase" | "decrease" | "move" | "remove";

/**
 * One position's edit as bare V4 actions, before settlement. The single-position
 * flow settles it alone; a market edit strings several sides' operations
 * together under one pair of closes.
 */
interface EditOperations {
  kind: EditLiquidityKind;
  /** Action bytes (hex pairs, no 0x) and their parameters, settlement excluded. */
  actions: string;
  parameters: Hex[];
  tickLower: number;
  tickUpper: number;
  liquidityBefore: bigint;
  liquidity: bigint;
  liquidityDelta: bigint;
  pairHolding: bigint;
  tokenHolding: bigint;
  pairFlow: bigint;
  tokenFlow: bigint;
  pairFunding: bigint;
  tokenFunding: bigint;
  value: bigint;
  erc20Sides: Array<{ currency: Address; max: bigint }>;
  pairMinimum: bigint;
  tokenMinimum: bigint;
  mint: AddLiquidityPlan | null;
  amount0Max: bigint;
  amount1Max: bigint;
}

export interface EditLiquidityPlan extends EditOperations {
  tokenId: bigint;
  unlockData: Hex;
}

/** The three closing actions every wallet-funded plan ends with: settle both currencies, refund unused native value. */
function closeActions(pool: PoolSnapshot, recipient: Address, value: bigint) {
  const parameters: Hex[] = [
    encodeAbiParameters([{ type: "address" }], [pool.key.currency0]),
    encodeAbiParameters([{ type: "address" }], [pool.key.currency1]),
  ];
  let actions = `${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}`;
  if (value > 0n) {
    parameters.push(
      encodeAbiParameters([{ type: "address" }, { type: "address" }], [pool.pair.addr, recipient]),
    );
    actions += ACTION_SWEEP;
  }
  return { actions, parameters };
}

function encodeUnlock(actions: string, parameters: Hex[]): Hex {
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [`0x${actions}` as Hex, parameters],
  );
}

/** Merge per-currency wallet funding from several operations into one allowance list. */
function mergeErc20Sides(
  lists: Array<Array<{ currency: Address; max: bigint }>>,
): Array<{ currency: Address; max: bigint }> {
  const byCurrency = new Map<string, { currency: Address; max: bigint }>();
  for (const list of lists) {
    for (const side of list) {
      const key = side.currency.toLowerCase();
      const current = byCurrency.get(key);
      byCurrency.set(key, {
        currency: side.currency,
        max: (current?.max ?? 0n) + side.max,
      });
    }
  }
  return [...byCurrency.values()];
}

function editOperations(
  pool: PoolSnapshot,
  position: UserLpPosition,
  target: { pairAmount: bigint; tokenAmount: bigint },
  range: { minimumPrice: number; maximumPrice: number } | null,
  recipient: Address,
): EditOperations {
  if (target.pairAmount < 0n || target.tokenAmount < 0n) throw new Error("Enter a valid amount.");
  const byCurrency = (pair: bigint, token: bigint) =>
    pool.pairIsC0 ? { amount0: pair, amount1: token } : { amount0: token, amount1: pair };
  const byPair = (amounts: { amount0: bigint; amount1: bigint }) =>
    pool.pairIsC0
      ? { pair: amounts.amount0, token: amounts.amount1 }
      : { pair: amounts.amount1, token: amounts.amount0 };
  const pairIsNative = pool.pair.addr === zeroAddress;
  const nativeIsC0 = pool.pairIsC0 && pairIsNative;
  const nativeIsC1 = !pool.pairIsC0 && pairIsNative;
  const modifyParams = [
    { type: "uint256" },
    { type: "uint256" },
    { type: "uint128" },
    { type: "uint128" },
    { type: "bytes" },
  ] as const;
  const base = {
    liquidityBefore: position.liquidity,
    pairFunding: 0n,
    tokenFunding: 0n,
    value: 0n,
    erc20Sides: [] as Array<{ currency: Address; max: bigint }>,
    pairMinimum: 0n,
    tokenMinimum: 0n,
    mint: null,
    amount0Max: 0n,
    amount1Max: 0n,
  };

  const removal = (): EditOperations => {
    const pairMinimum = retainedFloor(position.pairAmount);
    const tokenMinimum = retainedFloor(position.tokenAmount);
    const burn = encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
      [
        position.tokenId,
        pool.pairIsC0 ? pairMinimum : tokenMinimum,
        pool.pairIsC0 ? tokenMinimum : pairMinimum,
        "0x",
      ],
    );
    return {
      ...base,
      kind: "remove",
      actions: ACTION_BURN_POSITION,
      parameters: [burn],
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: 0n,
      liquidityDelta: 0n,
      pairHolding: 0n,
      tokenHolding: 0n,
      pairFlow: -position.pairAmount,
      tokenFlow: -position.tokenAmount,
      pairMinimum,
      tokenMinimum,
    };
  };
  if (target.pairAmount <= 0n && target.tokenAmount <= 0n) return removal();

  if (range === null) {
    const sqrtA = uniswapV4SqrtPriceX96AtTick(position.tickLower);
    const sqrtB = uniswapV4SqrtPriceX96AtTick(position.tickUpper);
    const wanted = byCurrency(target.pairAmount, target.tokenAmount);
    const targetLiquidity = uniswapV4LiquidityForAmounts(
      pool.sqrtP,
      sqrtA,
      sqrtB,
      wanted.amount0,
      wanted.amount1,
    );
    if (targetLiquidity <= 0n) {
      // In range, both sides are needed: a zero on one side is not a removal
      // of the other, it is a band that cannot hold what was asked.
      throw new Error(
        target.pairAmount <= 0n || target.tokenAmount <= 0n
          ? `At the current price this band holds both ${pool.pair.symbol} and the project token. Set both, or move the band to one side of the price to hold one of them only.`
          : "Amounts are too small for this band.",
      );
    }
    // Holdings are derived from liquidity with rounding, so an untouched
    // target can round-trip to a liquidity a hair off the position's; that
    // is not an edit.
    const drift =
      targetLiquidity > position.liquidity
        ? targetLiquidity - position.liquidity
        : position.liquidity - targetLiquidity;
    if (drift * 1_000_000n <= position.liquidity) {
      throw new Error("This leaves the position as it is.");
    }
    const holding = byPair(uniswapV4AmountsForLiquidity(pool.sqrtP, sqrtA, sqrtB, targetLiquidity));
    if (targetLiquidity > position.liquidity) {
      const delta = targetLiquidity - position.liquidity;
      const required = uniswapV4AmountsForLiquidity(pool.sqrtP, sqrtA, sqrtB, delta);
      const amount0Max = required.amount0 + required.amount0 / 100n + 1n;
      const amount1Max = required.amount1 + required.amount1 / 100n + 1n;
      const value = nativeIsC0 ? amount0Max : nativeIsC1 ? amount1Max : 0n;
      const erc20Sides: Array<{ currency: Address; max: bigint }> = [];
      if (!nativeIsC0 && amount0Max > 1n) {
        erc20Sides.push({ currency: pool.key.currency0, max: amount0Max });
      }
      if (!nativeIsC1 && amount1Max > 1n) {
        erc20Sides.push({ currency: pool.key.currency1, max: amount1Max });
      }
      const increase = encodeAbiParameters(modifyParams, [
        position.tokenId,
        delta,
        amount0Max,
        amount1Max,
        "0x",
      ]);
      const pull = byPair(required);
      const funding = byPair({ amount0: amount0Max, amount1: amount1Max });
      return {
        ...base,
        kind: "increase",
        actions: ACTION_INCREASE_LIQUIDITY,
        parameters: [increase],
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: targetLiquidity,
        liquidityDelta: delta,
        pairHolding: holding.pair,
        tokenHolding: holding.token,
        pairFlow: pull.pair,
        tokenFlow: pull.token,
        pairFunding: funding.pair,
        tokenFunding: funding.token,
        value,
        erc20Sides,
        amount0Max,
        amount1Max,
      };
    }
    const delta = position.liquidity - targetLiquidity;
    const freed = uniswapV4AmountsForLiquidity(pool.sqrtP, sqrtA, sqrtB, delta);
    const amount0Minimum = retainedFloor(freed.amount0);
    const amount1Minimum = retainedFloor(freed.amount1);
    const decrease = encodeAbiParameters(modifyParams, [
      position.tokenId,
      delta,
      amount0Minimum,
      amount1Minimum,
      "0x",
    ]);
    const returned = byPair(freed);
    const minimum = byPair({ amount0: amount0Minimum, amount1: amount1Minimum });
    return {
      ...base,
      kind: "decrease",
      actions: ACTION_DECREASE_LIQUIDITY,
      parameters: [decrease],
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: targetLiquidity,
      liquidityDelta: delta,
      pairHolding: holding.pair,
      tokenHolding: holding.token,
      pairFlow: -returned.pair,
      tokenFlow: -returned.token,
      pairMinimum: minimum.pair,
      tokenMinimum: minimum.token,
    };
  }

  // A new band: burn and re-mint. The share of each target the old position
  // already covers is shaved 1% for price drift; anything beyond it is new
  // wallet capital and carries the mint's own 1% headroom instead.
  const budget = (wanted: bigint, held: bigint) => {
    const covered = wanted < held ? wanted : held;
    return wanted - covered / 100n;
  };
  const mint = prepareAddLiquidity(
    pool,
    {
      pairAmount: budget(target.pairAmount, position.pairAmount),
      tokenAmount: budget(target.tokenAmount, position.tokenAmount),
    },
    range,
    recipient,
  );
  const holding = byPair(
    uniswapV4AmountsForLiquidity(
      pool.sqrtP,
      uniswapV4SqrtPriceX96AtTick(mint.tickLower),
      uniswapV4SqrtPriceX96AtTick(mint.tickUpper),
      mint.liquidity,
    ),
  );
  // A single-sided mint carries a 1-wei maximum on its empty side; that dust
  // is not wallet funding and must not raise an allowance step.
  const beyondDust = (amount: bigint) => (amount > 1n ? amount : 0n);
  const pairFunding = beyondDust(mint.pairMaximum - position.pairAmount);
  const tokenFunding = beyondDust(mint.tokenMaximum - position.tokenAmount);
  const funding0 = pool.pairIsC0 ? pairFunding : tokenFunding;
  const funding1 = pool.pairIsC0 ? tokenFunding : pairFunding;
  const value = nativeIsC0 ? funding0 : nativeIsC1 ? funding1 : 0n;
  const erc20Sides: Array<{ currency: Address; max: bigint }> = [];
  if (!nativeIsC0 && funding0 > 0n)
    erc20Sides.push({ currency: pool.key.currency0, max: funding0 });
  if (!nativeIsC1 && funding1 > 0n)
    erc20Sides.push({ currency: pool.key.currency1, max: funding1 });
  const pairMinimum = retainedFloor(position.pairAmount);
  const tokenMinimum = retainedFloor(position.tokenAmount);
  const burn = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
    [
      position.tokenId,
      pool.pairIsC0 ? pairMinimum : tokenMinimum,
      pool.pairIsC0 ? tokenMinimum : pairMinimum,
      "0x",
    ],
  );
  // The mint's parameters are already encoded inside the add plan; lift them
  // out rather than re-encoding the tuple here. Its own closes/sweep are
  // dropped: the composed closes settle everything at the end.
  const [, mintParameters] = decodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    mint.unlockData,
  );
  return {
    ...base,
    kind: "move",
    actions: `${ACTION_BURN_POSITION}${ACTION_MINT_POSITION}`,
    parameters: [burn, mintParameters[0]],
    tickLower: mint.tickLower,
    tickUpper: mint.tickUpper,
    liquidity: mint.liquidity,
    liquidityDelta: 0n,
    pairHolding: holding.pair,
    tokenHolding: holding.token,
    pairFlow: holding.pair - position.pairAmount,
    tokenFlow: holding.token - position.tokenAmount,
    pairFunding,
    tokenFunding,
    value,
    erc20Sides,
    pairMinimum,
    tokenMinimum,
    mint,
    amount0Max: mint.amount0Max,
    amount1Max: mint.amount1Max,
  };
}

/**
 * Edit a position in ONE transaction: set what it should hold and, optionally,
 * the band it covers. Target amounts are ceilings — the band and the current
 * price fix the ratio, so the position ends up holding at most the target on
 * each side. Which V4 actions run depends on what changed:
 *
 * - Same band, more liquidity → INCREASE_LIQUIDITY + CLOSE×2 [+ SWEEP]: the
 *   wallet funds the difference (1% price headroom in the maxima); unclaimed
 *   fees offset what it pays.
 * - Same band, less liquidity → DECREASE_LIQUIDITY + TAKE_PAIR: the freed
 *   share and unclaimed fees return to the wallet, behind 95% floors.
 * - New band → BURN_POSITION + MINT_POSITION + CLOSE×2 [+ SWEEP]: the burn's
 *   credit funds the mint inside the unlock; only the difference touches the
 *   wallet, in either direction. The part of each target the old position
 *   already covers is shaved 1% so ~1% of price drift between review and
 *   execution still fits without wallet funding, matching the plain move.
 * - Nothing on either side → the full-exit removal.
 *
 * Every path reverts as a whole if the live price outruns the reviewed
 * maxima/floors, leaving the position untouched.
 */
export function prepareEditLiquidity(
  pool: PoolSnapshot,
  position: UserLpPosition,
  target: { pairAmount: bigint; tokenAmount: bigint },
  /** null keeps the position's own band, exactly; a range re-mints it. */
  range: { minimumPrice: number; maximumPrice: number } | null,
  recipient: Address,
): EditLiquidityPlan {
  const ops = editOperations(pool, position, target, range, recipient);
  let unlockData: Hex;
  if (ops.kind === "decrease" || ops.kind === "remove") {
    const takePair = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [pool.key.currency0, pool.key.currency1, recipient],
    );
    unlockData = encodeUnlock(`${ops.actions}${ACTION_TAKE_PAIR}`, [...ops.parameters, takePair]);
  } else {
    const close = closeActions(pool, recipient, ops.value);
    unlockData = encodeUnlock(`${ops.actions}${close.actions}`, [
      ...ops.parameters,
      ...close.parameters,
    ]);
  }
  return { ...ops, tokenId: position.tokenId, unlockData };
}

/**
 * Abort a reviewed edit when the position changed underneath it or the live
 * price moved beyond the maxima it was sized with. Floors (decrease, move,
 * removal) are enforced by the contract itself.
 */
export async function reverifyEditLiquidity(
  pool: PoolSnapshot,
  plan: EditLiquidityPlan,
  account: Address,
): Promise<void> {
  const fresh = await refreshPoolAndPosition(pool, plan.tokenId, account);
  if (fresh.position.liquidity !== plan.liquidityBefore) {
    throw new Error("This position changed. Review it again before sending.");
  }
  if (plan.kind !== "move" && plan.kind !== "increase") return;
  const required = uniswapV4AmountsForLiquidity(
    fresh.pool.sqrtP,
    uniswapV4SqrtPriceX96AtTick(plan.tickLower),
    uniswapV4SqrtPriceX96AtTick(plan.tickUpper),
    plan.kind === "move" ? plan.liquidity : plan.liquidityDelta,
  );
  if (required.amount0 > plan.amount0Max || required.amount1 > plan.amount1Max) {
    throw new Error("The pool price moved beyond the reviewed range. Review fresh amounts.");
  }
}

// ── Make the market ──────────────────────────────────────────────────────────
//
// A revnet's market lives between the cash-out floor and the issuance ceiling.
// Making it means two single-sided positions: project tokens sold from spot up
// to the ceiling, pair tokens buying from spot down to the floor. Each side has
// its own liquidity, so the two amounts are independent — unlike one position,
// whose single liquidity number couples them.

/** The corridor on the display axis (pair per token). */
export interface MarketCorridor {
  floor: number;
  ceiling: number;
}

export interface MarketLiquidityPlan {
  poolId: Hex;
  unlockData: Hex;
  /** Project tokens placed from spot up to the ceiling; null when spot is at or above it or nothing was given. */
  tokenSide: AddLiquidityPlan | null;
  /** Pair tokens placed from the floor up to spot; null when spot is at or below it or nothing was given. */
  pairSide: AddLiquidityPlan | null;
  value: bigint;
  erc20Sides: Array<{ currency: Address; max: bigint }>;
  recipient: Address;
  tokenMaximum: bigint;
  pairMaximum: bigint;
}

function requireCorridor(pool: PoolSnapshot, corridor: MarketCorridor): number {
  const price = pool.price;
  if (!price || !(price > 0)) throw new Error("The pool has no price yet.");
  if (!(corridor.floor > 0) || !(corridor.ceiling > corridor.floor)) {
    throw new Error("This revnet has no usable floor and ceiling to make a market between.");
  }
  return price;
}

/** The token side's band: spot to the ceiling, or null when spot sits at or above it. */
function tokenSideRange(price: number, corridor: MarketCorridor) {
  return price < corridor.ceiling ? { minimumPrice: price, maximumPrice: corridor.ceiling } : null;
}

/** The pair side's band: the floor to spot, or null when spot sits at or below it. */
function pairSideRange(price: number, corridor: MarketCorridor) {
  return price > corridor.floor ? { minimumPrice: corridor.floor, maximumPrice: price } : null;
}

/**
 * Mint the market in ONE transaction: MINT (token side) + MINT (pair side) +
 * CLOSE×2 [+ SWEEP]. Each side is a standard single-sided add, so the
 * price-side tick nudge keeps spot just outside both bands and the maxima
 * carry the usual 1% headroom. A side whose amount is zero, or whose half of
 * the corridor spot has left, is simply omitted.
 */
export function prepareMarketLiquidity(
  pool: PoolSnapshot,
  amounts: { pairAmount: bigint; tokenAmount: bigint },
  corridor: MarketCorridor,
  recipient: Address,
): MarketLiquidityPlan {
  const price = requireCorridor(pool, corridor);
  const tokenRange = tokenSideRange(price, corridor);
  const pairRange = pairSideRange(price, corridor);
  const tokenSide =
    amounts.tokenAmount > 0n && tokenRange
      ? prepareAddLiquidity(
          pool,
          { pairAmount: 0n, tokenAmount: amounts.tokenAmount },
          tokenRange,
          recipient,
        )
      : null;
  const pairSide =
    amounts.pairAmount > 0n && pairRange
      ? prepareAddLiquidity(
          pool,
          { pairAmount: amounts.pairAmount, tokenAmount: 0n },
          pairRange,
          recipient,
        )
      : null;
  if (!tokenSide && !pairSide) {
    throw new Error(
      amounts.tokenAmount <= 0n && amounts.pairAmount <= 0n
        ? "Enter an amount for at least one side."
        : `Spot is outside the ${amounts.tokenAmount > 0n ? "token" : "pair"} side of the corridor, so that side has nowhere to go.`,
    );
  }
  const sides = [tokenSide, pairSide].filter((side): side is AddLiquidityPlan => side !== null);
  const value = sides.reduce((sum, side) => sum + side.value, 0n);
  const parameters: Hex[] = sides.map((side) => {
    const [, mintParameters] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      side.unlockData,
    );
    return mintParameters[0];
  });
  const close = closeActions(pool, recipient, value);
  return {
    poolId: pool.poolId,
    unlockData: encodeUnlock(`${ACTION_MINT_POSITION.repeat(sides.length)}${close.actions}`, [
      ...parameters,
      ...close.parameters,
    ]),
    tokenSide,
    pairSide,
    value,
    erc20Sides: mergeErc20Sides(sides.map((side) => side.erc20Sides)),
    recipient,
    tokenMaximum: tokenSide?.tokenMaximum ?? 0n,
    pairMaximum: pairSide?.pairMaximum ?? 0n,
  };
}

/** Abort a reviewed market mint when the live price moved beyond either side's maxima. */
export async function reverifyMarketLiquidity(
  pool: PoolSnapshot,
  plan: MarketLiquidityPlan,
): Promise<void> {
  for (const side of [plan.tokenSide, plan.pairSide]) {
    if (side) await reverifyAddLiquidity(pool, side);
  }
}

/** Two adjacent single-sided positions that together make the market, or one position on its own. */
export type PositionGroup =
  | { kind: "market"; tokenSide: UserLpPosition; pairSide: UserLpPosition }
  | { kind: "single"; position: UserLpPosition };

/**
 * Pair up positions whose bands meet: the mint-time spot tick sits between
 * them (its own slot may be skipped, hence a gap of up to one spacing). The
 * side with the higher display prices is the token side. Anything else lists
 * on its own.
 */
export function groupMarketPositions(
  pool: PoolSnapshot,
  positions: readonly UserLpPosition[],
): PositionGroup[] {
  const spacing = Number(pool.key.tickSpacing);
  const sorted = [...positions].sort((a, b) => a.tickLower - b.tickLower);
  const used = new Set<bigint>();
  const groups: PositionGroup[] = [];
  for (const lower of sorted) {
    if (used.has(lower.tokenId)) continue;
    const upper = sorted.find(
      (candidate) =>
        !used.has(candidate.tokenId) &&
        candidate.tokenId !== lower.tokenId &&
        candidate.tickLower >= lower.tickUpper &&
        candidate.tickLower - lower.tickUpper <= spacing,
    );
    if (!upper) {
      used.add(lower.tokenId);
      groups.push({ kind: "single", position: lower });
      continue;
    }
    used.add(lower.tokenId);
    used.add(upper.tokenId);
    const lowerBand = lpBandPrices(pool, lower.tickLower, lower.tickUpper);
    const upperBand = lpBandPrices(pool, upper.tickLower, upper.tickUpper);
    const lowerIsToken = lowerBand.minimumPrice >= upperBand.maximumPrice;
    groups.push({
      kind: "market",
      tokenSide: lowerIsToken ? lower : upper,
      pairSide: lowerIsToken ? upper : lower,
    });
  }
  return groups;
}

/** A market's two sides; either may be missing (never minted, or removed). */
export interface MarketSides {
  tokenSide: UserLpPosition | null;
  pairSide: UserLpPosition | null;
}

type MarketSideEditKind = EditLiquidityKind | "mint" | "keep";

export interface MarketSideEdit {
  kind: MarketSideEditKind;
  tokenId: bigint | null;
  liquidityBefore: bigint;
  /** What this side holds after the edit, in its own currency. */
  holding: bigint;
  /** Wallet flow in this side's currency: positive pulled, negative returned. */
  flow: bigint;
  /** The most the wallet can be asked for on this side. */
  funding: bigint;
  /** The 95% floor on what a burn or decrease returns. */
  minimum: bigint;
  /** For mint / move / increase: the band and maxima the live-price recheck holds it to. */
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  liquidityDelta: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
}

export interface MarketEditPlan {
  unlockData: Hex;
  token: MarketSideEdit | null;
  pair: MarketSideEdit | null;
  value: bigint;
  erc20Sides: Array<{ currency: Address; max: bigint }>;
  tokenFlow: bigint;
  pairFlow: bigint;
  tokenFunding: bigint;
  pairFunding: bigint;
  tokenMinimum: bigint;
  pairMinimum: bigint;
  tokenHolding: bigint;
  pairHolding: bigint;
  /** Whether both sides were re-banded to the corridor given. */
  refit: boolean;
}

function sideEdit(
  kind: MarketSideEditKind,
  tokenId: bigint | null,
  ops: EditOperations,
  own: "token" | "pair",
): MarketSideEdit {
  return {
    kind,
    tokenId,
    liquidityBefore: ops.liquidityBefore,
    holding: own === "token" ? ops.tokenHolding : ops.pairHolding,
    flow: own === "token" ? ops.tokenFlow : ops.pairFlow,
    funding: own === "token" ? ops.tokenFunding : ops.pairFunding,
    minimum: own === "token" ? ops.tokenMinimum : ops.pairMinimum,
    tickLower: ops.tickLower,
    tickUpper: ops.tickUpper,
    liquidity: ops.liquidity,
    liquidityDelta: ops.liquidityDelta,
    amount0Max: ops.amount0Max,
    amount1Max: ops.amount1Max,
  };
}

/** A fresh single-sided mint as operations, so a missing side can join a market edit. */
function mintOperations(mint: AddLiquidityPlan, pool: PoolSnapshot): EditOperations {
  const [, mintParameters] = decodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    mint.unlockData,
  );
  const holding = uniswapV4AmountsForLiquidity(
    pool.sqrtP,
    uniswapV4SqrtPriceX96AtTick(mint.tickLower),
    uniswapV4SqrtPriceX96AtTick(mint.tickUpper),
    mint.liquidity,
  );
  const pairHolding = pool.pairIsC0 ? holding.amount0 : holding.amount1;
  const tokenHolding = pool.pairIsC0 ? holding.amount1 : holding.amount0;
  return {
    kind: "move",
    actions: ACTION_MINT_POSITION,
    parameters: [mintParameters[0]],
    tickLower: mint.tickLower,
    tickUpper: mint.tickUpper,
    liquidityBefore: 0n,
    liquidity: mint.liquidity,
    liquidityDelta: 0n,
    pairHolding,
    tokenHolding,
    pairFlow: pairHolding,
    tokenFlow: tokenHolding,
    pairFunding: mint.pairMaximum > 1n ? mint.pairMaximum : 0n,
    tokenFunding: mint.tokenMaximum > 1n ? mint.tokenMaximum : 0n,
    value: mint.value,
    erc20Sides: mint.erc20Sides,
    pairMinimum: 0n,
    tokenMinimum: 0n,
    mint,
    amount0Max: mint.amount0Max,
    amount1Max: mint.amount1Max,
  };
}

/**
 * Edit a market in ONE transaction. Each side is its own position, so each
 * side's target maps to its own operation — increase or decrease in place,
 * burn when set to zero, mint when the side did not exist — and the whole
 * set settles under one pair of closes. With `refit`, both existing sides are
 * burned and re-minted at the corridor given (the stage moved the floor or
 * ceiling), funded by their own burn credits plus whatever the targets add.
 */
export function prepareMarketEdit(
  pool: PoolSnapshot,
  sides: MarketSides,
  targets: { tokenAmount: bigint; pairAmount: bigint },
  corridor: MarketCorridor,
  refit: boolean,
  recipient: Address,
): MarketEditPlan {
  const price = requireCorridor(pool, corridor);
  const tokenRange = tokenSideRange(price, corridor);
  const pairRange = pairSideRange(price, corridor);

  const plan = (
    own: "token" | "pair",
    position: UserLpPosition | null,
    target: bigint,
    range: { minimumPrice: number; maximumPrice: number } | null,
  ): { edit: MarketSideEdit; ops: EditOperations | null } | null => {
    const amounts =
      own === "token"
        ? { pairAmount: 0n, tokenAmount: target }
        : { pairAmount: target, tokenAmount: 0n };
    if (position) {
      if (target <= 0n) {
        const ops = editOperations(pool, position, amounts, null, recipient);
        return { edit: sideEdit("remove", position.tokenId, ops, own), ops };
      }
      if (refit) {
        if (!range) {
          throw new Error(
            `Spot has left the ${own} side of the corridor, so that side cannot be re-fit; set it to 0 to remove it.`,
          );
        }
        const ops = editOperations(pool, position, amounts, range, recipient);
        return { edit: sideEdit("move", position.tokenId, ops, own), ops };
      }
      try {
        const ops = editOperations(pool, position, amounts, null, recipient);
        return { edit: sideEdit(ops.kind, position.tokenId, ops, own), ops };
      } catch (cause) {
        if (cause instanceof Error && /as it is/.test(cause.message)) {
          const held = own === "token" ? position.tokenAmount : position.pairAmount;
          return {
            edit: {
              kind: "keep",
              tokenId: position.tokenId,
              liquidityBefore: position.liquidity,
              holding: held,
              flow: 0n,
              funding: 0n,
              minimum: 0n,
              tickLower: position.tickLower,
              tickUpper: position.tickUpper,
              liquidity: position.liquidity,
              liquidityDelta: 0n,
              amount0Max: 0n,
              amount1Max: 0n,
            },
            ops: null,
          };
        }
        throw cause;
      }
    }
    if (target <= 0n) return null;
    if (!range) {
      throw new Error(
        `Spot is outside the ${own} side of the corridor, so that side has nowhere to go.`,
      );
    }
    const ops = mintOperations(prepareAddLiquidity(pool, amounts, range, recipient), pool);
    return { edit: sideEdit("mint", null, ops, own), ops };
  };

  const token = plan("token", sides.tokenSide, targets.tokenAmount, tokenRange);
  const pair = plan("pair", sides.pairSide, targets.pairAmount, pairRange);
  const operations = [token?.ops, pair?.ops].filter((ops): ops is EditOperations => !!ops);
  if (!operations.length) throw new Error("This leaves the market as it is.");

  const value = operations.reduce((sum, ops) => sum + ops.value, 0n);
  const close = closeActions(pool, recipient, value);
  const sum = (pick: (ops: EditOperations) => bigint) =>
    operations.reduce((total, ops) => total + pick(ops), 0n);
  const holdingOf = (side: { edit: MarketSideEdit } | null) => side?.edit.holding ?? 0n;
  return {
    unlockData: encodeUnlock(`${operations.map((ops) => ops.actions).join("")}${close.actions}`, [
      ...operations.flatMap((ops) => ops.parameters),
      ...close.parameters,
    ]),
    token: token?.edit ?? null,
    pair: pair?.edit ?? null,
    value,
    erc20Sides: mergeErc20Sides(operations.map((ops) => ops.erc20Sides)),
    tokenFlow: sum((ops) => ops.tokenFlow),
    pairFlow: sum((ops) => ops.pairFlow),
    tokenFunding: sum((ops) => ops.tokenFunding),
    pairFunding: sum((ops) => ops.pairFunding),
    tokenMinimum: sum((ops) => ops.tokenMinimum),
    pairMinimum: sum((ops) => ops.pairMinimum),
    tokenHolding: holdingOf(token),
    pairHolding: holdingOf(pair),
    refit,
  };
}

/**
 * Abort a reviewed market edit when either side's position changed, or the
 * live price moved beyond the maxima a mint or increase was sized with.
 */
export async function reverifyMarketEdit(
  pool: PoolSnapshot,
  plan: MarketEditPlan,
  account: Address,
): Promise<void> {
  let sqrtP = pool.sqrtP;
  for (const side of [plan.token, plan.pair]) {
    if (!side || side.tokenId === null) continue;
    const fresh = await refreshPoolAndPosition(pool, side.tokenId, account);
    sqrtP = fresh.pool.sqrtP;
    if (fresh.position.liquidity !== side.liquidityBefore) {
      throw new Error("A position in this market changed. Review it again before sending.");
    }
  }
  for (const side of [plan.token, plan.pair]) {
    if (!side || (side.kind !== "mint" && side.kind !== "move" && side.kind !== "increase"))
      continue;
    const required = uniswapV4AmountsForLiquidity(
      sqrtP,
      uniswapV4SqrtPriceX96AtTick(side.tickLower),
      uniswapV4SqrtPriceX96AtTick(side.tickUpper),
      side.kind === "increase" ? side.liquidityDelta : side.liquidity,
    );
    if (required.amount0 > side.amount0Max || required.amount1 > side.amount1Max) {
      throw new Error("The pool price moved beyond the reviewed range. Review fresh amounts.");
    }
  }
}

/** A position's band on the card's display axis (pair per token), min < max
 *  regardless of which currency the pool sorts first. */
export function lpBandPrices(
  pool: PoolSnapshot,
  tickLower: number,
  tickUpper: number,
): { minimumPrice: number; maximumPrice: number } {
  const display = (tick: number) => {
    const raw = Math.pow(1.0001, tick);
    return pool.pairIsC0
      ? 10 ** (18 - pool.pair.decimals) / raw
      : raw * 10 ** (18 - pool.pair.decimals);
  };
  const a = display(tickLower);
  const b = display(tickUpper);
  return { minimumPrice: Math.min(a, b), maximumPrice: Math.max(a, b) };
}

export async function permit2AllowanceCovers(
  chainId: JBChainId,
  owner: Address,
  token: Address,
  amount: bigint,
): Promise<boolean> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(chainId)];
  if (!positionManager) return false;
  const [allowed, expiration] = await getViemPublicClient(chainId).readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [owner, token, positionManager],
  });
  return BigInt(allowed) >= amount && Number(expiration) > Math.floor(Date.now() / 1000) + 300;
}

export function permit2ApprovalArgs(
  chainId: JBChainId,
  token: Address,
  amount: bigint,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(chainId)];
  if (!positionManager) throw new Error("LP management is unavailable on this chain.");
  return [token, positionManager, amount, nowSeconds + 30 * 24 * 60 * 60] as const;
}

/** Abort a reviewed mint when the live price moved beyond its 1% maxima. */
export async function reverifyAddLiquidity(
  pool: PoolSnapshot,
  plan: AddLiquidityPlan,
): Promise<void> {
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const slot0 = await client.readContract({
    address: pool.poolManager,
    abi: EXTSLOAD_ABI,
    functionName: "extsload",
    args: [uniswapV4PoolStateSlot(plan.poolId)],
  });
  const sqrtP = uniswapV4SqrtPriceX96FromSlot0(slot0);
  const required = uniswapV4AmountsForLiquidity(
    sqrtP,
    uniswapV4SqrtPriceX96AtTick(plan.tickLower),
    uniswapV4SqrtPriceX96AtTick(plan.tickUpper),
    plan.liquidity,
  );
  if (required.amount0 > plan.amount0Max || required.amount1 > plan.amount1Max) {
    throw new Error("The pool price moved beyond the reviewed range. Review fresh amounts.");
  }
}

// ── AMM card aggregate ────────────────────────────────────────────────────────

export interface AmmChainState {
  chainId: JBChainId;
  hook: Address | null;
  pool: PoolSnapshot | null;
  composition: PoolComposition | null;
  /** The two prices arbitrage keeps the pool between. Null when unreadable. */
  reference: MarketReferencePrices;
}

export interface MarketReferencePrices {
  /** Issuance ceiling, in pair tokens per project token. */
  issuance: number | null;
  /** Cash-out floor, in pair tokens per project token. */
  cashOut: number | null;
}

/**
 * The issuance ceiling on the PAIR-TOKEN axis. The ruleset weight prices tokens
 * against the ruleset's `baseCurrency` (a standard id like ETH=1/USD=2, or a
 * token-keyed id), while the market card's axis is the accounting/pair token —
 * so the base-per-token figure is converted through the same project-scoped
 * JBPrices feed the terminal uses on every payment. Null when there is no
 * usable feed: a missing ceiling is honest, a misdenominated one is not.
 */
async function issuanceCeilingOf(
  client: PublicClient,
  args: {
    chainId: JBChainId;
    projectId: bigint;
    weight: bigint;
    baseCurrency: number;
    pairCurrency: number;
  },
): Promise<number | null> {
  if (args.weight <= 0n) return null;
  const basePerToken = 1 / (Number(args.weight) / 1e18);
  if (args.baseCurrency === args.pairCurrency) return basePerToken;
  const prices = v6Address(JBCoreContracts.JBPrices, args.chainId);
  if (!prices) return null;
  try {
    const price = (await client.readContract({
      address: prices,
      abi: jbPricesAbi,
      functionName: "pricePerUnitOf",
      args: [args.projectId, BigInt(args.pairCurrency), BigInt(args.baseCurrency), 18n],
    })) as bigint;
    const pairPerBase = Number(price) / 1e18;
    if (!(pairPerBase > 0) || !Number.isFinite(pairPerBase)) return null;
    return basePerToken * pairPerBase;
  } catch {
    return null;
  }
}

/**
 * The ceiling and floor the pool trades between, both in pair tokens per
 * project token. Read best-effort: either half degrades to null on its own.
 *
 * The cash-out quote is hook-blind (`currentReclaimableSurplusOf` skips data
 * hooks) and display-only — transactions must quote through the hook-aware
 * path. It is taken in the accounting context's own terms, so no price-feed
 * conversion is involved.
 */
async function readMarketReferencePrices(
  pool: PoolSnapshot,
  projectId: bigint,
  providedClient?: PublicClient,
): Promise<MarketReferencePrices> {
  const client = providedClient ?? (getViemPublicClient(pool.chainId) as PublicClient);

  const [issuance, cashOut] = await Promise.all([
    (async () => {
      const current = await getCurrentRuleset(client, { chainId: pool.chainId, projectId });
      return issuanceCeilingOf(client, {
        chainId: pool.chainId,
        projectId,
        weight: current.ruleset.weight,
        baseCurrency: Number(current.metadata.baseCurrency),
        pairCurrency: pool.pair.currency,
      });
    })().catch(() => null),
    (async () => {
      // Quote the largest whole token unit the supply supports, never a scaled
      // one-token extrapolation: cash-out is nonlinear, and on a few-decimal
      // accounting token a one-token reclaim floors to zero at large supplies.
      const quote = await getCashOutQuote(client, {
        chainId: pool.chainId,
        projectId,
        cashOutCount: 10n ** 18n,
        decimals: BigInt(pool.pair.decimals),
        currency: BigInt(pool.pair.currency),
      });
      const value = Number(formatUnits(quote.reclaimAmount, pool.pair.decimals));
      return Number.isFinite(value) && value > 0 ? value : null;
    })().catch(() => null),
  ]);

  return { issuance, cashOut };
}

const EMPTY_REFERENCE: MarketReferencePrices = { issuance: null, cashOut: null };

export interface SolvedRange {
  minPrice: number;
  maxPrice: number;
  /** Which end of the range stayed pinned to its reference price. */
  anchor: "floor" | "ceiling";
}

/**
 * Turns "I have X project tokens and Y pair tokens" into a concrete price
 * range, so depositors never have to reverse-engineer concentrated-liquidity
 * ratio math. Prices are pair tokens per project token, matching the form.
 *
 * Strategy: pin the floor at the cash-out price (the protocol's natural
 * backstop — below it, cashing out beats selling) and solve the ceiling that
 * consumes exactly the given amounts. When the token side is too heavy for ANY
 * ceiling to absorb, pin the ceiling at the issuance price (above it, paying
 * the project beats buying) and solve the floor instead. A zero on either side
 * degrades to the matching single-sided position, so every non-degenerate
 * input yields a valid range.
 */
export function solveRangeFromAmounts(inputs: {
  price: number;
  tokenAmount: number;
  pairAmount: number;
  floorHint?: number | null;
  ceilingHint?: number | null;
}): SolvedRange | null {
  const { price, tokenAmount, pairAmount } = inputs;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(tokenAmount) || tokenAmount < 0) return null;
  if (!Number.isFinite(pairAmount) || pairAmount < 0) return null;
  if (tokenAmount === 0 && pairAmount === 0) return null;

  const floorHint = inputs.floorHint ?? 0;
  const ceilingHint = inputs.ceilingHint ?? 0;
  const floor = floorHint > 0 && floorHint < price ? floorHint : price / 2;
  const ceiling = ceilingHint > price ? ceilingHint : price * 2;

  const sp = Math.sqrt(price);
  const sa = Math.sqrt(floor);

  if (pairAmount > 0) {
    // Floor pinned: L is fixed by the pair side, the ceiling absorbs the
    // token side. amountTok = L·(1/√p − 1/√pb) caps at L/√p as pb → ∞.
    const liquidity = pairAmount / (sp - sa);
    const inverseCeilingSqrt = 1 / sp - tokenAmount / liquidity;
    if (inverseCeilingSqrt > 0) {
      const maxPrice = tokenAmount === 0 ? price : (1 / inverseCeilingSqrt) ** 2;
      return { minPrice: floor, maxPrice, anchor: "floor" };
    }
  }

  // Token side too heavy for the pinned floor (or no pair at all): pin the
  // ceiling and solve the floor. Always solvable — the solved floor lands
  // strictly between the pinned floor and spot.
  const sb = Math.sqrt(ceiling);
  const liquidity = tokenAmount / (1 / sp - 1 / sb);
  const floorSqrt = sp - pairAmount / liquidity;
  const minPrice = pairAmount === 0 ? price : floorSqrt ** 2;
  return { minPrice, maxPrice: ceiling, anchor: "ceiling" };
}

export interface AmmPresence {
  chainId: JBChainId;
  projectId: bigint;
  hook: Address | null;
  pool: PoolSnapshot | null;
}

/**
 * The cheap "does a market pool exist" probe: one snapshot read per chain,
 * no composition log scan and no reference quotes. Gate affordances (like the
 * Add liquidity button) on this, never on `fetchAmmStates` — the
 * log scan there can take tens of seconds and the button doesn't need it.
 */
export async function fetchAmmPresence(
  chains: ChainProject[],
  readSnapshot: (
    chainId: JBChainId,
    projectId: bigint,
  ) => Promise<{ hook: Address | null; pool: PoolSnapshot | null }> = readPoolSnapshot,
): Promise<AmmPresence[]> {
  return Promise.all(
    chains.map(async ({ chainId, projectId }): Promise<AmmPresence> => {
      try {
        const { hook, pool } = await readSnapshot(chainId, projectId);
        return { chainId, projectId, hook, pool };
      } catch {
        return { chainId, projectId, hook: null, pool: null };
      }
    }),
  );
}

/**
 * Expands presences into the dialog-ready `AmmChainState` shape by adding
 * reference prices (cash-out floor + issuance ceiling). Composition stays
 * null: the add/manage dialog never reads it, so the log scan is never paid.
 */
export async function fetchAmmReferences(
  presence: AmmPresence[],
  readReference: (
    pool: PoolSnapshot,
    projectId: bigint,
  ) => Promise<MarketReferencePrices> = readMarketReferencePrices,
): Promise<AmmChainState[]> {
  return Promise.all(
    presence.map(async ({ chainId, projectId, hook, pool }): Promise<AmmChainState> => {
      const reference = pool
        ? await readReference(pool, projectId).catch(() => EMPTY_REFERENCE)
        : EMPTY_REFERENCE;
      return { chainId, hook, pool, composition: null, reference };
    }),
  );
}

/**
 * Snapshot + reference prices per chain. Composition is deliberately left
 * null: the pool-history log scan is paid only by the Liquidity card, through
 * its own `fetchPoolComposition` query, so the chart and Pool card never wait
 * on it.
 */
export async function fetchAmmStates(chains: ChainProject[]): Promise<AmmChainState[]> {
  return fetchAmmReferences(await fetchAmmPresence(chains));
}

// ── LP split hook (JBP6FeeLPSplitHook / JBUniswapV4LPSplitHook) ───────────────

/**
 * Generated from the deployment artifacts, so the shape tracks the deployed
 * bytecode instead of a hand-copied fragment. `JBP6FeeLPSplitHook` shares this
 * surface; only the fee-project wiring differs.
 */
export const lpSplitHookAbi = jbUniswapV4LpSplitHookAbi;

/** Reserved-token split group id (JBSplitGroupIds.RESERVED_TOKENS). */
const RESERVED_SPLIT_GROUP = 1n;

export interface SplitHookChainState {
  chainId: JBChainId;
  projectId: bigint;
  hook: Address;
  /** The project's terminal/pair token in accounting form (NATIVE sentinel kept). */
  terminalToken: Address;
  pairSymbol: string;
  pairDecimals: number;
  accumulated: bigint;
  hasPool: boolean;
  claimableFees: bigint;
  tokenId: bigint;
  tickLower: number | null;
  tickUpper: number | null;
  /**
   * True while deployPool still needs the operator (SET_BUYBACK_POOL): it only
   * becomes permissionless once the issuance rate decays to ≤10% of what it was
   * when tokens started accumulating.
   */
  deployGated: boolean;
}

/**
 * Detects an LP split hook by behavior, not by a hardcoded address: any reserved
 * split whose hook answers both `accumulatedProjectTokens` and `hasDeployedPool`
 * is treated as the LP split hook (the canonical deployment is not in the SDK's
 * address book). Returns one state per chain where a hook is found.
 */
export async function fetchSplitHookStates(chains: ChainProject[]): Promise<SplitHookChainState[]> {
  const states = await Promise.all(
    chains.map(async ({ chainId, projectId }): Promise<SplitHookChainState | null> => {
      try {
        const client = getViemPublicClient(chainId) as PublicClient;
        const info = await projectDataHook(client, chainId, projectId);
        if (!info) return null;
        const splitsAddr = jbContractAddress[6][JBCoreContracts.JBSplits][chainId] as Address;
        const splits = await client.readContract({
          address: splitsAddr,
          abi: jbSplitsAbi,
          functionName: "splitsOf",
          args: [projectId, info.rulesetId, RESERVED_SPLIT_GROUP],
        });
        const candidates = [
          ...new Set(
            splits
              .map((s) => s.hook)
              .filter((h): h is Address => !!h && h !== zeroAddress)
              .map((h) => h.toLowerCase() as Address),
          ),
        ];
        let hook: Address | null = null;
        for (const candidate of candidates) {
          try {
            await Promise.all([
              client.readContract({
                address: candidate,
                abi: lpSplitHookAbi,
                functionName: "accumulatedProjectTokens",
                args: [projectId],
              }),
              client.readContract({
                address: candidate,
                abi: lpSplitHookAbi,
                functionName: "hasDeployedPool",
                args: [projectId],
              }),
            ]);
            hook = candidate;
            break;
          } catch {
            // Not the LP split hook — a 721 hook or custom split hook lands here.
          }
        }
        if (!hook) return null;

        const contexts = await getAccountingContexts(client, { chainId, projectId });
        const primary = contexts[0];
        if (!primary) return null;
        const native =
          primary.token.toLowerCase() === NATIVE_TOKEN.toLowerCase() ||
          primary.token === zeroAddress;
        const pairSymbol = native
          ? "ETH"
          : await client
              .readContract({ address: primary.token, abi: erc20Abi, functionName: "symbol" })
              .catch(() => "tokens");

        const rd = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
        const [accumulated, hasPool, fees, initialWeight, tokenId, tickLower, tickUpper] =
          await Promise.all([
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "accumulatedProjectTokens",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "hasDeployedPool",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "claimableFeeTokens",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "initialWeightOf",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "tokenIdOf",
                args: [projectId, primary.token],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "activeTickLowerOf",
                args: [projectId, primary.token],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "activeTickUpperOf",
                args: [projectId, primary.token],
              }),
            ),
          ]);

        const iw = initialWeight ?? 0n;
        return {
          chainId,
          projectId,
          hook,
          terminalToken: primary.token,
          pairSymbol,
          pairDecimals: primary.decimals,
          accumulated: accumulated ?? 0n,
          hasPool: !!hasPool,
          claimableFees: fees ?? 0n,
          tokenId: tokenId ?? 0n,
          tickLower: tickLower ?? null,
          tickUpper: tickUpper ?? null,
          deployGated: iw === 0n || info.weight * 10n > iw,
        };
      } catch {
        return null;
      }
    }),
  );
  return states.filter((s): s is SplitHookChainState => s !== null);
}

/** `deployPool(uint256)` — the next hook generation, which drops `minCashOutReturn`. */
export const deployPoolSingleArgAbi = [
  {
    type: "function",
    name: "deployPool",
    stateMutability: "nonpayable",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [],
  },
] as const;

/**
 * Which `deployPool` the hook at `hookAddress` actually exposes.
 *
 * Two generations exist during the lp-split-hook rollout: `deployPool(uint256,uint256)` (what
 * is deployed, and what the SDK's artifact-generated ABI carries) and `deployPool(uint256)`
 * (univ4-lp-split-hook-v6 HEAD, deployed nowhere yet). Different arity means a DIFFERENT
 * SELECTOR, so calling the wrong one reverts at simulate with nothing to explain why.
 *
 * Solidity emits every external selector as a PUSH4 immediate in the dispatch table, so the
 * deployed bytecode answers this directly — one cached read, no revert-classification
 * guesswork and no simulating a write twice. Falls back to the two-argument form (what is
 * deployed today) when the code cannot be read.
 */
const deployPoolArityCache = new Map<string, 1 | 2>();

export async function deployPoolArity(
  client: { getCode: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined> },
  hookAddress: `0x${string}`,
): Promise<1 | 2> {
  const key = hookAddress.toLowerCase();
  const cached = deployPoolArityCache.get(key);
  if (cached) return cached;
  let arity: 1 | 2 = 2;
  try {
    const code = await client.getCode({ address: hookAddress });
    if (code && code !== "0x") {
      const body = code.toLowerCase();
      const singleArg = toFunctionSelector("deployPool(uint256)").slice(2);
      const twoArg = toFunctionSelector("deployPool(uint256,uint256)").slice(2);
      const hasSingle = body.includes(singleArg);
      const hasTwo = body.includes(twoArg);
      // Only decide when exactly one is present; ambiguity keeps the deployed default.
      if (hasSingle && !hasTwo) arity = 1;
      else if (hasTwo && !hasSingle) arity = 2;
    }
  } catch {
    // Unreadable code — keep the currently deployed signature.
  }
  deployPoolArityCache.set(key, arity);
  return arity;
}
