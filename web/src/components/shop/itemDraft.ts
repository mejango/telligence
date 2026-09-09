"use client";

import { encodeIpfsCid, TIER_UNLIMITED_SUPPLY } from "@/app/[slug]/components/v6/shop/shopLib";
import { pinJsonMetadata, pinMediaFile } from "@/app/create/helpers/pinProjectMetaData";
import { cidFromIpfsUri } from "@/lib/ipfs";
import { JBCENTER_MAX_MEDIA_BYTES } from "@/lib/jbcenter-ipfs";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { fillSplitPercents } from "@bananapus/nana-sdk-core/v6";
import { Address, Hex, isAddress, parseUnits, zeroAddress } from "viem";

/**
 * The shop item draft, shared by the two places items are written: the create flow's store
 * section, which encodes them into the launch's 721 hook config, and the operator's "Add items"
 * modal, which encodes them for `adjustTiers` on a live hook. One encoder for both, so a
 * collection cannot be stocked differently from how it was deployed.
 */
interface DraftSplit {
  percent: string;
  beneficiary: string;
}

export interface DraftItem {
  name: string;
  description: string;
  mediaUri: string;
  mediaFile: File | null;
  mediaPreview: string | null;
  /** ipfs:// URI (or bare DAG-PB CID) of the item's metadata JSON. Optional. */
  uri: string;
  price: string;
  /** Empty = unlimited. */
  supply: string;
  category: string;
  reserveFrequency: string;
  reserveBeneficiary: string;
  discountPct: string;
  votingUnits: string;
  splits: DraftSplit[];
  allowOwnerMint: boolean;
  cantBeRemoved: boolean;
  allowCredits: boolean;
  operatorCanEditDiscount: boolean;
  nonTransferable: boolean;
  moreOpen: boolean;
  /** Per-chain quantity overrides, keyed by chain id. '' = use `supply`; "unlimited" allowed.
   *  Only the create flow sets these — a live hook is stocked one chain at a time. */
  perChainSupply: Record<number, string>;
  perChainSupplyOpen: boolean;
}

export function newDraftItem(): DraftItem {
  return {
    name: "",
    description: "",
    mediaUri: "",
    mediaFile: null,
    mediaPreview: null,
    uri: "",
    price: "",
    supply: "",
    category: "0",
    reserveFrequency: "",
    reserveBeneficiary: "",
    discountPct: "",
    votingUnits: "",
    splits: [],
    allowOwnerMint: false,
    cantBeRemoved: false,
    allowCredits: true,
    operatorCanEditDiscount: true,
    nonTransferable: false,
    moreOpen: false,
    perChainSupply: {},
    perChainSupplyOpen: false,
  };
}

const MAX_UINT104 = (1n << 104n) - 1n;
/** Pinning service ceiling; the editors refuse a larger file before upload. */
export const MAX_MEDIA_BYTES = JBCENTER_MAX_MEDIA_BYTES;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

type TierConfig = {
  price: bigint;
  initialSupply: number;
  votingUnits: number;
  reserveFrequency: number;
  reserveBeneficiary: Address;
  encodedIpfsUri: Hex;
  category: number;
  discountPercent: number;
  flags: {
    allowOwnerMint: boolean;
    useReserveBeneficiaryAsDefault: boolean;
    transfersPausable: boolean;
    useVotingUnits: boolean;
    cantBeRemoved: boolean;
    cantIncreaseDiscountPercent: boolean;
    cantBuyWithCredits: boolean;
  };
  splitPercent: number;
  splits: {
    percent: number;
    projectId: bigint;
    beneficiary: Address;
    preferAddToBalance: boolean;
    lockedUntil: number;
    hook: Address;
  }[];
};

/**
 * Validate the drafts and build the `adjustTiers` tier configs.
 *
 * Two order-sensitive store rules are handled here:
 * - tiers must be sorted by ascending category (`InvalidCategorySortOrder`);
 * - `recordAddTiers` validates each tier strictly IN ARRAY ORDER, so a tier
 *   with `reserveFrequency > 0` and no beneficiary reverts with
 *   `MissingReserveBeneficiary` unless a default was set BEFORE it. We avoid
 *   the trap at the root by requiring an explicit per-tier beneficiary for
 *   every reserved tier (`useReserveBeneficiaryAsDefault` stays false).
 */
