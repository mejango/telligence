import {
  JBBuybackHookContracts,
  JBCoreContracts,
  JBRouterTerminalContracts,
  RevnetCoreContracts,
  jbBuybackHookRegistryAbi,
  jbContractAddress,
  jbControllerAbi,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbPermissionsAbi,
  jbPricesAbi,
  jbProjectsAbi,
  jbRouterTerminalRegistryAbi,
  jbRulesetsAbi,
  jbSplitsAbi,
  jbTerminalStoreAbi,
  jbTokensAbi,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  multicall3Abi,
  namehash,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { base, mainnet } from "viem/chains";
import browserProject from "../test/fixtures/browser-project.json" with { type: "json" };

const port = browserProject.fixturePort;
const host = "127.0.0.1";
const appOrigin = `http://127.0.0.1:${browserProject.appPort}`;
const maxBodyBytes = 1024 * 1024;
const chainId = base.id;
const permissionsDeploymentBlock = 47_398_751n;
const fixtureBlockNumber = 47_400_000n;
const fixtureBlockTag = `0x${fixtureBlockNumber.toString(16)}`;
const projectId = 1;
const suckerGroupId = "fixture-sucker-group";
const fixtureCid = browserProject.cid;
const usdc = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const usdcCurrency = BigInt(usdc) & 0xffff_ffffn;
const projectToken = getAddress("0x4444444444444444444444444444444444444444");
const nativeToken = getAddress("0x000000000000000000000000000000000000EEEe");
const fixtureOwner = getAddress("0x1111111111111111111111111111111111111111");
const fixtureParticipant = getAddress("0x2222222222222222222222222222222222222222");
const fixtureOwners = [fixtureOwner, fixtureParticipant];
const ensReverseAbi = [
  {
    name: "reverseWithGateways",
    type: "function",
    stateMutability: "view",
    inputs: [
      { type: "bytes", name: "reverseName" },
      { type: "uint256", name: "coinType" },
      { type: "string[]", name: "gateways" },
    ],
    outputs: [
      { type: "string", name: "resolvedName" },
      { type: "address", name: "resolver" },
      { type: "address", name: "reverseResolver" },
    ],
  },
];
const ensRegistryAbi = [
  {
    name: "resolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
];
const ensTextResolverAbi = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
];
const projectHandlesAbi = [
  {
    name: "ensNamePartsOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "projectId", type: "uint256" },
      { name: "setter", type: "address" },
    ],
    outputs: [{ name: "", type: "string[]" }],
  },
  {
    name: "handleOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "chainId", type: "uint256" },
      { name: "projectId", type: "uint256" },
      { name: "setter", type: "address" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
];
const operatorPermissionsSetEvent = {
  type: "event",
  name: "OperatorPermissionsSet",
  anonymous: false,
  inputs: [
    { name: "operator", type: "address", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "projectId", type: "uint256", indexed: true },
    { name: "permissionIds", type: "uint8[]", indexed: false },
    { name: "packed", type: "uint256", indexed: false },
    { name: "caller", type: "address", indexed: false },
  ],
};
const allowedEnsReverseAddresses = new Set(fixtureOwners.map((address) => address.toLowerCase()));

function base32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

const metadataDigest = createHash("sha256")
  .update(JSON.stringify(browserProject.metadata))
  .digest();
const computedFixtureCid = `b${base32(
  Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), metadataDigest]),
)}`;
if (computedFixtureCid !== fixtureCid) {
  throw new Error(`Fixture metadata CID mismatch: expected ${computedFixtureCid}`);
}

const addressOf = (contract) => getAddress(jbContractAddress[6][contract][chainId]);
const addresses = {
  buybackRegistry: addressOf(JBBuybackHookContracts.JBBuybackHookRegistry),
  controller: addressOf(JBCoreContracts.JBController),
  directory: addressOf(JBCoreContracts.JBDirectory),
  ensRegistry: getAddress("0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"),
  ensTextResolver: getAddress("0x3333333333333333333333333333333333333333"),
  ensUniversalResolver: getAddress(mainnet.contracts.ensUniversalResolver.address),
  fundAccessLimits: addressOf(JBCoreContracts.JBFundAccessLimits),
  multicall: getAddress(base.contracts.multicall3.address),
  permissions: addressOf(JBCoreContracts.JBPermissions),
  projects: addressOf(JBCoreContracts.JBProjects),
  prices: addressOf(JBCoreContracts.JBPrices),
  projectHandles: getAddress("0x726f4a3dfd2fb8297f8ab98d215b42a92d8eefe8"),
  rulesets: addressOf(JBCoreContracts.JBRulesets),
  splits: addressOf(JBCoreContracts.JBSplits),
  terminal: addressOf(JBCoreContracts.JBMultiTerminal),
  terminalStore: addressOf(JBCoreContracts.JBTerminalStore),
  tokens: addressOf(JBCoreContracts.JBTokens),
  revOwner: addressOf(RevnetCoreContracts.REVOwner),
  routerRegistry: addressOf(JBRouterTerminalContracts.JBRouterTerminalRegistry),
  routerTerminal: addressOf(JBRouterTerminalContracts.JBRouterTerminal),
};
allowedEnsReverseAddresses.add(addresses.revOwner.toLowerCase());

const ruleset = {
  cycleNumber: 1n,
  id: 1n,
  basedOnId: 0n,
  start: 1_740_000_000n,
  duration: 31_536_000,
  weight: 1_000_000_000_000_000_000_000_000n,
  weightCutPercent: 50_000_000,
  approvalHook: zeroAddress,
  metadata: 2n << 36n,
};
const rulesetMetadata = {
  reservedPercent: 2_000,
  cashOutTaxRate: 1_000,
  baseCurrency: 2,
  pausePay: false,
  pauseCreditTransfers: false,
  allowOwnerMinting: false,
  allowSetCustomToken: false,
  allowTerminalMigration: false,
  allowSetTerminals: false,
  allowSetController: false,
  allowAddAccountingContext: false,
  allowAddPriceFeed: false,
  ownerMustSendPayouts: false,
  holdFees: false,
  scopeCashOutsToLocalBalances: true,
  useDataHookForPay: false,
  useDataHookForCashOut: false,
  dataHook: zeroAddress,
  metadata: 0,
};

const fixtureProject = {
  projectId,
  chainId,
  metadataUri: `ipfs://${fixtureCid}`,
  handle: "fixture-revnet",
  createdAt: 1_740_000_000,
  description: null,
  suckerGroupId,
  logoUri: null,
  name: "Fixture Revnet",
  projectTagline: browserProject.metadata.projectTagline,
  version: 6,
  token: usdc,
  decimals: 6,
  currency: "2",
  tokenSymbol: "USDC",
  isRevnet: true,
  volume: "1250000000",
  // The discovery documents ask for the trending triple; a project without it fails
  // the client's response contract, which is what left home and discover empty.
  trendingScore: "1250000000",
  trendingVolume: "1250000000",
  trendingPaymentsCount: 2,
  owner: addresses.revOwner,
  permissionHolders: { items: [] },
  suckerGroup: {
    projects: {
      items: [
        { chainId, balance: "1250000000", tokenSupply: "1000000000000000000000000", projectId },
      ],
    },
  },
};
const fixtureSuckerGroup = {
  id: suckerGroupId,
  paymentsCount: 2,
  tokenSupply: "1000000000000000000000000",
  volumeUsd: "1250000000000000000000",
  projects: {
    items: [
      {
        balance: "1250000000",
        chainId,
        currency: "2",
        decimals: 6,
        projectId,
        token: usdc,
        tokenSupply: "1000000000000000000000000",
        tokenSymbol: "USDC",
        version: 6,
        suckerGroupId,
      },
    ],
  },
};

const state = {
  graphqlOperations: {},
  graphqlDocuments: {},
  rpcMethods: {},
  contractFunctions: {},
  multicallBatches: 0,
  unknownRequests: [],
};

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function unknown(kind, detail) {
  const entry = { kind, detail, at: new Date().toISOString() };
  state.unknownRequests.push(entry);
  console.error(`[browser-fixture] rejected ${kind}: ${detail}`);
  return new Error(`Unsupported ${kind}: ${detail}`);
}

function requireFixture(condition, message) {
  if (!condition) throw unknown("fixture input", message);
}

const allowedGraphqlOperations = new Set([
  "ActivityEvents",
  "AddToBalanceInflows",
  "AutoIssueEvents",
  "CashOutTaxSnapshots",
  "HasPermission",
  "IndexedBuybackPools",
  "IndexedPoolSwaps",
  "IndexedProjects",
  "IndexedSuckerGroup",
  "LoansByAccount",
  "MintNftEvents",
  "OwnedNfts",
  "Participants",
  "PayEventRates",
  "Project",
  "ProjectAccountingContext",
  "ProjectCreateEvent",
  "ProjectErc20Tickers",
  "ProjectOperator",
  "ProjectMoments",
  "ProjectWithPermissions",
  "Projects",
  "SuckerGroup",
  "SuckerGroupMoments",
  "StoreAutoIssuanceAmountEvents",
  "TopSuckerGroups",
  "V6AllLoans",
  "V6AutoIssueEvents",
  "V6PermissionHolders",
  "V6ProjectPayers",
  "V6StoredAutoIssuances",
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireExactVariables(operation, actual, expected) {
  requireFixture(
    stableJson(actual) === stableJson(expected),
    `${operation} variables=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
}

const graphqlHandlers = {
  AddToBalanceInflows(variables) {
    requireExactVariables("AddToBalanceInflows", variables, {});
    return {
      addToBalanceEvents: {
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  },
  IndexedProjects(variables) {
    // 60/trendingScore is the homepage's discovery query; 32/250 belong to search and
    // /discover. All three answer with the same deterministic project.
    requireFixture(
      [32, 60, 250].includes(variables.limit) &&
        variables.offset === 0 &&
        ["createdAt", "volume", "trendingScore"].includes(variables.orderBy) &&
        variables.orderDirection === "desc" &&
        variables.where &&
        typeof variables.where === "object",
      `IndexedProjects variables=${JSON.stringify(variables)}`,
    );
    return { projects: { items: [fixtureProject], totalCount: 1 } };
  },
  IndexedSuckerGroup(variables) {
    requireExactVariables("IndexedSuckerGroup", variables, { id: suckerGroupId });
    return { suckerGroup: { projects: { items: [fixtureProject] } } };
  },
  Project(variables) {
    requireExactVariables("Project", variables, { chainId, projectId, version: 6 });
    return { project: fixtureProject };
  },
  ProjectAccountingContext(variables) {
    requireExactVariables("ProjectAccountingContext", variables, {
      chainId,
      projectId,
      version: 6,
    });
    return { project: fixtureProject };
  },
  ProjectErc20Tickers(variables) {
    requireFixture(
      variables.where && typeof variables.where.symbol_contains_nocase === "string",
      `ProjectErc20Tickers variables=${JSON.stringify(variables)}`,
    );
    return { deployErc20Events: { items: [], totalCount: 0 } };
  },
  ProjectOperator(variables) {
    requireExactVariables("ProjectOperator", variables, { chainId, projectId, version: 6 });
    return { permissionHolders: { items: [] } };
  },
  ProjectMoments(variables) {
    requireExactVariables("ProjectMoments", variables, { projectId, chainId, version: 6 });
    return {
      projectMoments: {
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  },
  ProjectWithPermissions(variables) {
    requireExactVariables("ProjectWithPermissions", variables, {
      chainId,
      projectId,
      version: 6,
    });
    return { project: fixtureProject };
  },
  SuckerGroup(variables) {
    requireExactVariables("SuckerGroup", variables, { id: suckerGroupId });
    return { suckerGroup: fixtureSuckerGroup };
  },
  Participants(variables) {
    requireFixture(
      variables.where?.suckerGroupId === suckerGroupId && variables.where?.balance_gt === "0",
      `Participants variables=${JSON.stringify(variables)}`,
    );
    requireFixture(
      [undefined, "balance"].includes(variables.orderBy) &&
        [undefined, "desc"].includes(variables.orderDirection) &&
        [undefined, 250, 1000].includes(variables.limit) &&
        [undefined, 0].includes(variables.offset),
      `Participants paging=${JSON.stringify(variables)}`,
    );
    requireFixture(
      Object.keys(variables).every((key) =>
        ["where", "orderBy", "orderDirection", "limit", "offset"].includes(key),
      ),
      `Participants unexpected keys=${JSON.stringify(variables)}`,
    );
    return {
      participants: {
        totalCount: 2,
        items: [
          {
            chainId,
            projectId,
            version: 6,
            address: fixtureOwner,
            volume: "750000000",
            lastPaidTimestamp: 1_760_000_000,
            balance: "600000000000000000000000",
            erc20Balance: "600000000000000000000000",
            creditBalance: "0",
          },
          {
            chainId,
            projectId,
            version: 6,
            address: fixtureParticipant,
            volume: "500000000",
            lastPaidTimestamp: 1_750_000_000,
            balance: "400000000000000000000000",
            erc20Balance: "400000000000000000000000",
            creditBalance: "0",
          },
        ],
      },
    };
  },
  PayEventRates(variables) {
    requireExactVariables("PayEventRates", variables, {
      where: { chainId, projectId, version: 6 },
      limit: 500,
      offset: 0,
    });
    return { payEvents: { items: [] } };
  },
  ActivityEvents(variables) {
    // Two callers: a project's own feed (scoped to its sucker group) and the homepage
    // feed (every v6 event). Both are deterministic and empty here.
    const projectScoped =
      variables.where?.suckerGroupId === suckerGroupId && variables.limit === 250;
    const homepageScoped = variables.where?.version === 6 && variables.limit === 100;
    requireFixture(
      variables.orderBy === "timestamp" &&
        variables.orderDirection === "desc" &&
        variables.offset === 0 &&
        (projectScoped || homepageScoped),
      `ActivityEvents variables=${JSON.stringify(variables)}`,
    );
    return { activityEvents: { items: [], totalCount: 0 } };
  },
  CashOutTaxSnapshots(variables) {
    requireExactVariables("CashOutTaxSnapshots", variables, { suckerGroupId });
    return {
      cashOutTaxSnapshots: {
        items: [
          {
            cashOutTax: 1_000,
            start: 1_740_000_000,
            duration: 31_536_000,
            rulesetId: "1",
            suckerGroupId,
            version: 6,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  },
  SuckerGroupMoments(variables) {
    requireExactVariables("SuckerGroupMoments", variables, { suckerGroupId });
    return {
      suckerGroupMoments: {
        items: [
          {
            timestamp: 1_740_000_000,
            balance: "1000000000",
            tokenSupply: "800000000000000000000000",
            suckerGroupId,
            version: 6,
          },
          {
            timestamp: 1_770_000_000,
            balance: "1250000000",
            tokenSupply: "1000000000000000000000000",
            suckerGroupId,
            version: 6,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  },
  StoreAutoIssuanceAmountEvents(variables) {
    requireExactVariables("StoreAutoIssuanceAmountEvents", variables, {
      where: { chainId, projectId, version: 6 },
    });
    return { storeAutoIssuanceAmountEvents: { items: [] } };
  },
  AutoIssueEvents(variables) {
    requireExactVariables("AutoIssueEvents", variables, {
      where: { chainId, projectId, version: 6 },
    });
    return { autoIssueEvents: { items: [] } };
  },
  IndexedBuybackPools(variables) {
    requireExactVariables("IndexedBuybackPools", variables, {
      projectId,
      chainId,
      version: 6,
      limit: 1000,
      offset: 0,
    });
    return { buybackPoolEvents: { items: [], totalCount: 0 } };
  },
  IndexedPoolSwaps(variables) {
    requireFixture(
      variables.projectId === projectId &&
        variables.chainId === chainId &&
        variables.version === 6 &&
        Number.isInteger(variables.limit) &&
        Number.isInteger(variables.offset),
      `IndexedPoolSwaps variables=${JSON.stringify(variables)}`,
    );
    return { swapEvents: { items: [], totalCount: 0 } };
  },
  ProjectCreateEvent(variables) {
    requireExactVariables("ProjectCreateEvent", variables, {
      where: { chainId, projectId, version: 6 },
    });
    return { projectCreateEvents: { items: [] } };
  },
  TopSuckerGroups(variables) {
    requireExactVariables("TopSuckerGroups", variables, { limit: 1000, offset: 0 });
    // Every field the document asks for: a missing one fails the client's response
    // contract, and the home totals then render as "…" forever.
    return {
      suckerGroups: {
        items: [
          {
            id: suckerGroupId,
            balance: "1250000000",
            volume: "1250000000",
            projects: {
              items: [
                {
                  balance: "1250000000",
                  chainId,
                  currency: "2",
                  decimals: 6,
                  isRevnet: true,
                  logoUri: null,
                  name: browserProject.metadata.name,
                  projectId,
                  projectTagline: browserProject.metadata.projectTagline,
                  tokenSymbol: "USDC",
                  version: 6,
                },
              ],
            },
          },
        ],
        totalCount: 1,
      },
    };
  },
  Projects(variables) {
    requireExactVariables("Projects", variables, {});
    return {
      projects: [
        {
          projectId: String(projectId),
          handle: fixtureProject.handle,
          metadataUri: fixtureProject.metadataUri,
        },
      ],
    };
  },
  V6ProjectPayers(variables) {
    requireExactVariables("V6ProjectPayers", variables, {
      where: {
        OR: [{ AND: [{ chainId }, { projectId }, { version: 6 }] }],
      },
      limit: 250,
      offset: 0,
    });
    return { projectPayers: { items: [], totalCount: 0 } };
  },
  V6PermissionHolders(variables) {
    const expectedBase = { chainId, projectId, version: 6 };
    const revOwnerAccount = addresses.revOwner.toLowerCase();
    const exactProjects = {
      OR: [{ AND: [{ chainId }, { projectId }, { version: 6 }] }],
    };
    const exactOperator = {
      AND: [exactProjects, { isRevnetOperator: true }],
    };
    const exactRevOwnerAccount = {
      AND: [exactProjects, { account: revOwnerAccount }],
    };
    const exactWildcardRevOwnerAccount = {
      OR: [
        {
          AND: [{ chainId }, { projectId: 0 }, { version: 6 }, { account: revOwnerAccount }],
        },
      ],
    };
    const expected = [
      { where: exactProjects },
      { where: exactOperator },
      { where: exactRevOwnerAccount },
      {
        where: exactProjects,
        limit: 250,
        offset: 0,
      },
      {
        where: exactOperator,
        limit: 250,
        offset: 0,
      },
      {
        where: exactRevOwnerAccount,
        limit: 250,
        offset: 0,
      },
      {
        where: exactWildcardRevOwnerAccount,
        limit: 250,
        offset: 0,
      },
      {
        where: { ...expectedBase, isRevnetOperator: true },
        limit: 250,
        offset: 0,
      },
      {
        where: { ...expectedBase, account: revOwnerAccount },
        limit: 64,
        offset: 0,
      },
    ];
    requireFixture(
      expected.some((candidate) => stableJson(candidate) === stableJson(variables)),
      `V6PermissionHolders variables=${JSON.stringify(variables)}`,
    );
    // Server-side route discovery must exercise its onchain event fallback;
    // the client-side AND-shaped request still receives the indexed operator.
    if (
      stableJson(variables) ===
      stableJson({
        where: { ...expectedBase, account: revOwnerAccount },
        limit: 64,
        offset: 0,
      })
    ) {
      return { permissionHolders: { items: [], totalCount: 0 } };
    }
    if (
      stableJson(variables) ===
      stableJson({ where: exactWildcardRevOwnerAccount, limit: 250, offset: 0 })
    ) {
      return { permissionHolders: { items: [], totalCount: 0 } };
    }
    return {
      permissionHolders: {
        items: [
          {
            chainId,
            projectId,
            version: 6,
            account: revOwnerAccount,
            operator: fixtureOwner,
            permissions: [7, 19, 30],
            isRevnetOperator: true,
          },
        ],
        totalCount: 1,
      },
    };
  },
  V6StoredAutoIssuances(variables) {
    requireExactVariables("V6StoredAutoIssuances", variables, {
      where: {
        OR: [{ AND: [{ chainId }, { projectId }, { version: 6 }] }],
      },
      limit: 250,
      offset: 0,
    });
    return { storeAutoIssuanceAmountEvents: { items: [], totalCount: 0 } };
  },
  V6AutoIssueEvents(variables) {
    requireExactVariables("V6AutoIssueEvents", variables, {
      where: {
        OR: [{ AND: [{ chainId }, { projectId }, { version: 6 }] }],
      },
      limit: 250,
      offset: 0,
    });
    return { autoIssueEvents: { items: [], totalCount: 0 } };
  },
  V6AllLoans(variables) {
    requireExactVariables("V6AllLoans", variables, {
      where: {
        OR: [{ AND: [{ chainId }, { projectId }, { version: 6 }] }],
      },
      limit: 250,
      offset: 0,
    });
    return {
      loans: {
        items: [
          {
            id: "1",
            borrowAmount: "603574100",
            collateral: "5021013808100000000000000",
            beneficiary: fixtureOwner,
            owner: fixtureOwner,
            createdAt: Math.floor(Date.now() / 1000) - 60,
            chainId,
            projectId,
            version: 6,
            token: usdc,
            prepaidFeePercent: 25,
            prepaidDuration: 15_768_000,
          },
        ],
        totalCount: 1,
      },
    };
  },
  OwnedNfts(variables) {
    requireFixture(
      variables.where?.version === 6 &&
        Number.isInteger(variables.limit) &&
        Number.isInteger(variables.offset),
      `OwnedNfts variables=${JSON.stringify(variables)}`,
    );
    return { nfts: { items: [], totalCount: 0 } };
  },
  MintNftEvents(variables) {
    requireFixture(
      variables.where?.version === 6 &&
        Number.isInteger(variables.limit) &&
        Number.isInteger(variables.offset),
      `MintNftEvents variables=${JSON.stringify(variables)}`,
    );
    return { mintNftEvents: { items: [], totalCount: 0 } };
  },
};

function handleGraphql(body) {
  requireFixture(
    body && typeof body === "object" && !Array.isArray(body),
    "GraphQL body must be an object",
  );
  requireFixture(
    Object.keys(body).every((key) => ["operationName", "query", "variables"].includes(key)),
    `GraphQL envelope keys=${Object.keys(body).join(",")}`,
  );
  requireFixture(typeof body.query === "string", "GraphQL query must be a string");
  requireFixture(body.query.length <= 64 * 1024, "GraphQL query exceeds fixture limit");
  requireFixture(
    typeof body.operationName === "string" && allowedGraphqlOperations.has(body.operationName),
    `GraphQL operationName=${String(body.operationName)}`,
  );
  const operation = body.operationName;
  const normalizedQuery = body.query
    .replace(/#[^\r\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  requireFixture(
    !/\b(?:mutation|subscription)\b/iu.test(normalizedQuery),
    "GraphQL fixture only permits queries",
  );
  const escapedOperation = operation.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  requireFixture(
    new RegExp(`^query\\s+${escapedOperation}\\b`, "u").test(normalizedQuery),
    `GraphQL document does not match ${operation}`,
  );
  requireFixture(
    (normalizedQuery.match(/\bquery\b/gu) ?? []).length === 1,
    "GraphQL fixture requires exactly one operation",
  );
  const hash = createHash("sha256").update(normalizedQuery).digest("hex");
  const variables = body.variables ?? {};
  requireFixture(
    variables && typeof variables === "object" && !Array.isArray(variables),
    `${operation} variables must be an object`,
  );
  const handler = graphqlHandlers[operation];
  if (!handler) throw unknown("GraphQL operation", String(operation ?? "anonymous"));
  increment(state.graphqlOperations, operation);
  increment(state.graphqlDocuments, hash);
  return handler(variables);
}

const registeredCalls = new Map();

function registerCall({ abi, functionName, address, result }) {
  const item = abi.find((entry) => entry.type === "function" && entry.name === functionName);
  if (!item) throw new Error(`Fixture ABI does not contain ${functionName}`);
  const selector = toFunctionSelector(item);
  registeredCalls.set(`${address.toLowerCase()}:${selector}`, {
    abi: [item],
    functionName,
    result,
  });
}

// Viem implements native balance reads through Multicall3 when batching is
// enabled. Keep that standard helper call inside the deterministic fixture
// instead of treating it as an unknown contract surface.
registerCall({
  abi: multicall3Abi,
  functionName: "getEthBalance",
  address: addresses.multicall,
  result: () => 0n,
});

// The long viewed identity used by responsive navigation also renders project
// balances and permissions. Permit only this participant's exact read-only tuples.
registerCall({
  abi: erc20Abi,
  functionName: "balanceOf",
  address: usdc,
  result: ([holder]) => {
    requireFixture(holder === fixtureParticipant, `USDC balanceOf holder=${holder}`);
    return 0n;
  },
});
registerCall({
  abi: jbPermissionsAbi,
  functionName: "permissionsOf",
  address: addresses.permissions,
  result: ([operator, account, requestedProjectId]) => {
    requireFixture(operator === fixtureParticipant, `permissionsOf operator=${operator}`);
    requireFixture(account === addresses.revOwner, `permissionsOf account=${account}`);
    requireFixture(
      requestedProjectId === 1n || requestedProjectId === 0n,
      `permissionsOf projectId=${requestedProjectId}`,
    );
    return 0n;
  },
});

registerCall({
  abi: jbDirectoryAbi,
  functionName: "primaryTerminalOf",
  address: addresses.directory,
  result: ([requestedProjectId, token]) => {
    requireFixture(requestedProjectId === 1n, `primaryTerminalOf projectId=${requestedProjectId}`);
    requireFixture(
      token.toLowerCase() === usdc.toLowerCase() ||
        token.toLowerCase() === nativeToken.toLowerCase(),
      `primaryTerminalOf token=${token}`,
    );
    return token.toLowerCase() === usdc.toLowerCase() ? addresses.terminal : zeroAddress;
  },
});
registerCall({
  abi: jbDirectoryAbi,
  functionName: "controllerOf",
  address: addresses.directory,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `controllerOf projectId=${requestedProjectId}`);
    return addresses.controller;
  },
});
registerCall({
  abi: jbDirectoryAbi,
  functionName: "terminalsOf",
  address: addresses.directory,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `terminalsOf projectId=${requestedProjectId}`);
    return [addresses.terminal];
  },
});
registerCall({
  abi: jbDirectoryAbi,
  functionName: "isTerminalOf",
  address: addresses.directory,
  result: ([requestedProjectId, terminal]) => {
    requireFixture(requestedProjectId === 1n, `isTerminalOf projectId=${requestedProjectId}`);
    requireFixture(
      [addresses.routerRegistry, addresses.routerTerminal].some(
        (candidate) => candidate.toLowerCase() === terminal.toLowerCase(),
      ),
      `isTerminalOf terminal=${terminal}`,
    );
    return false;
  },
});
for (const [functionName, result] of [
  ["FUND_ACCESS_LIMITS", addresses.fundAccessLimits],
  ["RULESETS", addresses.rulesets],
  ["TOKENS", addresses.tokens],
  ["SPLITS", addresses.splits],
]) {
  registerCall({
    abi: jbControllerAbi,
    functionName,
    address: addresses.controller,
    result: () => result,
  });
}
// Nana's contract provider briefly issues these reads against its explicit
// zero-address sentinel while controllerOf is hydrating. They are exact,
// ABI-decoded calls and resolve to the same empty sentinel.
for (const functionName of ["FUND_ACCESS_LIMITS", "RULESETS", "TOKENS", "SPLITS"]) {
  registerCall({
    abi: jbControllerAbi,
    functionName,
    address: zeroAddress,
    result: () => zeroAddress,
  });
}
registerCall({
  abi: jbControllerAbi,
  functionName: "currentRulesetOf",
  address: addresses.controller,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `currentRulesetOf projectId=${requestedProjectId}`);
    return [ruleset, rulesetMetadata];
  },
});
registerCall({
  abi: jbControllerAbi,
  functionName: "getRulesetOf",
  address: addresses.controller,
  result: ([requestedProjectId, rulesetId]) => {
    requireFixture(requestedProjectId === 1n, `getRulesetOf projectId=${requestedProjectId}`);
    requireFixture(rulesetId === ruleset.id, `getRulesetOf rulesetId=${rulesetId}`);
    return [ruleset, rulesetMetadata];
  },
});
registerCall({
  abi: jbControllerAbi,
  functionName: "uriOf",
  address: addresses.controller,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `uriOf projectId=${requestedProjectId}`);
    return `ipfs://${fixtureCid}`;
  },
});
registerCall({
  abi: jbControllerAbi,
  functionName: "pendingReservedTokenBalanceOf",
  address: addresses.controller,
  result: ([requestedProjectId]) => {
    requireFixture(
      requestedProjectId === 1n,
      `pendingReservedTokenBalanceOf projectId=${requestedProjectId}`,
    );
    return 0n;
  },
});
registerCall({
  abi: jbRulesetsAbi,
  functionName: "allOf",
  address: addresses.rulesets,
  result: ([requestedProjectId, startingId, size]) => {
    requireFixture(requestedProjectId === 1n, `allOf projectId=${requestedProjectId}`);
    requireFixture(startingId === 0n && size === 100n, `allOf range=${startingId}:${size}`);
    return [ruleset];
  },
});
registerCall({
  abi: jbSplitsAbi,
  functionName: "splitsOf",
  address: addresses.splits,
  result: ([requestedProjectId, rulesetId]) => {
    requireFixture(requestedProjectId === 1n, `splitsOf projectId=${requestedProjectId}`);
    // JBSplits.FALLBACK_RULESET_ID (0) is a real read: the splits surfaces size
    // the fallback group alongside the stage's own group, because `splitsOf`
    // serves the fallback whenever a ruleset's group is empty.
    requireFixture(rulesetId === ruleset.id || rulesetId === 0n, `splitsOf rulesetId=${rulesetId}`);
    return [];
  },
});
registerCall({
  abi: jbMultiTerminalAbi,
  functionName: "STORE",
  address: addresses.terminal,
  result: () => addresses.terminalStore,
});
registerCall({
  abi: jbMultiTerminalAbi,
  functionName: "accountingContextsOf",
  address: addresses.terminal,
  result: ([requestedProjectId]) => {
    requireFixture(
      requestedProjectId === 1n,
      `accountingContextsOf projectId=${requestedProjectId}`,
    );
    return [{ token: usdc, decimals: 6, currency: 2 }];
  },
});
registerCall({
  abi: jbTokensAbi,
  functionName: "tokenOf",
  address: addresses.tokens,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `tokenOf projectId=${requestedProjectId}`);
    return projectToken;
  },
});
registerCall({
  abi: jbProjectsAbi,
  functionName: "ownerOf",
  address: addresses.projects,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `ownerOf projectId=${requestedProjectId}`);
    return fixtureProject.owner;
  },
});
registerCall({
  abi: revOwnerAbi,
  functionName: "isOperatorOf",
  address: addresses.revOwner,
  result: ([requestedProjectId, operator]) => {
    requireFixture(requestedProjectId === 1n, `isOperatorOf projectId=${requestedProjectId}`);
    requireFixture(
      operator.toLowerCase() === fixtureOwner.toLowerCase(),
      `isOperatorOf operator=${operator}`,
    );
    return true;
  },
});
registerCall({
  abi: revOwnerAbi,
  functionName: "tiered721HookOf",
  address: addresses.revOwner,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `tiered721HookOf projectId=${requestedProjectId}`);
    return zeroAddress;
  },
});
registerCall({
  abi: revOwnerAbi,
  functionName: "cashOutDelayOf",
  address: addresses.revOwner,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `cashOutDelayOf projectId=${requestedProjectId}`);
    return 0n;
  },
});
registerCall({
  abi: jbTerminalStoreAbi,
  functionName: "balanceOf",
  address: addresses.terminalStore,
  result: ([terminal, requestedProjectId, token]) => {
    requireFixture(terminal === addresses.terminal, `balanceOf terminal=${terminal}`);
    requireFixture(requestedProjectId === 1n, `balanceOf projectId=${requestedProjectId}`);
    requireFixture(token === usdc, `balanceOf token=${token}`);
    return 1_250_000_000n;
  },
});
registerCall({
  abi: jbPricesAbi,
  functionName: "pricePerUnitOf",
  address: addresses.prices,
  result: ([requestedProjectId, pricingCurrency, unitCurrency, decimals]) => {
    if (requestedProjectId === 0n) {
      requireFixture(
        pricingCurrency === 2n && unitCurrency === 1n && decimals === 18n,
        `default pricePerUnitOf quote=${pricingCurrency}:${unitCurrency}:${decimals}`,
      );
      return 3_000_000_000_000_000_000_000n;
    }
    requireFixture(requestedProjectId === 1n, `pricePerUnitOf projectId=${requestedProjectId}`);
    requireFixture(
      pricingCurrency === 2n && [2n, usdcCurrency].includes(unitCurrency) && decimals === 18n,
      `pricePerUnitOf quote=${pricingCurrency}:${unitCurrency}:${decimals}`,
    );
    return 1_000_000_000_000_000_000n;
  },
});
registerCall({
  abi: jbTerminalStoreAbi,
  functionName: "currentReclaimableSurplusOf",
  address: addresses.terminalStore,
  result: ([requestedProjectId, cashOutCount, terminals, tokens, decimals, currency]) => {
    requireFixture(
      requestedProjectId === 1n,
      `currentReclaimableSurplusOf projectId=${requestedProjectId}`,
    );
    requireFixture(
      cashOutCount === 975_000_000_000_000_000_000_000n,
      `currentReclaimableSurplusOf cashOutCount=${cashOutCount}`,
    );
    requireFixture(
      terminals.length === 0 && tokens.length === 0,
      "currentReclaimableSurplusOf terminal/token overrides",
    );
    requireFixture(
      decimals === 18n && currency === 2n,
      `currentReclaimableSurplusOf quote=${decimals}:${currency}`,
    );
    return 1_250_000_000_000_000_000_000n;
  },
});
registerCall({
  abi: jbBuybackHookRegistryAbi,
  functionName: "defaultHook",
  address: addresses.buybackRegistry,
  result: () => zeroAddress,
});
registerCall({
  abi: jbRouterTerminalRegistryAbi,
  functionName: "defaultTerminal",
  address: addresses.routerRegistry,
  result: () => zeroAddress,
});
for (const [functionName, result] of [
  ["name", "Fixture Revnet Token"],
  ["symbol", "FREV"],
  ["decimals", 18],
  ["totalSupply", 1_000_000_000_000_000_000_000_000n],
]) {
  registerCall({ abi: erc20Abi, functionName, address: projectToken, result: () => result });
}
for (const [functionName, result] of [
  ["name", "USD Coin"],
  ["symbol", "USDC"],
  ["decimals", 6],
  ["totalSupply", 50_000_000_000_000n],
]) {
  registerCall({ abi: erc20Abi, functionName, address: usdc, result: () => result });
}
registerCall({
  abi: ensReverseAbi,
  functionName: "reverseWithGateways",
  address: addresses.ensUniversalResolver,
  result: ([reverseName, coinType, gateways]) => {
    requireFixture(
      allowedEnsReverseAddresses.has(reverseName.toLowerCase()),
      `ENS reverseName=${reverseName}`,
    );
    requireFixture(coinType === 60n, `ENS coinType=${coinType}`);
    requireFixture(
      gateways.length === 1 && gateways[0] === "x-batch-gateway:true",
      `ENS gateways=${gateways.join(",")}`,
    );
    // Exercise the longest header state with a realistic viewed identity;
    // other fixture accounts retain the canonical "no reverse record" result.
    const name =
      reverseName.toLowerCase() === fixtureParticipant.toLowerCase() ? "artizenendowment.eth" : "";
    return [name, zeroAddress, zeroAddress];
  },
});

