import { RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import { DEFAULT_FORM_DATA, defaultStoreData } from "@/app/create/constants";
import type { RevnetFormData, StageData } from "@/app/create/types";
import { newDraftItem } from "@/components/shop/itemDraft";
import { readAllProjectRulesets } from "@/lib/nana/rulesets";
import type { JBChainId } from "@/lib/nana/types";
import {
  JBCoreContracts,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
  getJBContractAddress,
  jbControllerAbi,
  jbSplitsAbi,
} from "@bananapus/nana-sdk-core";
import { RULESET_WEIGHT_INHERIT, getAccountingContexts } from "@bananapus/nana-sdk-core/v6";
import { formatUnits, zeroAddress, type Address, type PublicClient } from "viem";

const MAX_DRAFT_BYTES = 2_000_000;
const SPLITS_TOTAL = 1_000_000_000;

type RawSplit = {
  percent: number;
  projectId: bigint;
  beneficiary: Address;
  preferAddToBalance: boolean;
  lockedUntil: number;
  hook: Address;
};

type RulesetMetadata = {
  reservedPercent: number;
  cashOutTaxRate: number;
  baseCurrency: number;
  metadata: number;
};

type RevnetDraftFile = {
  v: 1;
  app: "revnet.money";
  data: RevnetFormData;
};

export type RevnetDraftResult = {
  file: RevnetDraftFile;
  warnings: string[];
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";
const numericText = (value: unknown, max = 24) => {
  const raw = typeof value === "number" ? String(value) : text(value, max);
  return /^-?\d*(?:\.\d*)?$/u.test(raw) ? raw : "";
};

function sanitizeStage(value: unknown): StageData {
  const stage = (value ?? {}) as Record<string, unknown>;
  const autoIssuance = Array.isArray(stage.autoIssuance) ? stage.autoIssuance : [];
  const splits = Array.isArray(stage.splits) ? stage.splits : [];
  return {
    initialIssuance: numericText(stage.initialIssuance),
    pickUpFromPrevious: stage.pickUpFromPrevious === true,
    priceCeilingIncreasePercentage: numericText(stage.priceCeilingIncreasePercentage),
    priceCeilingIncreaseFrequency: numericText(stage.priceCeilingIncreaseFrequency),
    priceFloorTaxIntensity: numericText(stage.priceFloorTaxIntensity),
    extraMetadata:
      Number.isInteger(Number(stage.extraMetadata)) &&
      Number(stage.extraMetadata) >= 0 &&
      Number(stage.extraMetadata) <= 0x3fff
        ? Number(stage.extraMetadata)
        : 0,
    autoIssuance: autoIssuance.slice(0, 100).flatMap((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const chainId = Number(row.chainId);
      return Number.isSafeInteger(chainId) && chainId > 0
        ? [
            {
              amount: numericText(row.amount),
              beneficiary: text(row.beneficiary, 64),
              chainId: chainId as JBChainId,
            },
          ]
        : [];
    }),
    splits: splits.slice(0, 100).map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const beneficiaries = Array.isArray(row.beneficiary) ? row.beneficiary : [];
      return {
        percentage: numericText(row.percentage),
        defaultBeneficiary: text(row.defaultBeneficiary, 64),
        beneficiary: beneficiaries.slice(0, 16).flatMap((beneficiary) => {
          const item = (beneficiary ?? {}) as Record<string, unknown>;
          const chainId = Number(item.chainId);
          const address = text(item.address, 64);
          return Number.isSafeInteger(chainId) && chainId > 0 && address
            ? [{ chainId: chainId as JBChainId, address }]
            : [];
        }),
      };
    }),
    stageStart: numericText(stage.stageStart) || "0",
    stageStartCuts: numericText(stage.stageStartCuts) || undefined,
    futureStartTimestamp:
      Number.isSafeInteger(Number(stage.futureStartTimestamp)) &&
      Number(stage.futureStartTimestamp) > 0
        ? Number(stage.futureStartTimestamp)
        : undefined,
  };
}

/**
 * Whitelist a store from an untrusted draft. Media files cannot travel in a JSON draft, so an
 * item arrives as its already-pinned URIs; everything else is clamped to the shapes the create
 * form and the tier encoder accept.
 */
