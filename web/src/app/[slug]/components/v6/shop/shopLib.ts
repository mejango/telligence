"use client";

import { cidFromIpfsUri, ipfsUriToAppUrl } from "@/lib/ipfs";
import { readAllProjectRulesets } from "@/lib/nana/rulesets";
import { decodeRulesetMetadata } from "@/lib/utils";
import {
  formatPayAmount,
  parseTierMetadataJson,
  TIER_UNLIMITED_SUPPLY,
  tierDisplayMetadata,
  TierDisplayMetadata,
} from "@/lib/v6/pay";
import {
  decodeEncodedIpfsUriCandidates,
  encodeIpfsUri,
  getJBContractAddress,
  jb721TiersHookAbi,
  jb721TiersHookStoreAbi,
  JB_CHAINS,
  JBChainId,
  JBCoreContracts,
  NATIVE_TOKEN,
} from "@bananapus/nana-sdk-core";
import {
  BASE_CURRENCY_ETH,
  BASE_CURRENCY_USD,
  decode721RulesetMetadata,
  effectiveTierPrice,
  getAccountingContexts,
  getCurrentRuleset,
  getProject721Shop,
} from "@bananapus/nana-sdk-core/v6";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Address, erc20Abi, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { ShopCartItem, useShopCart } from "../ShopCartContext";

export { TIER_UNLIMITED_SUPPLY };

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

/** bytes32 (onchain `encodedIpfsUri`) → canonical DAG-PB CIDv0 (`Qm…`). */
export function decodeEncodedIpfsUri(hex: string): string {
  const candidates = decodeEncodedIpfsUriCandidates(hex);
  if (!candidates) throw new Error("The tier does not contain a valid IPFS digest.");
  const cid = cidFromIpfsUri(candidates[0]);
  if (!cid) throw new Error("The tier does not contain a valid IPFS digest.");
  return cid;
}

/** DAG-PB CIDv0/CIDv1 → bytes32 for onchain `encodedIpfsUri`. */
export function encodeIpfsCid(cid: string): `0x${string}` {
  return encodeIpfsUri(cid);
}

/** One metadata sample per category, plus every resolver-only legacy tier. */
export function resolvedUriTierIds(
  tiers: ReadonlyArray<{ id: number; category: number; encodedIpfsUri: string }>,
): number[] {
  const representativeByCategory = new Map<number, number>();
  for (const tier of tiers) {
    if (!representativeByCategory.has(tier.category)) {
      representativeByCategory.set(tier.category, tier.id);
    }
  }
  return tiers.flatMap((tier) =>
    tier.encodedIpfsUri === ZERO_BYTES32 || representativeByCategory.get(tier.category) === tier.id
      ? [tier.id]
      : [],
  );
}

/** Stored-tier flags (`tiersOf`'s 5-bool shape — not the 7-bool config shape). */
interface ShopTierFlags {
  allowOwnerMint: boolean;
  transfersPausable: boolean;
  cantBeRemoved: boolean;
  cantIncreaseDiscountPercent: boolean;
  cantBuyWithCredits: boolean;
}

export interface ShopConfigFlags {
  noNewTiersWithReserves: boolean;
  noNewTiersWithVotes: boolean;
  noNewTiersWithOwnerMinting: boolean;
  preventOverspending: boolean;
  issueTokensForSplits: boolean;
}

export interface ShopTier {
  id: number;
  /** Full (undiscounted) price in the shop's pricing units. */
  price: bigint;
  remaining: number;
  initial: number;
  unlimited: boolean;
  category: number;
  /** Out of 200 (DISCOUNT_DENOMINATOR) — shopper-facing % is half this. */
  discountPercent: number;
  reserveFrequency: number;
  votingUnits: bigint;
  /** 1e9-scaled share of each sale routed to the tier's splits. */
  splitPercent: number;
  encodedIpfsUri: `0x${string}`;
  /** tokenUriResolver output (data URI), "" when the hook has no resolver. */
  resolvedUri: string;
  flags: ShopTierFlags | null;
}