export function buildTierConfigs(
  items: DraftItem[],
  decimals: number,
  /** When given, each item's override for this chain wins over its default quantity. */
  chainId?: JBChainId,
): TierConfig[] | string {
  const configs: TierConfig[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const label = items.length > 1 ? `Item ${i + 1}: ` : "";

    let price: bigint;
    try {
      price = parseUnits(item.price.trim(), decimals);
    } catch {
      return `${label}enter a valid price.`;
    }
    if (price < 0n || price > MAX_UINT104) return `${label}the price must fit uint104.`;

    const override = chainId === undefined ? "" : (item.perChainSupply?.[chainId] ?? "").trim();
    const supplyStr = override === "unlimited" ? "" : override || item.supply.trim();
    if (supplyStr !== "" && !/^\d+$/.test(supplyStr)) {
      return `${label}the supply must be a whole number (or empty for unlimited).`;
    }
    const initialSupply = supplyStr === "" ? TIER_UNLIMITED_SUPPLY : Number(supplyStr);
    if (initialSupply <= 0 || initialSupply > TIER_UNLIMITED_SUPPLY) {
      return `${label}the supply must be between 1 and ${TIER_UNLIMITED_SUPPLY.toLocaleString("en-US")}, or empty for unlimited.`;
    }

    const categoryStr = item.category.trim() || "0";
    if (!/^\d+$/.test(categoryStr) || Number(categoryStr) > 0xffffff) {
      return `${label}the category must be a number that fits uint24.`;
    }
    const category = Number(categoryStr);

    const reserveStr = item.reserveFrequency.trim() || "0";
    if (!/^\d+$/.test(reserveStr) || Number(reserveStr) > 0xffff) {
      return `${label}the reserve frequency must fit uint16.`;
    }
    const reserveFrequency = Number(reserveStr);
    let reserveBeneficiary: Address = zeroAddress;
    if (reserveFrequency > 0) {
      if (initialSupply === 1) {
        return `${label}a reserved item needs a supply of at least 2 (or unlimited).`;
      }
      if (!isAddress(item.reserveBeneficiary.trim())) {
        return `${label}enter a reserve beneficiary address (required when a reserve frequency is set).`;
      }
      reserveBeneficiary = item.reserveBeneficiary.trim() as Address;
    }

    const votingStr = item.votingUnits.trim() || "0";
    if (!/^\d+$/.test(votingStr) || BigInt(votingStr) > 0xffffffffn) {
      return `${label}voting units must be a whole number that fits uint32.`;
    }
    const votingUnits = Number(votingStr);

    const discountText = item.discountPct.trim() || "0";
    const discountPct = Number(discountText);
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      return `${label}the discount must be between 0 and 100%.`;
    }
    const discountPercent = Math.round(discountPct * 2);

    const validSplits = item.splits.filter(
      (split) => split.percent.trim() || split.beneficiary.trim(),
    );
    const splitValues: number[] = [];
    for (let splitIndex = 0; splitIndex < validSplits.length; splitIndex++) {
      const split = validSplits[splitIndex];
      const percent = Number(split.percent);
      if (!Number.isFinite(percent) || percent <= 0) {
        return `${label}split ${splitIndex + 1} needs a percentage above 0.`;
      }
      if (!isAddress(split.beneficiary.trim())) {
        return `${label}split ${splitIndex + 1} needs a valid beneficiary address.`;
      }
      splitValues.push(percent);
    }
    const totalSplitPct = splitValues.reduce((total, value) => total + value, 0);
    if (totalSplitPct > 100) return `${label}sales splits cannot add up to more than 100%.`;
    // Each row's share of the sales bucket, out of SPLITS_TOTAL_PERCENT (1e9). A row so
    // small it rounds to zero would be encoded as a split that can never pay anything, so
    // it is rejected here rather than written into the tier.
    const roundedShares = splitValues.map((value) => Math.round((value / totalSplitPct) * 1e9));
    const tooSmall = roundedShares.findIndex((share) => share < 1);
    if (tooSmall !== -1) {
      return `${label}split ${tooSmall + 1} is too small a share of the other splits to encode.`;
    }
    // `fillSplitPercents` assigns the rounding remainder to the LARGEST row, so the group
    // sums to exactly 1e9 (JBSplits reverts otherwise) and no row can be driven to zero or
    // negative — which absorbing the remainder into the last-entered row could do.
    let splitPercents: number[];
    try {
      splitPercents = fillSplitPercents(roundedShares);
    } catch {
      return `${label}the sales splits could not be encoded — check each split's percentage.`;
    }
    const splits = validSplits.map((split, splitIndex) => ({
      percent: splitPercents[splitIndex],
      projectId: 0n,
      beneficiary: split.beneficiary.trim() as Address,
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: zeroAddress,
    }));

    let encodedIpfsUri: Hex = ZERO_BYTES32;
    const uri = item.uri.trim();
    if (uri) {
      const cid = uri.startsWith("ipfs://") ? cidFromIpfsUri(uri) : uri;
      if (!cid) return `${label}the metadata URI must contain an IPFS CID.`;
      try {
        encodedIpfsUri = encodeIpfsCid(cid);
      } catch {
        return `${label}the metadata must use a DAG-PB CIDv0 or CIDv1 without a path.`;
      }
    }

    configs.push({
      price,
      initialSupply,
      votingUnits,
      reserveFrequency,
      reserveBeneficiary,
      encodedIpfsUri,
      category,
      discountPercent,
      flags: {
        allowOwnerMint: item.allowOwnerMint,
        useReserveBeneficiaryAsDefault: false,
        // Every stage in a newly deployed revnet keeps the collection-level
        // transfer gate closed. This immutable tier flag therefore means
        // exactly "non-transferable", never "possibly paused later".
        transfersPausable: item.nonTransferable,
        useVotingUnits: votingUnits > 0,
        cantBeRemoved: item.cantBeRemoved,
        cantIncreaseDiscountPercent: !item.operatorCanEditDiscount,
        cantBuyWithCredits: !item.allowCredits,
      },
      splitPercent: Math.round((totalSplitPct / 100) * 1e9),
      splits,
    });
  }
  // The store reverts InvalidCategorySortOrder unless categories ascend.
  return configs.sort((a, b) => a.category - b.category);
}

