import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  isAddressEqual,
  keccak256,
  parseAbi,
  parseEther,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";

// Adapted from Markee streaming.ts at bbf678d17323d7f82fc31d0174635422de389988.
export const MARKEE_CHAIN_ID = 8453;
export const MARKEE_FACTORY = "0x37f420fdE5c98e611EB7cb9b74ef579D84697039" as Address;
export const MARKEE_ADMIN = "0x823b92d6a4b2AED4b15675c7917c9f922ea8ADAD" as Address;
export const MARKEE_BENEFICIARY = "0x6b92c73682f0e1fac35A18ab17efa5e77DDE9fE1" as Address;
export const STREAMING_BASE = {
  host: "0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74",
  ethx: "0x46fd5cfB4c12D87acD3a13e92BAa53240C661D93",
  cfaForwarder: "0xcfA132E353cB4E398080B9700609bb008eceB125",
} as const;
export const SECONDS_IN_MONTH = 2628000n;
export const BUFFER_PERIOD = 14400n;
const OP_CALL_AGREEMENT = 201;
const OP_SIMPLE_FORWARD_CALL = 301;
const CFA_AGREEMENT_ID = keccak256(
  toBytes("org.superfluid-finance.agreements.ConstantFlowAgreement.v1"),
);
const GDA_AGREEMENT_ID = keccak256(
  toBytes("org.superfluid-finance.agreements.GeneralDistributionAgreement.v1"),
);
const MAX_INT96 = (1n << 95n) - 1n;
function assertRate(rate: bigint) {
  if (rate <= 0n || rate > MAX_INT96) throw new Error("Stream rate must fit a positive int96.");
}
export function monthlyToRatePerSec(weiPerMonth: bigint, minimumMonthlyRate?: bigint): bigint {
  if (
    weiPerMonth <= 0n ||
    (minimumMonthlyRate !== undefined &&
      (minimumMonthlyRate < 0n || weiPerMonth < minimumMonthlyRate))
  )
    throw new Error("Monthly rate is below the board minimum.");
  const floor = weiPerMonth / SECONDS_IN_MONTH;
  const rate =
    minimumMonthlyRate !== undefined && floor * SECONDS_IN_MONTH >= minimumMonthlyRate
      ? floor
      : (weiPerMonth + SECONDS_IN_MONTH - 1n) / SECONDS_IN_MONTH;
  assertRate(rate);
  return rate;
}
export function bufferFor(rate: bigint): bigint {
  assertRate(rate);
  return rate * BUFFER_PERIOD;
}
export function validateMarkeeText(value: string, maxBytes: bigint, label = "Message"): void {
  if (maxBytes < 0n || !value.isWellFormed()) throw new Error(`${label} contains invalid Unicode.`);
  if (BigInt(new TextEncoder().encode(value).length) > maxBytes)
    throw new Error(`${label} exceeds the board's byte limit.`);
}
export function getRequiredWrap(
  ethxBalance: bigint,
  rate: bigint,
  deposit: bigint,
  prefund: bigint,
) {
  if (ethxBalance < 0n || deposit < 0n || prefund < 0n)
    throw new Error("Balances must be nonnegative.");
  const buffer = bufferFor(rate);
  const depositTopUp = buffer > deposit ? buffer - deposit : 0n;
  // Wallet CFA buffer is separate from the board's deposit, with at least 1 wei spare.
  const required = depositTopUp + buffer + prefund + 1n;
  return { buffer, depositTopUp, wrapValue: required > ethxBalance ? required - ethxBalance : 0n };
}