export interface ShopInventory {
  hook: Address;
  store: Address;
  /**
   * The hook's METADATA_ID_TARGET (shared implementation) — pay-metadata ids
   * must key off this, never the clone hook address.
   */
  idTarget: Address;
  collection: { name: string; symbol: string };
  pricing: { currency: number; decimals: number; symbol: string };
  tiers: ShopTier[];
  configFlags: ShopConfigFlags | null;
  /** True when every precommitted stage keeps tier-level non-transferability enforced. */
  fixedTierTransferability: boolean | null;
  /** Whether the active stage pauses tiers which opted into transfer control. */
  transfersPaused: boolean | null;
  /**
   * Whether each stage pauses transfers, oldest first and numbered the way the Terms
   * table numbers them. A revnet queues its whole stage schedule at deployFor and no
   * revnet actor holds QUEUE_RULESETS, so this is the project's settled history and
   * future — not a reading of what happens to be true right now.
   */
  transferPauseByStage: { stage: number; paused: boolean }[] | null;
}

/**
 * Describe when transfers are paused across a project's whole stage schedule.
 *
 * A revnet's stages are queued once at deployFor and cannot be requeued, so the answer is
 * settled for the project's lifetime. Saying "transfers allowed now" reported the clock
 * rather than the agreement, and went stale the moment a stage rolled over.
 */
export function describeTransferSchedule(
  stages: { stage: number; paused: boolean }[] | null,
): string | null {
  if (!stages?.length) return null;
  if (stages.every((entry) => !entry.paused)) return "Transfers allowed in every stage";
  if (stages.every((entry) => entry.paused)) return "Transfers paused in every stage";

  const runs: { paused: boolean; from: number; to: number }[] = [];
  for (const entry of stages) {
    const last = runs[runs.length - 1];
    if (last && last.paused === entry.paused) last.to = entry.stage;
    else runs.push({ paused: entry.paused, from: entry.stage, to: entry.stage });
  }

  // The final stage never ends, so it reads as "from stage N" rather than a closed range.
  return runs
    .map((run, index) => {
      const verb = run.paused ? "paused" : "allowed";
      if (index === runs.length - 1) return `${verb} from stage ${run.from}`;
      if (run.from === run.to) return `${verb} in stage ${run.from}`;
      return `${verb} in stages ${run.from}–${run.to}`;
    })
    .join(", ")
    .replace(/^./u, (character) => character.toUpperCase());
}

const TIER_PAGE_SIZE = 200;

async function readTierPage(
  client: PublicClient,
  store: Address,
  hook: Address,
  startingId: bigint,
) {
  return client.readContract({
    address: store,
    abi: jb721TiersHookStoreAbi,
    functionName: "tiersOf",
    args: [
      hook,
      [],
      false,
      startingId,
      BigInt(startingId === 0n ? TIER_PAGE_SIZE : TIER_PAGE_SIZE + 1),
    ],
  });
}

async function readAllActiveTiers(client: PublicClient, store: Address, hook: Address) {
  const tiers: Awaited<ReturnType<typeof readTierPage>>[number][] = [];
  const seen = new Set<number>();
  let startingId = 0n;

  for (;;) {
    const page = await readTierPage(client, store, hook, startingId);
    if (page.length === 0) break;
    if (startingId !== 0n && BigInt(page[0].id) !== startingId) {
      throw new Error("Tier inventory changed while it was being read.");
    }
    const fresh = startingId === 0n ? page : page.slice(1);
    for (const tier of fresh) {
      if (seen.has(tier.id)) throw new Error(`Tier inventory repeated tier ${tier.id}.`);
      seen.add(tier.id);
      tiers.push(tier);
    }
    if (fresh.length < TIER_PAGE_SIZE) break;
    const next = BigInt(fresh[fresh.length - 1].id);
    if (next === startingId) throw new Error("Tier inventory returned a cyclic cursor.");
    startingId = next;
  }
  return tiers;
}

