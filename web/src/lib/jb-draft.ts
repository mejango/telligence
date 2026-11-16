import { PERMANENTLY_DISABLED_OPERATOR } from "@/app/create/constants";
import {
  getResolvedIssuance,
  getStageCutFrequencySeconds,
} from "@/app/create/helpers/calculatePickupIssuance";
import { storeIdentity } from "@/app/create/helpers/parseDeployData";
import type { RevnetFormData, SplitDraft, StageData } from "@/app/create/types";
import type { DraftItem } from "@/components/shop/itemDraft";
import { parseRevnetDraft } from "@/lib/revnet-draft";
import { isStickyRow, stickyGroupOf } from "@/lib/sticky";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  JbDraftError,
  emptyJbDraft,
  emptyJbDraftItem,
  emptyJbDraftSplit,
  emptyJbDraftStage,
  jbDraftDecimal,
  jbDraftUnsupported,
  parseJbDraft,
  serializeJbDraft,
  type JbDraft,
  type JbDraftChainMap,
  type JbDraftCurrency,
  type JbDraftItem,
  type JbDraftSplit,
  type JbDraftStage,
} from "@bananapus/nana-sdk-core/v6";

/**
 * The shared `.jb` file (the SDK's version 2 format) to and from the create form. The form's
 * own values stay the browser's saved draft; only files cross here. This site launches
 * revnets, so it reads revnet files, and refuses one holding what its form cannot express.
 */

const SITE = "revnet.money";
const refuse = (what: string): never => {
  throw jbDraftUnsupported(SITE, what);
};

type Token = JbDraft["accepts"][number];
const ACCEPTS: Record<RevnetFormData["reserveAsset"], Token[]> = {
  ETH: ["eth"],
  USDC: ["usdc"],
  ETH_USDC: ["eth", "usdc"],
  CUSTOM: ["custom"],
};

/** A typed number as the format's plain decimal, or "" when it isn't one. */
const num = (value: unknown): string => jbDraftDecimal(String(value ?? ""));

/** Move a decimal's point without a float: "20" by -2 is "0.2", "0.1234" by 2 is "12.34". */
export function shiftDecimal(value: string, places: number): string {
  if (value === "") return "";
  const [whole = "", fraction = ""] = value.split(".");
  let digits = whole + fraction;
  let point = whole.length + places;
  if (point < 1) {
    digits = "0".repeat(1 - point) + digits;
    point = 1;
  }
  digits = digits.padEnd(point, "0");
  const left = digits.slice(0, point).replace(/^0+(?=\d)/u, "") || "0";
  const right = digits.slice(point).replace(/0+$/u, "");
  return right ? `${left}.${right}` : left;
}

function splitOut(row: SplitDraft): JbDraftSplit {
  if (isStickyRow(row)) {
    const group = stickyGroupOf(row);
    return {
      ...emptyJbDraftSplit("sticky"),
      share: num(row.percentage),
      address: row.defaultBeneficiary.trim(),
      sticky: {
        group: group.stickyGroup,
        minWeeks: num(group.stickyMinWeeks),
        maxWeeks: num(group.stickyMaxWeeks),
      },
    };
  }
  return {
    ...emptyJbDraftSplit(),
    share: num(row.percentage),
    address: row.defaultBeneficiary.trim(),
    addressPerChain: Object.fromEntries(
      (row.beneficiary ?? [])
        .filter((entry) => Number(entry.chainId) > 0 && entry.address.trim())
        .map((entry) => [Number(entry.chainId), entry.address.trim()]),
    ),
  };
}

function itemOut(item: DraftItem): JbDraftItem {
  // A chosen file that has not reached IPFS yet would be left out of the draft.
  if (item.mediaFile && !item.mediaUri.trim() && !item.uri.trim()) {
    throw new JbDraftError("An item's media is still uploading. Export once it finishes.");
  }
  return {
    ...emptyJbDraftItem(),
    name: item.name,
    description: item.description,
    mediaUri: item.mediaUri.trim(),
    mediaType: item.mediaType,
    metadataUri: item.uri.trim(),
    price: num(item.price),
    supply: num(item.supply),
    supplyPerChain: Object.fromEntries(
      Object.entries(item.perChainSupply)
        .map(([chainId, supply]) => {
          const typed = String(supply).trim().toLowerCase();
          return [chainId, typed === "unlimited" ? typed : num(typed)] as const;
        })
        .filter(([chainId, supply]) => Number(chainId) > 0 && supply !== ""),
    ),
    discountPercent: num(item.discountPct),
    reserveEvery: num(item.reserveFrequency),
    reserveBeneficiary: item.reserveBeneficiary.trim(),
    category: Number(item.category) || 0,
    // The tier encoder always sends zero voting units, so the file states none.
    splits: item.splits.map((row) => ({
      ...emptyJbDraftSplit(),
      share: num(row.percent),
      address: row.beneficiary.trim(),
    })),
    allowOwnerMint: item.allowOwnerMint,
    // The collection gate is closed for good, so "pausable" is "cannot move".
    transfersPausable: item.nonTransferable,
    cantBeRemoved: item.cantBeRemoved,
    allowCredits: item.allowCredits,
    ownerCanEditDiscount: item.operatorCanEditDiscount,
  };
}