function sanitizeStore(value: unknown): RevnetFormData["store"] {
  const raw = (value ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  const bool = (key: string, fallback: boolean) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;
  return {
    ...defaultStoreData,
    collectionName: text(raw.collectionName, 100),
    collectionSymbol: text(raw.collectionSymbol, 32),
    pricing: raw.pricing === "USD" ? "USD" : "reserve",
    categories: categories.slice(0, 32).flatMap((entry) => {
      const category = (entry ?? {}) as Record<string, unknown>;
      const id = Number(category.id);
      const name = text(category.name, 64);
      return Number.isSafeInteger(id) && id > 0 && name ? [{ id, name }] : [];
    }),
    items: items.slice(0, 64).map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const splits = Array.isArray(item.splits) ? item.splits : [];
      const perChainSupply = (item.perChainSupply ?? {}) as Record<string, unknown>;
      return {
        ...newDraftItem(),
        name: text(item.name, 100),
        description: text(item.description, 2_000),
        mediaUri: text(item.mediaUri, 500),
        uri: text(item.uri, 500),
        price: numericText(item.price),
        supply: numericText(item.supply),
        category: numericText(item.category) || "0",
        reserveFrequency: numericText(item.reserveFrequency),
        reserveBeneficiary: text(item.reserveBeneficiary, 64),
        discountPct: numericText(item.discountPct),
        votingUnits: numericText(item.votingUnits),
        splits: splits.slice(0, 16).map((splitValue) => {
          const split = (splitValue ?? {}) as Record<string, unknown>;
          return {
            percent: numericText(split.percent),
            beneficiary: text(split.beneficiary, 64),
          };
        }),
        allowOwnerMint: item.allowOwnerMint === true,
        cantBeRemoved: item.cantBeRemoved === true,
        allowCredits: item.allowCredits !== false,
        operatorCanEditDiscount: item.operatorCanEditDiscount !== false,
        nonTransferable: item.nonTransferable === true,
        perChainSupply: Object.fromEntries(
          Object.entries(perChainSupply)
            .filter(([chainId]) => Number.isSafeInteger(Number(chainId)) && Number(chainId) > 0)
            .slice(0, 16)
            .map(([chainId, supply]) => [
              Number(chainId),
              String(supply).trim().toLowerCase() === "unlimited"
                ? "unlimited"
                : numericText(supply),
            ]),
        ),
      };
    }),
    preventOverspending: bool("preventOverspending", false),
    noNewTiersWithReserves: bool("noNewTiersWithReserves", false),
    noNewTiersWithVotes: bool("noNewTiersWithVotes", false),
    noNewTiersWithOwnerMinting: bool("noNewTiersWithOwnerMinting", false),
    operatorCanAdjustTiers: bool("operatorCanAdjustTiers", true),
    operatorCanUpdateMetadata: bool("operatorCanUpdateMetadata", true),
    operatorCanMint: bool("operatorCanMint", true),
    operatorCanIncreaseDiscount: bool("operatorCanIncreaseDiscount", true),
  };
}