const fixtureHandle = "fixture-revnet";
const fixtureHandleNode = namehash(`${fixtureHandle}.eth`);
for (const functionName of ["resolver", "owner"]) {
  registerCall({
    abi: ensRegistryAbi,
    functionName,
    address: addresses.ensRegistry,
    result: ([node]) => {
      requireFixture(node === fixtureHandleNode, `ENS ${functionName} node=${node}`);
      return functionName === "resolver" ? addresses.ensTextResolver : fixtureOwner;
    },
  });
}
registerCall({
  abi: ensTextResolverAbi,
  functionName: "text",
  address: addresses.ensTextResolver,
  result: ([node, key]) => {
    requireFixture(node === fixtureHandleNode, `ENS text node=${node}`);
    requireFixture(key === "juicebox", `ENS text key=${key}`);
    return `${chainId}:${projectId}`;
  },
});
for (const [functionName, result] of [
  ["ensNamePartsOf", [fixtureHandle]],
  ["handleOf", fixtureHandle],
]) {
  registerCall({
    abi: projectHandlesAbi,
    functionName,
    address: addresses.projectHandles,
    result: ([requestedChainId, requestedProjectId, setter]) => {
      requireFixture(
        requestedChainId === BigInt(chainId),
        `${functionName} chainId=${requestedChainId}`,
      );
      requireFixture(requestedProjectId === 1n, `${functionName} projectId=${requestedProjectId}`);
      requireFixture(
        setter.toLowerCase() === fixtureOwner.toLowerCase(),
        `${functionName} setter=${setter}`,
      );
      return result;
    },
  });
}