/** Write the create form's values as the shared file's contents. */
export function toJbDraft(values: RevnetFormData): JbDraft {
  const accepts = ACCEPTS[values.reserveAsset];
  const base: JbDraftCurrency =
    values.reserveAsset === "CUSTOM"
      ? "token"
      : values.issuanceBaseCurrency === "USD"
        ? "usd"
        : "eth";
  // A chain's operator is its own entry, or the one named on the first stage.
  const fallback = values.stages[0]?.initialOperator?.trim() ?? "";
  const operators = values.operator.filter((entry) => entry.address.trim());
  const perChain = values.chainIds.map(
    (chainId) =>
      operators.find((entry) => Number(entry.chainId) === Number(chainId))?.address.trim() ??
      fallback,
  );
  const uniform = perChain.every((address) => address === perChain[0]);

  const stageOut = (stage: StageData, index: number): JbDraftStage => {
    const previous = values.stages[index - 1];
    const previousCycle = previous ? getStageCutFrequencySeconds(previous) : 0;
    const cycle = getStageCutFrequencySeconds(stage);
    return {
      ...emptyJbDraftStage("revnet", accepts),
      baseCurrency: base,
      startAt: index === 0 ? Number(stage.futureStartTimestamp) || 0 : 0,
      // "After N cuts" is that many of the stage before's cycles, written as days.
      startAfterDays:
        index === 0
          ? ""
          : stage.stageStartCuts && previousCycle > 0
            ? String((Number(stage.stageStartCuts) * previousCycle) / 86_400)
            : num(stage.stageStart),
      issuance: stage.pickUpFromPrevious && index > 0 ? "" : num(stage.initialIssuance),
      // No cycle means no cuts, whatever percent is still typed.
      cutPercent: cycle > 0 ? num(stage.priceCeilingIncreasePercentage) : "",
      cutDays: cycle > 0 ? num(stage.priceCeilingIncreaseFrequency) : "",
      cashOutTax: shiftDecimal(num(stage.priceFloorTaxIntensity), -2),
      reserved: stage.splits.map(splitOut),
      autoIssuances: stage.autoIssuance.map((row) => ({
        count: num(row.amount),
        address: row.beneficiary.trim(),
        chainId: Number(row.chainId),
      })),
      metadataExtra: stage.extraMetadata ?? 0,
    };
  };

  const { pricing, items, categories, ...store } = values.store;
  return {
    ...emptyJbDraft("revnet", accepts),
    name: values.name,
    ticker: values.tokenSymbol,
    description: values.description,
    logoUri: values.logoUri ?? "",
    links: {
      website: values.infoUri ?? "",
      twitter: values.twitter ?? "",
      discord: values.discord ?? "",
      telegram: values.telegram ?? "",
      instagram: "",
      whatsapp: "",
    },
    chains: values.chainIds.map(Number),
    // With every chain named, nothing is left for a stand-in to cover.
    owner: uniform
      ? (perChain[0] ?? fallback)
      : operators.length >= values.chainIds.length
        ? ""
        : fallback,
    ownerPerChain: uniform
      ? {}
      : Object.fromEntries(operators.map((entry) => [Number(entry.chainId), entry.address.trim()])),
    customToken: values.reserveAsset === "CUSTOM" ? values.customReserveAsset.address.trim() : "",
    stages: values.stages.map(stageOut),
    shop: {
      ...emptyJbDraft("revnet", accepts).shop,
      ...store,
      collectionName: storeIdentity(values).name,
      collectionSymbol: storeIdentity(values).symbol,
      currency: pricing === "USD" ? "usd" : base,
      categories,
      items: items.map(itemOut),
    },
  };
}