/** Parse an untrusted Revnet .jb file into whitelisted create-form values. */
export function parseRevnetDraft(source: string): RevnetFormData {
  if (source.length > MAX_DRAFT_BYTES) throw new Error("That file is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("That doesn't look like a .jb file.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("That doesn't look like a .jb file.");
  }
  const root = parsed as Record<string, unknown>;
  const raw =
    root.app === "revnet.money" && root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  if (!Array.isArray(raw.stages) || typeof raw.name !== "string") {
    throw new Error("No Revnet create draft was found in that file.");
  }
  const reserveAsset = ["ETH", "USDC", "ETH_USDC", "CUSTOM"].includes(String(raw.reserveAsset))
    ? (raw.reserveAsset as RevnetFormData["reserveAsset"])
    : "ETH";
  const custom = (raw.customReserveAsset ?? {}) as Record<string, unknown>;
  const chainIds = (Array.isArray(raw.chainIds) ? raw.chainIds : [])
    .slice(0, 16)
    .map(Number)
    .filter((chainId) => Number.isSafeInteger(chainId) && chainId > 0) as JBChainId[];
  const operators = Array.isArray(raw.operator) ? raw.operator : [];
  return {
    ...DEFAULT_FORM_DATA,
    name: text(raw.name, 100),
    description: text(raw.description, 10_000),
    logoUri: text(raw.logoUri, 500),
    twitter: text(raw.twitter, 200),
    telegram: text(raw.telegram, 200),
    discord: text(raw.discord, 200),
    infoUri: text(raw.infoUri, 500),
    tokenSymbol: text(raw.tokenSymbol, 32),
    stages: raw.stages.slice(0, 32).map(sanitizeStage),
    chainIds,
    operator: operators.slice(0, 16).flatMap((value) => {
      const item = (value ?? {}) as Record<string, unknown>;
      const chainId = Number(item.chainId);
      const address = text(item.address, 64);
      return Number.isSafeInteger(chainId) && chainId > 0 && address
        ? [{ chainId: String(chainId), address }]
        : [];
    }),
    reserveAsset,
    issuanceBaseCurrency: raw.issuanceBaseCurrency === "USD" ? "USD" : "ETH",
    store: sanitizeStore(raw.store),
    customReserveAsset: {
      address: text(custom.address, 64),
      symbol: text(custom.symbol, 32),
      decimals:
        Number.isInteger(Number(custom.decimals)) && Number(custom.decimals) >= 0
          ? Number(custom.decimals)
          : null,
      verifiedChainIds: (Array.isArray(custom.verifiedChainIds) ? custom.verifiedChainIds : [])
        .slice(0, 16)
        .map(Number)
        .filter((chainId) => Number.isSafeInteger(chainId) && chainId > 0) as JBChainId[],
    },
  };
}

function slug(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "revnet"
  );
}

export function revnetDraftFileName(name: string): string {
  return `${slug(name)}.jb`;
}

/**
 * Reconstruct the full configured stage history from the source chain.
 * Per-chain operator/split differences are surfaced as warnings.
 */