export function executeContractCall(to, data) {
  const address = getAddress(to);
  if (address === addresses.multicall && data.startsWith(toFunctionSelector(multicall3Abi[0]))) {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data });
    requireFixture(
      decoded.functionName === "aggregate3",
      `multicall function=${decoded.functionName}`,
    );
    state.multicallBatches += 1;
    const calls = decoded.args[0];
    requireFixture(calls.length > 0 && calls.length <= 100, `multicall size=${calls.length}`);
    const results = calls.map(({ target, allowFailure, callData }) => {
      try {
        return { success: true, returnData: executeContractCall(target, callData) };
      } catch (error) {
        if (!allowFailure) throw error;
        return { success: false, returnData: "0x" };
      }
    });
    return encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: results,
    });
  }

  const selector = data.slice(0, 10);
  const registered = registeredCalls.get(`${address.toLowerCase()}:${selector}`);
  if (!registered) throw unknown("contract call", `${address} selector ${selector}`);
  const decoded = decodeFunctionData({ abi: registered.abi, data });
  increment(state.contractFunctions, registered.functionName);
  const result = registered.result(decoded.args ?? []);
  return encodeFunctionResult({
    abi: registered.abi,
    functionName: registered.functionName,
    result,
  });
}

function handleRpc(request) {
  requireFixture(
    request && typeof request === "object" && !Array.isArray(request),
    "JSON-RPC request must be an object",
  );
  requireFixture(request.jsonrpc === "2.0", `JSON-RPC version=${request.jsonrpc}`);
  requireFixture(
    Object.keys(request).every((key) => ["jsonrpc", "id", "method", "params"].includes(key)),
    `JSON-RPC envelope keys=${Object.keys(request).join(",")}`,
  );
  requireFixture(
    typeof request.id === "number" || typeof request.id === "string",
    `JSON-RPC id=${request.id}`,
  );
  requireFixture(typeof request.method === "string", "JSON-RPC method must be a string");
  const { id, method } = request;
  const params = request.params ?? [];
  requireFixture(Array.isArray(params), `${method} params must be an array`);
  increment(state.rpcMethods, String(method));
  let result;
  if (method === "eth_chainId") {
    requireFixture(params.length === 0, `eth_chainId params=${JSON.stringify(params)}`);
    result = `0x${chainId.toString(16)}`;
  } else if (method === "net_version") {
    requireFixture(params.length === 0, `net_version params=${JSON.stringify(params)}`);
    result = String(chainId);
  } else if (method === "eth_blockNumber") {
    requireFixture(params.length === 0, `eth_blockNumber params=${JSON.stringify(params)}`);
    result = fixtureBlockTag;
  } else if (method === "eth_call") {
    requireFixture(
      params.length === 2 && ["latest", fixtureBlockTag].includes(params[1]),
      `eth_call params=${params.length}`,
    );
    const call = params[0];
    requireFixture(
      call &&
        typeof call === "object" &&
        !Array.isArray(call) &&
        typeof call.to === "string" &&
        typeof call.data === "string" &&
        Object.keys(call).every((key) => ["from", "to", "data", "gas"].includes(key)),
      "invalid eth_call",
    );
    const exactEnsTextRead = getAddress(call.to) === addresses.ensTextResolver;
    const exactProjectHandleRead = getAddress(call.to) === addresses.projectHandles;
    requireFixture(
      exactEnsTextRead
        ? call.gas === "0x1e848" && getAddress(call.from) === addresses.projectHandles
        : exactProjectHandleRead
          ? call.gas === "0x493e0" && call.from === undefined
          : call.gas === undefined && call.from === undefined,
      `eth_call gas=${String(call.gas)}`,
    );
    result = executeContractCall(call.to, call.data);
  } else if (method === "eth_getLogs") {
    requireFixture(params.length === 1, `eth_getLogs params=${JSON.stringify(params)}`);
    const filter = params[0];
    const filterTopics = encodeEventTopics({
      abi: [operatorPermissionsSetEvent],
      eventName: "OperatorPermissionsSet",
      args: { account: addresses.revOwner, projectId: 1n },
    });
    const eventTopics = encodeEventTopics({
      abi: [operatorPermissionsSetEvent],
      eventName: "OperatorPermissionsSet",
      args: { operator: fixtureOwner, account: addresses.revOwner, projectId: 1n },
    });
    requireFixture(
      filter &&
        getAddress(filter.address) === addresses.permissions &&
        stableJson(filter.topics) === stableJson(filterTopics) &&
        filter.fromBlock === `0x${permissionsDeploymentBlock.toString(16)}` &&
        filter.toBlock === fixtureBlockTag,
      `eth_getLogs filter=${JSON.stringify(filter)}`,
    );
    result = [
      {
        address: addresses.permissions,
        blockHash: `0x${"44".repeat(32)}`,
        blockNumber: `0x${(fixtureBlockNumber - 1n).toString(16)}`,
        data: encodeAbiParameters(
          [{ type: "uint8[]" }, { type: "uint256" }, { type: "address" }],
          [[7, 19, 30], 1n, addresses.revOwner],
        ),
        logIndex: "0x0",
        removed: false,
        topics: eventTopics,
        transactionHash: `0x${"55".repeat(32)}`,
        transactionIndex: "0x0",
      },
    ];
  } else if (method === "eth_getCode") {
    requireFixture(
      params.length === 2 && ["latest", fixtureBlockTag].includes(params[1]),
      `eth_getCode params=${JSON.stringify(params)}`,
    );
    const requested = getAddress(params[0]);
    const known =
      requested === fixtureOwner ||
      requested === projectToken ||
      requested === addresses.multicall ||
      Object.values(addresses).includes(requested);
    requireFixture(known, `eth_getCode address=${requested}`);
    result = requested === fixtureOwner ? "0x" : "0x60006000";
  } else {
    throw unknown("JSON-RPC method", String(method));
  }
  return { jsonrpc: "2.0", id, result };
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  requireFixture(
    contentType.toLowerCase().startsWith("application/json"),
    `content-type=${contentType}`,
  );
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw unknown("request body", `larger than ${maxBodyBytes} bytes`);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw unknown("request body", "invalid JSON");
  }
}