const ETHX_BATCH_ABI = parseAbi(["function upgradeByETHTo(address to) payable"]);
const DEPOSIT_BUFFER_ABI = parseAbi(["function depositBuffer(address backer,uint256 amount)"]);
const CFA_CREATE_FLOW_ABI = parseAbi([
  "function createFlow(address token,address receiver,int96 flowRate,bytes ctx) returns (bytes)",
]);
const CFA_UPDATE_FLOW_ABI = parseAbi([
  "function updateFlow(address token,address receiver,int96 flowRate,bytes ctx) returns (bytes)",
]);
const CFA_DELETE_FLOW_ABI = parseAbi([
  "function deleteFlow(address token,address sender,address receiver,bytes ctx) returns (bytes)",
]);
const GDA_CONNECT_POOL_ABI = parseAbi([
  "function connectPool(address pool,bytes ctx) returns (bytes)",
]);

export interface Operation {
  operationType: number;
  target: Address;
  data: Hex;
}

export interface OpenStreamParams {
  ethx: Address;
  board: Address;
  markee: Address;
  backer: Address;
  ratePerSec: bigint;
  buffer: bigint;
  cfaAgreement: Address;
  gdaAgreement: Address;
  pool: Address;
  // Native ETH wrapped in this batch (0 when the wallet's existing ETHx balance already covers the
  // stream -- upgradeByETH reverts on a 0 amount, so the wrap op must be omitted entirely then, not
  // just sent with 0 value).
  wrapValue: bigint;
}

// Returns the ops for host.batchCall, in the order the strategy requires: the value-bearing wrap
// first when there is one (it drains the host balance so the later value-0 forwards don't revert),
// then the buffer deposit credited to the explicit backer (pulled via the backer's prior ERC20
// approve), then the markee-tagged createFlow (op 201 preserves the backer as the flow sender), then
// connectPool on the markee's GDA refund pool. The connect is mandatory, not cosmetic: a disconnected
// backer's wallet drains at the full stream rate while the refund accrues unclaimed in the pool, so
// they could be liquidated even while being refunded. It must be op 201 straight to the GDA class (a
// 301 via GDAv1Forwarder would connect SimpleForwarder instead), and it no-ops if already connected.
export function buildOpenStreamOps(p: OpenStreamParams): Operation[] {
  assertRate(p.ratePerSec);
  if (p.buffer < bufferFor(p.ratePerSec))
    throw new Error("Board buffer does not cover the stream rate.");
  if (p.wrapValue < 0n) throw new Error("Wrap amount must be nonnegative.");
  const ops: Operation[] = [];

  if (p.wrapValue > 0n) {
    ops.push({
      operationType: OP_SIMPLE_FORWARD_CALL,
      target: p.ethx,
      data: encodeFunctionData({
        abi: ETHX_BATCH_ABI,
        functionName: "upgradeByETHTo",
        args: [p.backer],
      }),
    });
  }

  ops.push({
    operationType: OP_SIMPLE_FORWARD_CALL,
    target: p.board,
    data: encodeFunctionData({
      abi: DEPOSIT_BUFFER_ABI,
      functionName: "depositBuffer",
      args: [p.backer, p.buffer],
    }),
  });

  const callData = encodeFunctionData({
    abi: CFA_CREATE_FLOW_ABI,
    functionName: "createFlow",
    args: [p.ethx, p.board, p.ratePerSec, "0x"],
  });
  const userData = encodeAbiParameters([{ type: "address" }], [p.markee]);

  ops.push({
    operationType: OP_CALL_AGREEMENT,
    target: p.cfaAgreement,
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [callData, userData]),
  });

  const connectData = encodeFunctionData({
    abi: GDA_CONNECT_POOL_ABI,
    functionName: "connectPool",
    args: [p.pool, "0x"],
  });

  ops.push({
    operationType: OP_CALL_AGREEMENT,
    target: p.gdaAgreement,
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [connectData, "0x"]),
  });

  return ops;
}

export interface MoveStreamOpsParams extends OpenStreamParams {
  // Extra deposit the board must hold for the new rate (0 when the existing deposit already covers it).
  depositTopUp: bigint;
}