export async function buildRevnetDraft({
  client,
  chainId,
  projectId,
  projects,
  operator,
  metadata,
  tokenSymbol,
  autoIssuances,
}: {
  client: PublicClient;
  chainId: JBChainId;
  projectId: bigint;
  projects: { chainId: number; projectId: number }[];
  operator: Address;
  metadata: Record<string, unknown>;
  tokenSymbol: string;
  autoIssuances: Array<{
    stageIndex: number;
    count: string | number;
    beneficiary: string;
    chainId: number;
  }>;
}): Promise<RevnetDraftResult> {
  const rulesets = (
    await readAllProjectRulesets(
      client,
      getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId),
      projectId,
    )
  ).reverse();
  if (!rulesets.length) throw new Error("No deployed stages could be verified.");

  const controller = getJBContractAddress(JBCoreContracts.JBController, 6, chainId);
  const splitsAddress = getJBContractAddress(JBCoreContracts.JBSplits, 6, chainId);
  const stageReads = await Promise.all(
    rulesets.map(async (ruleset) => {
      const [decoded, splits] = await Promise.all([
        client.readContract({
          address: controller,
          abi: jbControllerAbi,
          functionName: "getRulesetOf",
          args: [projectId, BigInt(ruleset.id)],
        }),
        client.readContract({
          address: splitsAddress,
          abi: jbSplitsAbi,
          functionName: "splitsOf",
          args: [projectId, BigInt(ruleset.id), RESERVED_TOKEN_SPLIT_GROUP_ID],
        }) as Promise<readonly RawSplit[]>,
      ]);
      const pair = decoded as unknown as [unknown, RulesetMetadata];
      return { ruleset, metadata: pair[1], splits };
    }),
  );

  const contexts = await getAccountingContexts(client, { chainId, projectId });
  if (!contexts.length) throw new Error("No reserve asset could be verified.");
  const hasEth = contexts.some(
    (context) => context.token.toLowerCase() === NATIVE_TOKEN.toLowerCase(),
  );
  const hasUsdc = contexts.some(
    (context) => context.token.toLowerCase() === USDC_ADDRESSES[chainId].toLowerCase(),
  );
  const custom = contexts.filter(
    (context) =>
      context.token.toLowerCase() !== NATIVE_TOKEN.toLowerCase() &&
      context.token.toLowerCase() !== USDC_ADDRESSES[chainId].toLowerCase(),
  );
  if (custom.length > 1 || (custom.length && contexts.length > 1)) {
    throw new Error("This reserve-asset combination cannot be reproduced by the create flow.");
  }
  const customSymbol = custom[0]
    ? await client
        .readContract({
          address: custom[0].token,
          abi: [
            {
              name: "symbol",
              type: "function",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "string" }],
            },
          ],
          functionName: "symbol",
        })
        .catch(() => "")
    : "";

  const warnings: string[] = [];
  warnings.push(
    "Shop inventory added after deployment is not part of this file; the new revnet starts with an empty shop.",
  );
  if (projects.length > 1) {
    warnings.push(
      "Stages and split beneficiaries were reconstructed from this chain. Review the per-chain operator, beneficiaries, and reserve assets before redeploying.",
    );
  }
  const stages: StageData[] = stageReads.map((entry, index) => {
    const reservedPercent = Number(entry.metadata.reservedPercent) / 100;
    const startDeltaDays =
      index === 0
        ? 0
        : Math.max(
            0,
            (Number(entry.ruleset.start) - Number(stageReads[index - 1].ruleset.start)) / 86_400,
          );
    const splits = entry.splits.map((split) => {
      if (
        split.projectId > 0n ||
        split.hook.toLowerCase() !== zeroAddress ||
        split.preferAddToBalance ||
        Number(split.lockedUntil) > 0
      ) {
        throw new Error(
          "A deployed reserved-token split uses routing or locking the Revnet create flow cannot reproduce.",
        );
      }
      return {
        percentage: String(
          Number((reservedPercent * (Number(split.percent) / SPLITS_TOTAL)).toFixed(6)),
        ),
        defaultBeneficiary: split.beneficiary,
      };
    });
    const stored = autoIssuances
      .filter((row) => row.stageIndex === index)
      .map((row) => ({
        amount: formatUnits(BigInt(String(row.count).split(".")[0] || "0"), 18),
        beneficiary: row.beneficiary,
        chainId: row.chainId as JBChainId,
      }));
    const inherits = BigInt(entry.ruleset.weight) === RULESET_WEIGHT_INHERIT;
    return {
      initialIssuance: inherits ? "" : formatUnits(BigInt(entry.ruleset.weight), 18),
      pickUpFromPrevious: inherits,
      priceCeilingIncreasePercentage: String(
        Number((Number(entry.ruleset.weightCutPercent) / 10_000_000).toFixed(6)),
      ),
      priceCeilingIncreaseFrequency: String(
        Number((Number(entry.ruleset.duration) / 86_400).toFixed(6)),
      ),
      priceFloorTaxIntensity: String(
        Number((Number(entry.metadata.cashOutTaxRate) / 100).toFixed(2)),
      ),
      extraMetadata: Number(entry.metadata.metadata ?? 0),
      autoIssuance: stored,
      splits,
      stageStart: String(Number(startDeltaDays.toFixed(6))),
    };
  });

  const chainIds = projects.map((project) => project.chainId as JBChainId);
  const reserveAsset: RevnetFormData["reserveAsset"] = custom.length
    ? "CUSTOM"
    : hasEth && hasUsdc
      ? "ETH_USDC"
      : hasUsdc
        ? "USDC"
        : "ETH";
  const data: RevnetFormData = {
    ...DEFAULT_FORM_DATA,
    name: typeof metadata.name === "string" ? metadata.name : "",
    description: typeof metadata.description === "string" ? metadata.description : "",
    logoUri: typeof metadata.logoUri === "string" ? metadata.logoUri : "",
    twitter: typeof metadata.twitter === "string" ? metadata.twitter : "",
    telegram: typeof metadata.telegram === "string" ? metadata.telegram : "",
    discord: typeof metadata.discord === "string" ? metadata.discord : "",
    infoUri: typeof metadata.infoUri === "string" ? metadata.infoUri : "",
    tokenSymbol,
    stages,
    chainIds,
    operator: chainIds.map((id) => ({ chainId: String(id), address: operator })),
    reserveAsset,
    issuanceBaseCurrency: Number(stageReads[0].metadata.baseCurrency) === 2 ? "USD" : "ETH",
    customReserveAsset: {
      address: custom[0]?.token ?? "",
      symbol: String(customSymbol || ""),
      decimals: custom[0]?.decimals ?? null,
      verifiedChainIds: custom.length ? [chainId] : [],
    },
  };
  return { file: { v: 1, app: "revnet.money", data }, warnings };
}