function sendJson(response, status, body, cors = false) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(encoded),
    "content-type": "application/json; charset=utf-8",
    ...(cors
      ? {
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": appOrigin,
        }
      : {}),
  });
  response.end(encoded);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const isApi = url.pathname === "/graphql" || url.pathname === "/rpc";
  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok", fixture: "revnet-browser-v1" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__fixture/status") {
      sendJson(response, 200, state, true);
      return;
    }
    if (request.method === "OPTIONS" && isApi) {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-origin": appOrigin,
      });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/graphql") {
      sendJson(response, 200, { data: handleGraphql(await readJson(request)) }, true);
      return;
    }
    if (request.method === "POST" && url.pathname === "/rpc") {
      const body = await readJson(request);
      requireFixture(
        !Array.isArray(body) || (body.length > 0 && body.length <= 100),
        "invalid RPC batch",
      );
      const result = Array.isArray(body) ? body.map(handleRpc) : handleRpc(body);
      sendJson(response, 200, result, true);
      return;
    }
    throw unknown("HTTP request", `${request.method} ${url.pathname}`);
  } catch (error) {
    sendJson(
      response,
      400,
      { error: error instanceof Error ? error.message : "Fixture request failed" },
      isApi,
    );
  }
});

if (import.meta.main) {
  server.listen(port, host, () => {
    console.log(`[browser-fixture] listening on http://${host}:${port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