// Retargets an existing stream to a different markee on the same board: deleteFlow + createFlow in
// one batch. updateFlow CANNOT retarget — the board's onFlowUpdated ignores userData and applies the
// rate to backerMarkee[sender] (the old markee); only onFlowCreated decodes userData. The delete
// clears backerMarkee and the old markee's units, then the create re-tags the flow to the new markee.
// backerDeposit survives the delete, so only the top-up over the held deposit is pulled.
export function buildMoveStreamOps(p: MoveStreamOpsParams): Operation[] {
  assertRate(p.ratePerSec);
  if (p.depositTopUp < 0n) throw new Error("Deposit top-up must be nonnegative.");
  if (p.wrapValue < 0n) throw new Error("Wrap amount must be nonnegative.");
  const ops: Operation[] = [];

  if (p.wrapValue > 0n) {
    ops.push({
      operationType: OP_SIMPLE_FORWARD_CALL,
      target: p.ethx,
      data: encodeFunctionData({
        abi: ETHX_BATCH_ABI,
        functionName: "upgradeByETHTo",
        args: [p.backer],
      }),
    });
  }

  if (p.depositTopUp > 0n) {
    ops.push({
      operationType: OP_SIMPLE_FORWARD_CALL,
      target: p.board,
      data: encodeFunctionData({
        abi: DEPOSIT_BUFFER_ABI,
        functionName: "depositBuffer",
        args: [p.backer, p.depositTopUp],
      }),
    });
  }

  const deleteCallData = encodeFunctionData({
    abi: CFA_DELETE_FLOW_ABI,
    functionName: "deleteFlow",
    args: [p.ethx, p.backer, p.board, "0x"],
  });
  ops.push({
    operationType: OP_CALL_AGREEMENT,
    target: p.cfaAgreement,
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [deleteCallData, "0x"]),
  });

  const createCallData = encodeFunctionData({
    abi: CFA_CREATE_FLOW_ABI,
    functionName: "createFlow",
    args: [p.ethx, p.board, p.ratePerSec, "0x"],
  });
  const userData = encodeAbiParameters([{ type: "address" }], [p.markee]);
  ops.push({
    operationType: OP_CALL_AGREEMENT,
    target: p.cfaAgreement,
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [createCallData, userData]),
  });

  const connectData = encodeFunctionData({
    abi: GDA_CONNECT_POOL_ABI,
    functionName: "connectPool",
    args: [p.pool, "0x"],
  });
  ops.push({
    operationType: OP_CALL_AGREEMENT,
    target: p.gdaAgreement,
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [connectData, "0x"]),
  });

  return ops;
}

export interface UpdateStreamParams {
  ethx: Address;
  board: Address;
  backer: Address;
  ratePerSec: bigint;
  // Extra buffer the board must hold for the new rate (0 when the existing deposit already covers it).
  depositTopUp: bigint;
  // Native ETH wrapped in the same batch: the deposit top-up plus any added runway.
  wrapValue: bigint;
  cfaAgreement: Address;
}

// Rate change on a live stream. onFlowUpdated takes the Markee from backerMarkee[sender], so unlike
// the open batch this one carries no userData, and the pool connect is already in place. The board
// rejects the update unless backerDeposit covers newRate * BUFFER_PERIOD, so the deposit top-up has
// to land in the same batch, before the flow op.
export function buildUpdateStreamOps(p: UpdateStreamParams): Operation[] {
  assertRate(p.ratePerSec);
  if (p.depositTopUp < 0n) throw new Error("Deposit top-up must be nonnegative.");
  if (p.wrapValue < 0n) throw new Error("Wrap amount must be nonnegative.");
  const ops: Operation[] = [];

  if (p.wrapValue > 0n) {
    ops.push({
      operationType: OP_SIMPLE_FORWARD_CALL,
      target: p.ethx,
      data: encodeFunctionData({
        abi: ETHX_BATCH_ABI,
        functionName: "upgradeByETHTo",
        args: [p.backer],
      }),
    });
  }

  if (p.depositTopUp > 0n) {
    ops.push({
      operationType: OP_SIMPLE_FORWARD_CALL,
      target: p.board,
      data: encodeFunctionData({
        abi: DEPOSIT_BUFFER_ABI,
        functionName: "depositBuffer",
        args: [p.backer, p.depositTopUp],
      }),
    });
  }

  const callData = encodeFunctionData({
    abi: CFA_UPDATE_FLOW_ABI,
    functionName: "updateFlow",
    args: [p.ethx, p.board, p.ratePerSec, "0x"],
  });

  ops.push({
    operationType: OP_CALL_AGREEMENT,
    target: p.cfaAgreement,
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [callData, "0x"]),
  });

  return ops;
}