/** The text of a `.jb` file for the create form's values. */
export function writeJbDraftFile(values: RevnetFormData): string {
  return serializeJbDraft(toJbDraft(values));
}

const hasEntries = (map: JbDraftChainMap) => Object.keys(map).length > 0;

function splitIn(row: JbDraftSplit): SplitDraft {
  if (row.to !== "address" && row.to !== "sticky") refuse("a split to a project or a hook");
  if (row.lockedUntil > 0) refuse("a locked split");
  if (row.to === "sticky") {
    if (hasEntries(row.addressPerChain)) refuse("a Sticky split that differs by chain");
    return {
      percentage: row.share,
      defaultBeneficiary: row.address,
      kind: "hook",
      hookKind: "sticky",
      stickyGroup: row.sticky!.group,
      stickyMinWeeks: row.sticky!.minWeeks,
      stickyMaxWeeks: row.sticky!.maxWeeks,
      beneficiary: [],
    };
  }
  return {
    percentage: row.share,
    defaultBeneficiary: row.address,
    beneficiary: Object.entries(row.addressPerChain).map(([chainId, address]) => ({
      chainId: Number(chainId) as JBChainId,
      address,
    })),
  };
}

function itemIn(item: JbDraftItem): Omit<DraftItem, "mediaFile" | "mediaPreview"> {
  if (Number(item.votingUnits) > 0) refuse("a shop item with voting units");
  if (item.excludedChains.length) refuse("a shop item left off some chains");
  if (hasEntries(item.reserveBeneficiaryPerChain)) {
    refuse("a reserved item beneficiary that differs by chain");
  }
  return {
    name: item.name,
    description: item.description,
    mediaUri: item.mediaUri,
    mediaType: item.mediaType,
    uri: item.metadataUri,
    price: item.price,
    supply: item.supply,
    category: String(item.category),
    reserveFrequency: item.reserveEvery,
    reserveBeneficiary: item.reserveBeneficiary,
    discountPct: item.discountPercent,
    votingUnits: "",
    splits: item.splits.map((row) => {
      if (row.to !== "address") refuse("a shop item split to a project or a hook");
      if (hasEntries(row.addressPerChain)) refuse("a shop item split that differs by chain");
      if (row.lockedUntil > 0) refuse("a locked split");
      return { percent: row.share, beneficiary: row.address };
    }),
    allowOwnerMint: item.allowOwnerMint,
    cantBeRemoved: item.cantBeRemoved,
    allowCredits: item.allowCredits,
    operatorCanEditDiscount: item.ownerCanEditDiscount,
    nonTransferable: item.transfersPausable,
    moreOpen: false,
    perChainSupply: { ...item.supplyPerChain },
    perChainSupplyOpen: false,
  };
}

/** Keys the form sets for its own display or cannot save, not part of what a draft says. */
const DISPLAY_KEYS = new Set(["mediaFile", "mediaPreview", "moreOpen", "perChainSupplyOpen"]);
/** What a draft says, whatever order its keys were written in. */
const said = (value: unknown): string =>
  JSON.stringify(value, (key, entry) =>
    DISPLAY_KEYS.has(key)
      ? undefined
      : entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : entry,
  );