/**
 * The project's 721 shop on the context chain: hook + store + pricing context
 * (with a display symbol) + full tier data (supply, discount, reserve, flags).
 * Null when the project authoritatively has no 721 hook; RPC failures throw so
 * they surface as errors, never as a false "no shop".
 */
export function useShopInventory(chainId: JBChainId | undefined, projectId: bigint) {
  const publicClient = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["v6Shop721", chainId, projectId.toString()],
    enabled: !!publicClient && !!chainId,
    staleTime: 60_000,
    retry: 1,
    queryFn: () => loadShopInventory(publicClient as PublicClient, chainId!, projectId),
  });
}

/**
 * Resolve the collection and read stored tiers without eagerly expanding every
 * token URI. Large, established collections can make `tiersOf(..., true, ...)`
 * revert while resolving dozens of URIs in one RPC call. Tier display metadata
 * is already hydrated independently from each tier's immutable IPFS digest.
 */
export async function loadShopInventory(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<ShopInventory | null> {
  // Everything in revnet-app is a revnet — hook resolution goes through REVOwner.
  // A zero tier limit asks the SDK only for authoritative hook/store/pricing
  // resolution; the bounded non-resolving tier read below owns inventory.
  const resolved = await getProject721Shop(client, {
    chainId,
    projectId,
    isRevnet: true,
    tierLimit: 0,
  });
  if (!resolved) return null;

  const [rawTiers, symbol, configFlags, collectionMeta, currentRuleset, allRulesets] =
    await Promise.all([
      readAllActiveTiers(client, resolved.store, resolved.hook),
      resolveShopPricingSymbol(client, chainId, projectId, resolved.pricing.currency),
      client
        .readContract({
          address: resolved.store,
          abi: jb721TiersHookStoreAbi,
          functionName: "flagsOf",
          args: [resolved.hook],
        })
        .then((flags) => ({ ...flags }))
        .catch(() => null),
      Promise.all([
        client
          .readContract({
            address: resolved.hook,
            abi: jb721TiersHookAbi,
            functionName: "name",
          })
          .then((name) => String(name).trim())
          .catch(() => ""),
        client
          .readContract({
            address: resolved.hook,
            abi: jb721TiersHookAbi,
            functionName: "symbol",
          })
          .then((collectionSymbol) => String(collectionSymbol).trim())
          .catch(() => ""),
      ]),
      getCurrentRuleset(client, { chainId, projectId }).catch(() => null),
      readAllProjectRulesets(
        client,
        getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId),
        projectId,
      ).catch(() => null),
    ]);
  const activeTiers = rawTiers.filter((tier) => tier.initialSupply > 0);

  // Resolve one representative tier per category so its metadata can provide
  // the human-readable category name. Also resolve every legacy resolver-only
  // tier (including Banny's original four), which has no immutable digest in
  // the store. Keeping this bounded by category avoids asking the RPC to expand
  // every token URI in a large collection.
  const tierIdsToResolve = new Set(resolvedUriTierIds(activeTiers));
  const resolvedUriEntries = await Promise.all(
    activeTiers
      .filter((tier) => tierIdsToResolve.has(tier.id))
      .map(async (tier) => {
        const resolvedTier = await client
          .readContract({
            address: resolved.store,
            abi: jb721TiersHookStoreAbi,
            functionName: "tiersOf",
            args: [resolved.hook, [], true, BigInt(tier.id), 1n],
          })
          .then((tiers) => tiers[0])
          .catch(() => undefined);
        return [tier.id, resolvedTier?.resolvedUri ?? ""] as const;
      }),
  );
  const resolvedUriById = new Map(resolvedUriEntries);

  return {
    hook: resolved.hook,
    store: resolved.store,
    idTarget: resolved.metadataIdTarget,
    collection: { name: collectionMeta[0], symbol: collectionMeta[1] },
    pricing: { ...resolved.pricing, symbol },
    configFlags,
    fixedTierTransferability:
      allRulesets === null || allRulesets.length === 0
        ? null
        : allRulesets.every(
            (ruleset) =>
              decode721RulesetMetadata(decodeRulesetMetadata(ruleset.metadata).metadata)
                .pauseTransfers,
          ),
    transfersPaused: currentRuleset
      ? decode721RulesetMetadata(Number(currentRuleset.metadata.metadata ?? 0)).pauseTransfers
      : null,
    transferPauseByStage:
      allRulesets === null || allRulesets.length === 0
        ? null
        : [...allRulesets]
            // `allOf` returns newest first; the Terms table numbers stages oldest-first.
            .sort((left, right) => left.start - right.start)
            .map((ruleset, index) => ({
              stage: index + 1,
              paused: decode721RulesetMetadata(decodeRulesetMetadata(ruleset.metadata).metadata)
                .pauseTransfers,
            })),
    tiers: activeTiers.map((tier) => ({
      id: tier.id,
      price: tier.price,
      remaining: tier.remainingSupply,
      initial: tier.initialSupply,
      unlimited: tier.initialSupply >= TIER_UNLIMITED_SUPPLY,
      category: tier.category,
      discountPercent: tier.discountPercent,
      reserveFrequency: tier.reserveFrequency,
      votingUnits: tier.votingUnits,
      splitPercent: Number(tier.splitPercent),
      encodedIpfsUri: tier.encodedIpfsUri,
      resolvedUri: resolvedUriById.get(tier.id) ?? "",
      flags: { ...tier.flags },
    })),
  };
}