export const boardAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function factory() view returns (address)",
  "function HOST() view returns (address)",
  "function admin() view returns (address)",
  "function beneficiaryAddress() view returns (address)",
  "function ETHX() view returns (address)",
  "function leaderboardName() view returns (string)",
  "function markeeImplementation() view returns (address)",
  "function minimumMonthlyRate() view returns (uint256)",
  "function maxMessageLength() view returns (uint256)",
  "function maxNameLength() view returns (uint256)",
  "function topMarkee() view returns (address)",
  "function topRate() view returns (uint256)",
  "function effectiveRate(address) view returns (uint256)",
  "function percentToBeneficiary() view returns (uint256)",
  "function backerMarkee(address) view returns (address)",
  "function backerDeposit(address) view returns (uint256)",
  "function poolOf(address) view returns (address)",
  "function isMarkeeOnLeaderboard(address) view returns (bool)",
  "function createMarkee(string message,string name) returns (address)",
  "function updateMessage(address markee,string message)",
  "function withdrawDeposit()",
  "function depositBuffer(address backer,uint256 amount)",
  "event MarkeeCreated(address indexed markeeAddress,address indexed owner,string message,string name)",
]);
export const factoryAbi = parseAbi([
  "function createLeaderboard(address beneficiary,string name,string platformName,string platformId) returns (address,address)",
  "function isFactoryLeaderboard(address) view returns (bool)",
  "function boardPlatform(address) view returns (string,string)",
  "function HOST() view returns (address)",
  "function ETHX() view returns (address)",
  "function leaderboardImplementation() view returns (address)",
  "function markeeImplementation() view returns (address)",
  "function defaultMinimumMonthlyRate() view returns (uint256)",
  "function defaultMaxMessageLength() view returns (uint256)",
  "function defaultMaxNameLength() view returns (uint256)",
  "function percentToBeneficiary() view returns (uint256)",
  "function percentToPlatformFeeReceiver() view returns (uint256)",
  "function revNetEnabled() view returns (bool)",
  "function platformFeeReceiver() view returns (address)",
  "function revNetProjectId() view returns (uint256)",
  "function revNetTerminal() view returns (address)",
  "event LeaderboardCreated(address indexed leaderboardAddress,address indexed admin,address indexed beneficiaryAddress,string name,address seedMarkeeAddress)",
]);
const markeeAbi = parseAbi([
  "function message() view returns (string)",
  "function name() view returns (string)",
  "function owner() view returns (address)",
  "function pricingStrategy() view returns (address)",
]);
export const hostAbi = parseAbi([
  "function batchCall((uint32 operationType,address target,bytes data)[] operations) payable",
  "function getAgreementClass(bytes32) view returns (address)",
  "function isApp(address) view returns (bool)",
  "function isAppJailed(address) view returns (bool)",
]);
export const ethxAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function upgradeByETH() payable",
  "function downgradeToETH(uint256)",
]);
const cfaForwarderAbi = parseAbi([
  "function getFlowrate(address token,address sender,address receiver) view returns (int96)",
  "function setFlowrate(address token,address receiver,int96 flowrate) returns (bool)",
]);
export interface BoardState {
  factoryConfig: Awaited<ReturnType<typeof readMarkeeFactory>>;
  address: Address;
  topMarkee: Address;
  message: string;
  name: string;
  owner: Address;
  minimumMonthlyRate: bigint;
  maxMessageLength: bigint;
  maxNameLength: bigint;
  effectiveTopRate: bigint;
  topRate: bigint;
  beneficiaryBps: bigint;
  markeeImplementation: Address;
}
function cloneRuntime(implementation: Address): string {
  return `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
}
function requireAddress(actual: Address, expected: Address, label: string) {
  if (!isAddressEqual(actual, expected))
    throw new Error(`Markee ${label} does not match the reviewed configuration.`);
}
export async function readMarkeeFactory(client: PublicClient) {
  if ((await client.getChainId()) !== MARKEE_CHAIN_ID) throw new Error("Markee requires Base.");
  const read = <N extends Extract<(typeof factoryAbi)[number], { type: "function" }>["name"]>(
    functionName: N,
  ) =>
    client.readContract({ address: MARKEE_FACTORY, abi: factoryAbi, functionName } as Parameters<
      typeof client.readContract
    >[0]);
  const [
    host,
    ethx,
    implementation,
    markeeImplementation,
    minimumMonthlyRate,
    maxMessageLength,
    maxNameLength,
    beneficiaryBps,
    platformFeeBps,
    revNetEnabled,
    platformFeeReceiver,
    revNetProjectId,
    revNetTerminal,
  ] = await Promise.all([
    read("HOST"),
    read("ETHX"),
    read("leaderboardImplementation"),
    read("markeeImplementation"),
    read("defaultMinimumMonthlyRate"),
    read("defaultMaxMessageLength"),
    read("defaultMaxNameLength"),
    read("percentToBeneficiary"),
    read("percentToPlatformFeeReceiver"),
    read("revNetEnabled"),
    read("platformFeeReceiver"),
    read("revNetProjectId"),
    read("revNetTerminal"),
  ]);
  requireAddress(host as Address, STREAMING_BASE.host, "host");
  requireAddress(ethx as Address, STREAMING_BASE.ethx, "token");
  const version = await client.readContract({
    address: implementation as Address,
    abi: boardAbi,
    functionName: "VERSION",
  });
  if (version !== "streaming-1.0.0") throw new Error("Unsupported Markee implementation version.");
  if ((beneficiaryBps as bigint) > 10000n || (platformFeeBps as bigint) > 10000n)
    throw new Error("Markee payout configuration requires review.");

  return {
    implementation: implementation as Address,
    markeeImplementation: markeeImplementation as Address,
    minimumMonthlyRate: minimumMonthlyRate as bigint,
    maxMessageLength: maxMessageLength as bigint,
    maxNameLength: maxNameLength as bigint,
    beneficiaryBps: beneficiaryBps as bigint,
    platformFeeBps: platformFeeBps as bigint,
    revNetEnabled: revNetEnabled as boolean,
    platformFeeReceiver: platformFeeReceiver as Address,
    revNetProjectId: revNetProjectId as bigint,
    revNetTerminal: revNetTerminal as Address,
  };
}
/** Where this browser keeps the board it last set up or used. */
export const MARKEE_BOARD_KEY = "revnet:markee-rent:board:v1";

/** The board this browser saved, if any; a saved value that isn't an address is refused. */
export function savedMarkeeBoard(): Address | undefined {
  const saved = window.localStorage.getItem(MARKEE_BOARD_KEY);
  if (!saved) return undefined;
  if (!isAddress(saved)) throw new Error("The saved Markee board address is invalid.");
  return saved;
}

export async function readMarkeeBoard(client: PublicClient, address: Address): Promise<BoardState> {
  const config = await readMarkeeFactory(client);
  const registered = await client.readContract({
    address: MARKEE_FACTORY,
    abi: factoryAbi,
    functionName: "isFactoryLeaderboard",
    args: [address],
  });
  if (!registered) throw new Error("Board is not registered with the Markee factory.");
  const [
    factory,
    admin,
    beneficiary,
    ethx,
    version,
    boardName,
    markeeImplementation,
    minimumMonthlyRate,
    maxMessageLength,
    maxNameLength,
    topMarkee,
    topRate,
    beneficiaryBps,
    platform,
    isApp,
    jailed,
    code,
  ] = await Promise.all([
    client.readContract({ address, abi: boardAbi, functionName: "factory" }),
    client.readContract({ address, abi: boardAbi, functionName: "admin" }),
    client.readContract({ address, abi: boardAbi, functionName: "beneficiaryAddress" }),
    client.readContract({ address, abi: boardAbi, functionName: "ETHX" }),
    client.readContract({ address, abi: boardAbi, functionName: "VERSION" }),
    client.readContract({ address, abi: boardAbi, functionName: "leaderboardName" }),
    client.readContract({ address, abi: boardAbi, functionName: "markeeImplementation" }),
    client.readContract({ address, abi: boardAbi, functionName: "minimumMonthlyRate" }),
    client.readContract({ address, abi: boardAbi, functionName: "maxMessageLength" }),
    client.readContract({ address, abi: boardAbi, functionName: "maxNameLength" }),
    client.readContract({ address, abi: boardAbi, functionName: "topMarkee" }),
    client.readContract({ address, abi: boardAbi, functionName: "topRate" }),
    client.readContract({ address, abi: boardAbi, functionName: "percentToBeneficiary" }),
    client.readContract({
      address: MARKEE_FACTORY,
      abi: factoryAbi,
      functionName: "boardPlatform",
      args: [address],
    }),
    client.readContract({
      address: STREAMING_BASE.host,
      abi: hostAbi,
      functionName: "isApp",
      args: [address],
    }),
    client.readContract({
      address: STREAMING_BASE.host,
      abi: hostAbi,
      functionName: "isAppJailed",
      args: [address],
    }),
    client.getCode({ address }),
  ]);
  requireAddress(factory, MARKEE_FACTORY, "factory");
  requireAddress(admin, MARKEE_ADMIN, "admin");
  requireAddress(beneficiary, MARKEE_BENEFICIARY, "beneficiary");
  requireAddress(ethx, STREAMING_BASE.ethx, "token");
  requireAddress(markeeImplementation, config.markeeImplementation, "message implementation");
  const expectedCode = cloneRuntime(config.implementation);
  if (
    code?.toLowerCase() !== expectedCode ||
    version !== "streaming-1.0.0" ||
    boardName !== "revnet.money" ||
    platform[0] !== "website" ||
    platform[1] !== "revnet.money" ||
    !isApp ||
    jailed
  )
    throw new Error("Markee board configuration is unsupported or inactive.");
  let message = "",
    name = "",
    owner: Address = zeroAddress,
    effectiveTopRate = 0n;
  if (!isAddressEqual(topMarkee, zeroAddress)) {
    const [advertisement, rate] = await Promise.all([
      readMarkeeMessage(client, { address }, topMarkee),
      client.readContract({
        address,
        abi: boardAbi,
        functionName: "effectiveRate",
        args: [topMarkee],
      }),
    ]);
    ({ message, name, owner } = advertisement);
    effectiveTopRate = rate;
  }
  return {
    factoryConfig: config,
    address,
    topMarkee,
    message,
    name,
    owner,
    minimumMonthlyRate,
    maxMessageLength,
    maxNameLength,
    effectiveTopRate,
    topRate,
    beneficiaryBps,
    markeeImplementation,
  };
}
/** Canonical advertisement identity, including the strategy that owns future stream writes. */
export async function readMarkeeMessage(
  client: PublicClient,
  board: Pick<BoardState, "address">,
  address: Address,
): Promise<{ owner: Address; message: string; name: string }> {
  const [registered, strategy, owner, message, name] = await Promise.all([
    client.readContract({
      address: board.address,
      abi: boardAbi,
      functionName: "isMarkeeOnLeaderboard",
      args: [address],
    }),
    client.readContract({ address, abi: markeeAbi, functionName: "pricingStrategy" }),
    client.readContract({ address, abi: markeeAbi, functionName: "owner" }),
    client.readContract({ address, abi: markeeAbi, functionName: "message" }),
    client.readContract({ address, abi: markeeAbi, functionName: "name" }),
  ]);
  if (!registered || isAddressEqual(address, zeroAddress))
    throw new Error("Advertisement is not registered on this board.");
  requireAddress(strategy, board.address, "advertisement strategy");
  return { owner, message, name };
}

/** Exiting a previously supported board must remain possible after mutable settings drift. */
export async function readMarkeeExitBoard(
  client: PublicClient,
  address: Address,
): Promise<Pick<BoardState, "address">> {
  if ((await client.getChainId()) !== MARKEE_CHAIN_ID) throw new Error("Markee requires Base.");
  const [registered, factory, host, ethx, version, code] = await Promise.all([
    client.readContract({
      address: MARKEE_FACTORY,
      abi: factoryAbi,
      functionName: "isFactoryLeaderboard",
      args: [address],
    }),
    client.readContract({ address, abi: boardAbi, functionName: "factory" }),
    client.readContract({ address, abi: boardAbi, functionName: "HOST" }),
    client.readContract({ address, abi: boardAbi, functionName: "ETHX" }),
    client.readContract({ address, abi: boardAbi, functionName: "VERSION" }),
    client.getCode({ address }),
  ]);
  requireAddress(factory, MARKEE_FACTORY, "factory");
  requireAddress(host, STREAMING_BASE.host, "host");
  requireAddress(ethx, STREAMING_BASE.ethx, "token");
  // Original verified implementation is immutable inside each EIP-1167 board clone.
  const implementation = "0xd2038c21efCf5245547a66f85229Cd654C7664B7";
  const expectedCode = cloneRuntime(implementation);
  if (!registered || version !== "streaming-1.0.0" || code?.toLowerCase() !== expectedCode)
    throw new Error("Board does not have supported Markee exit provenance.");
  return { address };
}

export interface WalletState {
  ethBalance: bigint;
  ethxBalance: bigint;
  allowance: bigint;
  flowRate: bigint;
  backerMarkee: Address;
  deposit: bigint;
  cfaAgreement: Address;
  gdaAgreement: Address;
  pool: Address;
}
export async function readMarkeeWallet(
  client: PublicClient,
  board: Pick<BoardState, "address">,
  account: Address,
): Promise<WalletState> {
  const [
    ethBalance,
    ethxBalance,
    allowance,
    flowRate,
    backerMarkee,
    deposit,
    cfaAgreement,
    gdaAgreement,
  ] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({
      address: STREAMING_BASE.ethx,
      abi: ethxAbi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: STREAMING_BASE.ethx,
      abi: ethxAbi,
      functionName: "allowance",
      args: [account, board.address],
    }),
    client.readContract({
      address: STREAMING_BASE.cfaForwarder,
      abi: cfaForwarderAbi,
      functionName: "getFlowrate",
      args: [STREAMING_BASE.ethx, account, board.address],
    }),
    client.readContract({
      address: board.address,
      abi: boardAbi,
      functionName: "backerMarkee",
      args: [account],
    }),
    client.readContract({
      address: board.address,
      abi: boardAbi,
      functionName: "backerDeposit",
      args: [account],
    }),
    client.readContract({
      address: STREAMING_BASE.host,
      abi: hostAbi,
      functionName: "getAgreementClass",
      args: [CFA_AGREEMENT_ID],
    }),
    client.readContract({
      address: STREAMING_BASE.host,
      abi: hostAbi,
      functionName: "getAgreementClass",
      args: [GDA_AGREEMENT_ID],
    }),
  ]);
  const pool = isAddressEqual(backerMarkee, zeroAddress)
    ? zeroAddress
    : await client.readContract({
        address: board.address,
        abi: boardAbi,
        functionName: "poolOf",
        args: [backerMarkee],
      });
  return {
    ethBalance,
    ethxBalance,
    allowance,
    flowRate,
    backerMarkee,
    deposit,
    cfaAgreement,
    gdaAgreement,
    pool,
  };
}

type ReceiptLog = Pick<Log, "address" | "data" | "topics">;
export function decodeBoardCreated(logs: readonly ReceiptLog[]) {
  const matches = logs.flatMap((log) => {
    if (!isAddressEqual(log.address, MARKEE_FACTORY)) return [];
    try {
      const event = decodeEventLog({
        abi: factoryAbi,
        eventName: "LeaderboardCreated",
        data: log.data,
        topics: log.topics,
      });
      if (
        !isAddressEqual(event.args.admin, MARKEE_ADMIN) ||
        !isAddressEqual(event.args.beneficiaryAddress, MARKEE_BENEFICIARY) ||
        event.args.name !== "revnet.money"
      )
        return [];
      return [{ board: event.args.leaderboardAddress, seedMarkee: event.args.seedMarkeeAddress }];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1)
    throw new Error("Receipt does not contain exactly one reviewed board creation.");
  return matches[0];
}
export function decodeMarkeeCreated(
  logs: readonly ReceiptLog[],
  board: Address,
  owner: Address,
  message: string,
  name: string,
): Address {
  const matches = logs.flatMap((log) => {
    if (!isAddressEqual(log.address, board)) return [];
    try {
      const event = decodeEventLog({
        abi: boardAbi,
        eventName: "MarkeeCreated",
        data: log.data,
        topics: log.topics,
      });
      return isAddressEqual(event.args.owner, owner) &&
        event.args.message === message &&
        event.args.name === name
        ? [event.args.markeeAddress]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1)
    throw new Error("Receipt does not contain exactly one reviewed advertisement creation.");
  return matches[0];
}

export const ratePerSecToMonthly = (rate: bigint) => rate * SECONDS_IN_MONTH;
export function roundUpToNearestThousandth(wei: bigint) {
  const step = 1000000000000000n;
  return wei <= 0n ? 0n : ((wei + step - 1n) / step) * step;
}
export function parseMonthlyRate(input: string, minimum: bigint): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input))
    throw new Error("Enter an ETH amount with at most 18 decimals.");
  return monthlyToRatePerSec(parseEther(input), minimum);
}
export function buildStopStreamOps(p: {
  ethx: Address;
  board: Address;
  backer: Address;
  cfaAgreement: Address;
}): Operation[] {
  const callData = encodeFunctionData({
    abi: CFA_DELETE_FLOW_ABI,
    functionName: "deleteFlow",
    args: [p.ethx, p.backer, p.board, "0x"],
  });
  return [
    {
      operationType: OP_CALL_AGREEMENT,
      target: p.cfaAgreement,
      data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [callData, "0x"]),
    },
  ];
}

/** Upstream WIN preset, using effectiveRate so migrated legacy floors remain authoritative. */
export function recommendedTakeoverMonthlyRate(
  minimumMonthlyRate: bigint,
  effectiveTopRate: bigint,
): bigint {
  if (minimumMonthlyRate < 0n || effectiveTopRate < 0n)
    throw new Error("Rates must be nonnegative.");
  const step = minimumMonthlyRate > 0n ? minimumMonthlyRate : 1000000000000000n;
  const raw =
    effectiveTopRate > 0n ? ((effectiveTopRate * SECONDS_IN_MONTH) / step + 1n) * step : step;
  const displayPrecision = 1000000000000n; // Round up to 6 ETH decimals, never down through the winning rate.
  let monthly = ((raw + displayPrecision - 1n) / displayPrecision) * displayPrecision;
  if (effectiveTopRate === 0n) monthly = roundUpToNearestThousandth(monthly);
  if (monthlyToRatePerSec(monthly, minimumMonthlyRate) <= effectiveTopRate) {
    monthly =
      (((effectiveTopRate + 1n) * SECONDS_IN_MONTH + displayPrecision - 1n) / displayPrecision) *
      displayPrecision;
  }
  monthlyToRatePerSec(monthly, minimumMonthlyRate); // Reject an unrepresentable int96 recommendation.
  return monthly;
}