/** Read the shared file's contents into the create form's values, or refuse it whole. */
export function fromJbDraft(file: JbDraft): RevnetFormData {
  if (file.kind !== "revnet") {
    throw new JbDraftError("This file is a project. revnet.money launches revnets.");
  }
  if (file.tagline) refuse("a tagline");
  if (file.tags.length) refuse("tags");
  if (file.payNotice) refuse("a payment notice");
  if (file.coverUri) refuse("a cover image");
  if (file.links.instagram || file.links.whatsapp) refuse("an Instagram or WhatsApp link");
  if (file.safe) refuse("a new Safe as the operator");
  if (file.chains.length > 1 && !file.linkChains) refuse("chains that are not linked");
  if (file.chains.length > 1 && file.bridge !== "ccip") refuse("a bridge other than CCIP");

  const reserveAsset = (Object.keys(ACCEPTS) as RevnetFormData["reserveAsset"][]).find(
    (asset) => ACCEPTS[asset].join() === file.accepts.join(),
  );
  if (!reserveAsset) return refuse("a set of accepted tokens this form does not offer");
  const custom = reserveAsset === "CUSTOM";
  if (custom !== (file.customToken !== "")) refuse("a custom token without its address");
  const base = file.stages[0].baseCurrency;
  if (file.stages.some((stage) => stage.baseCurrency !== base)) {
    refuse("stages priced in different currencies");
  }
  if (custom && base !== "token") refuse("issuance priced in another currency than its token");
  if (file.shop.currency !== base && file.shop.currency !== "usd") {
    refuse("a shop priced in another currency than issuance");
  }

  // The form switches the operator on or off for every chain at once, and reads which from the
  // first stage's stand-in. So every chain is named outright, and the stand-in agrees with them.
  const isOff = (address: string) => address.trim().toLowerCase() === PERMANENTLY_DISABLED_OPERATOR;
  const operators = file.chains.map((chainId) => file.ownerPerChain[chainId] || file.owner);
  const off = operators.filter(isOff);
  if (off.length > 0 && off.length < operators.length) {
    refuse("an operator switched off on some chains only");
  }
  const named = Object.keys(file.ownerPerChain).length > 0;
  const standIn = !named
    ? file.owner
    : off.length
      ? PERMANENTLY_DISABLED_OPERATOR
      : operators.find(Boolean);

  const stageIn = (stage: JbDraftStage, index: number): StageData => {
    const cycle = Number(stage.cutDays) > 0;
    return {
      // The first stage's operator stands in on a chain with no entry of its own.
      ...(index === 0 && standIn ? { initialOperator: standIn } : {}),
      initialIssuance: stage.issuance,
      pickUpFromPrevious: index > 0 && stage.issuance === "",
      priceCeilingIncreasePercentage: cycle ? stage.cutPercent || "0" : "0",
      priceCeilingIncreaseFrequency: cycle ? stage.cutDays : "0",
      priceFloorTaxIntensity: shiftDecimal(stage.cashOutTax || "0", 2),
      extraMetadata: stage.metadataExtra,
      autoIssuance: stage.autoIssuances.map((row) => ({
        amount: row.count,
        beneficiary: row.address,
        chainId: row.chainId as JBChainId,
      })),
      splits: stage.reserved.map(splitIn),
      stageStart: index === 0 ? "0" : stage.startAfterDays || "0",
      ...(index === 0 && stage.startAt > 0 ? { futureStartTimestamp: stage.startAt } : {}),
    };
  };

  const {
    currency,
    categories,
    items,
    issueTokensForSplits: _a,
    itemsRedeem: _b,
    ...store
  } = file.shop;
  const built = {
    name: file.name,
    description: file.description,
    logoUri: file.logoUri,
    twitter: file.links.twitter,
    telegram: file.links.telegram,
    discord: file.links.discord,
    infoUri: file.links.website,
    tokenSymbol: file.ticker,
    // A stage that picks up shows the issuance it will inherit, as the form does.
    stages: file.stages.map(stageIn).map((stage, index, stages) => ({
      ...stage,
      initialIssuance: getResolvedIssuance(stage, index, stages),
    })),
    chainIds: file.chains as JBChainId[],
    operator: named
      ? file.chains.map((chainId, n) => ({ chainId: String(chainId), address: operators[n] }))
      : [],
    reserveAsset,
    issuanceBaseCurrency: base === "usd" ? "USD" : "ETH",
    customReserveAsset: {
      address: file.customToken,
      symbol: "",
      decimals: null,
      verifiedChainIds: [],
    },
    store: {
      ...store,
      pricing: currency === base ? "reserve" : "USD",
      categories,
      items: items.map(itemIn),
    },
  } satisfies Omit<RevnetFormData, "store"> & { store: object };
  // The form's own reader caps and cleans what it holds. A value it would change is one
  // this form cannot keep, so the file is refused, not trimmed. A start that has passed
  // is the one thing it resets, to a date still to choose.
  const kept = parseRevnetDraft(JSON.stringify(built));
  const start = { futureStartTimestamp: undefined };
  const firstStage = (form: { stages: object[] }) => [
    { ...form.stages[0], ...start },
    ...form.stages.slice(1),
  ];
  if (
    said({ ...kept, stages: firstStage(kept) }) !== said({ ...built, stages: firstStage(built) })
  ) {
    refuse("a value longer than this form holds");
  }
  return kept;
}

/** Read the text of a `.jb` file into the create form's values. Throws a message to show. */
export function readJbDraftFile(text: string): RevnetFormData {
  return fromJbDraft(parseJbDraft(text));
}