async function resolveShopPricingSymbol(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
  currency: number,
): Promise<string> {
  const nativeSymbol = JB_CHAINS[chainId]?.nativeTokenSymbol ?? "ETH";
  if (currency === BASE_CURRENCY_ETH) return nativeSymbol;
  if (currency === BASE_CURRENCY_USD) return "USD";
  // Token-keyed currency (uint32(uint160(token))): match the project's
  // accounting contexts to find the token, then read its symbol.
  const contexts = await getAccountingContexts(client, { chainId, projectId }).catch(() => []);
  const match = contexts.find((ctx) => ctx.currency === currency);
  if (!match) return `currency #${currency}`;
  if (match.token.toLowerCase() === NATIVE_TOKEN.toLowerCase()) return nativeSymbol;
  try {
    return await client.readContract({
      address: match.token,
      abi: erc20Abi,
      functionName: "symbol",
    });
  } catch {
    return `currency #${currency}`;
  }
}

export type TierMedia = TierDisplayMetadata;

/** The tier fields the media resolution chain needs (shop tab AND pay strip). */
export interface TierMediaSource {
  id: number;
  resolvedUri: string;
  encodedIpfsUri: `0x${string}`;
}

/**
 * Tier display metadata (name/image/category name), from the onchain
 * resolver's data URI first, then the tier's IPFS JSON. Best-effort — cards
 * render immediately and hydrate as this lands. Shared by the Shop tab and
 * the pay card's shop strip (same query key, one resolution chain).
 */
export function useTierMedia(
  chainId: JBChainId | undefined,
  shop: { hook: Address; tiers: TierMediaSource[] } | null | undefined,
) {
  const tiers = shop?.tiers ?? [];
  return useQueries({
    queries: tiers.map((tier) => ({
      queryKey: ["v6Shop721TierMedia", chainId, shop?.hook, tier.id],
      enabled: !!shop,
      staleTime: Infinity,
      queryFn: () => resolveTierMedia(tier),
    })),
    combine: (results) => ({
      data: Object.fromEntries(
        results.flatMap((result, index) =>
          result.data ? [[tiers[index].id, result.data] as const] : [],
        ),
      ) as Record<number, TierMedia>,
      isLoading: results.some((result) => result.isLoading),
      isError: results.some((result) => result.isError),
      error: results.find((result) => result.error)?.error ?? null,
    }),
  });
}