/**
 * Pin each item's media and metadata JSON, returning drafts whose `uri` points at the pinned
 * metadata. CIDs are chain-independent, so a multichain launch pins once and deploys the same
 * digest everywhere.
 *
 * Items that compose no metadata (no name, description, or media) pass through untouched — an
 * item can also be listed against metadata that was pinned elsewhere, via `uri`.
 */
export async function pinDraftItems(
  items: DraftItem[],
  /** Category names, so an item's shelf travels with its metadata. */
  categories: { id: number; name: string }[] = [],
): Promise<DraftItem[]> {
  return Promise.all(
    items.map(async (item, index) => {
      const label = items.length > 1 ? `Item ${index + 1}: ` : "";
      // Metadata that already exists is the whole answer — it carries its own name, description
      // and media. Pinning a second document from the form's fields would replace what the
      // reader explicitly asked to use.
      if (item.uri.trim()) return item;
      let mediaUri = item.mediaUri.trim();
      if (item.mediaFile) {
        const mediaCid = await pinMediaFile(item.mediaFile);
        mediaUri = `ipfs://${mediaCid}`;
      }
      const composesMetadata = item.name.trim() || item.description.trim() || mediaUri;
      if (!composesMetadata) return item;
      if (!item.name.trim()) {
        throw new Error(`${label}enter a name when composing item metadata.`);
      }
      const categoryName = categories.find(
        (category) => String(category.id) === (item.category.trim() || "0") && category.id !== 0,
      )?.name;
      const cid = await pinJsonMetadata({
        name: item.name.trim(),
        ...(item.description.trim() ? { description: item.description.trim() } : {}),
        ...(mediaUri
          ? item.mediaFile && !item.mediaFile.type.startsWith("image/")
            ? { animation_url: mediaUri, mediaType: item.mediaFile.type }
            : { image: mediaUri }
          : {}),
        ...(categoryName ? { categoryName } : {}),
      });
      return { ...item, uri: `ipfs://${cid}` };
    }),
  );
}