/** Best-effort tier metadata resolution — {} on any failure. */
export async function resolveTierMedia(tier: TierMediaSource): Promise<TierMedia> {
  const resolved = tier.resolvedUri ? parseTierMetadataJson(tier.resolvedUri) : null;
  if (resolved && Object.keys(resolved).length > 0) return tierDisplayMetadata(resolved);

  if (!tier.encodedIpfsUri || tier.encodedIpfsUri === ZERO_BYTES32) return {};
  const candidates = decodeEncodedIpfsUriCandidates(tier.encodedIpfsUri);
  if (!candidates) return {};
  // Metadata JSON must cross the same-origin boundary: public gateways and the
  // CID cache do not consistently send browser CORS headers. The bounded app
  // route owns the cache/path-gateway fallbacks for each immutable candidate.
  for (const url of candidates
    .map(ipfsUriToAppUrl)
    .filter((candidate): candidate is string => Boolean(candidate))) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(url, { signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      );
      if (!res.ok) continue;
      const contentType = res.headers?.get("content-type")?.toLowerCase() ?? "";
      if (/^(?:image|audio|video)\//u.test(contentType)) {
        return tierDisplayMetadata({
          image: url,
          mediaType: contentType.split(";", 1)[0],
        });
      }
      try {
        const json = (await res.json()) as unknown;
        return json && typeof json === "object"
          ? tierDisplayMetadata(json as Record<string, unknown>)
          : {};
      } catch {
        // Some gateways serve extension-less media as an octet stream. Once
        // JSON parsing rules it out, let the preview treat the immutable URL
        // as the tier's direct artwork.
        if (contentType === "application/octet-stream") {
          return tierDisplayMetadata({ image: url });
        }
      }
    } catch {
      // Try the next gateway.
    }
  }
  return {};
}

/** Shopper-facing "X% off" — discountPercent is out of 200. */
export function discountLabel(discountPercent: number): string {
  const pct = discountPercent / 2;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}% off`;
}

/** Localized shop-price label in the shop's pricing units. */
export function formatShopAmount(value: bigint, decimals: number): string {
  return formatPayAmount(value, decimals);
}

export function tierDisplayName(media: TierMedia | undefined, tierId: number): string {
  return media?.name ?? `Item #${tierId}`;
}

export function categoryLabel(
  category: number,
  tiers: ShopTier[],
  mediaById: Record<number, TierMedia> | undefined,
): string {
  const named = tiers.find(
    (tier) => tier.category === category && mediaById?.[tier.id]?.categoryName,
  );
  return (
    (named && mediaById?.[named.id]?.categoryName) ||
    (category === 0 ? "General" : `Category ${category}`)
  );
}

/**
 * The shared-cart view of the shop (same semantics as the pay card's
 * V6PayShopStrip): quantities keyed by (tierId, chainId), items registered
 * with their EFFECTIVE (discounted) price in the shop's pricing units.
 */
export function useTierCart(shop: ShopInventory | null | undefined, chainId: number | undefined) {
  const cart = useShopCart();

  const shopItems: ShopCartItem[] =
    shop && chainId
      ? cart.items.filter(
          (item) => item.chainId === chainId && item.hook.toLowerCase() === shop.hook.toLowerCase(),
        )
      : [];

  const quantityOf = (tierId: number) =>
    shopItems.find((item) => Number(item.tierId) === tierId)?.quantity ?? 0;

  const setTierQuantity = (tier: ShopTier, media: TierMedia | undefined, quantity: number) => {
    if (!shop || !chainId) return;
    const existing = cart.items.find(
      (item) => Number(item.tierId) === tier.id && item.chainId === chainId,
    );
    if (!existing && quantity > 0) {
      cart.add({
        tierId: BigInt(tier.id),
        quantity,
        price: effectiveTierPrice(tier.price, tier.discountPercent),
        currency: shop.pricing.currency,
        name: tierDisplayName(media, tier.id),
        imageUri: media?.image,
        hook: shop.hook,
        chainId,
      });
      return;
    }
    cart.setQuantity(BigInt(tier.id), chainId, quantity);
  };

  const count = shopItems.reduce((total, item) => total + item.quantity, 0);
  const total = shopItems.reduce((sum, item) => sum + item.price * BigInt(item.quantity), 0n);

  return { quantityOf, setTierQuantity, count, total };
}
