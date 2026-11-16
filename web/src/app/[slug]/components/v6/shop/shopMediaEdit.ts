import { chainDisplayName } from "@/app/constants";
import { pinJsonMetadata } from "@/app/create/helpers/pinProjectMetaData";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { decodeEncodedIpfsUriCandidates, jb721TiersHookStoreAbi } from "@bananapus/nana-sdk-core";
import { editShopMetadataDetails } from "@bananapus/nana-sdk-core/v6";
import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { captureShopRead, shopWriteConditions } from "./shopBatch";
import { encodeIpfsCid } from "./shopLib";
import type { ShopDestination } from "./useShopDestinations";

const ZERO_DIGEST = `0x${"0".repeat(64)}`;

/** Media edits own only artwork fields; names, attributes, categories and custom JSON survive. */
export function replaceTierMedia(
  metadata: Record<string, unknown>,
  uri: string,
  mediaType: string,
) {
  const next = { ...metadata };
  delete next.image;
  delete next.image_data;
  delete next.animation_url;
  delete next.animationUrl;
  delete next.mediaType;
  if (mediaType.startsWith("image/")) next.image = uri;
  else next.animation_url = uri;
  next.mediaType = mediaType;
  return next;
}

async function readTierJson(digest: Hex): Promise<Record<string, unknown>> {
  if (digest === ZERO_DIGEST) return {};
  const candidates = decodeEncodedIpfsUriCandidates(digest);
  if (!candidates) throw new Error("This item has an invalid metadata digest.");
  for (const candidate of candidates) {
    const url = ipfsUriToAppUrl(candidate);
    if (!url) continue;
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") ?? "";
      // A digest that is the media itself: keep pointing at it, so an edit of other fields keeps the artwork.
      if (/^(image|audio|video)\//u.test(contentType)) {
        const mediaType = contentType.split(";")[0].trim();
        return mediaType.startsWith("image/")
          ? { image: candidate, mediaType }
          : { animation_url: candidate, mediaType };
      }
      const reader = response.body?.getReader();
      if (!reader) continue;
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 512 * 1024) {
            await reader.cancel();
            throw new Error("Item metadata exceeds the supported size.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.length;
      });
      const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!json || typeof json !== "object" || Array.isArray(json)) continue;
      return json as Record<string, unknown>;
    } catch {
      /* Try the alternative CID encoding; never replace unreadable JSON with {}. */
    }
  }
  throw new Error(
    "Could not read this item’s original metadata. Its fields cannot be safely preserved.",
  );
}

/** A change to one existing item. Each needs its own permission from the hook's owner. */
export type ItemChange = "media" | "details" | "discount" | "remove";
const ITEM_PERMISSION: Record<ItemChange, bigint> = {
  media: 25n,
  details: 25n,
  discount: 27n,
  remove: 24n,
};

/** Read every destination before any pin/write. IDs are explicitly selected within each hook. */
export async function readMediaEditSource(
  client: PublicClient,
  destination: ShopDestination,
  tierId: number,
  account: Address,
  change: ItemChange = "media",
) {
  if (
    !Number.isSafeInteger(tierId) ||
    tierId <= 0 ||
    !destination.shop.tiers.some((tier) => tier.id === tierId)
  )
    throw new Error("Choose an existing item on every selected chain.");
  const editsMetadata = change === "media" || change === "details";
  const preconditions = await shopWriteConditions(
    client,
    destination,
    account,
    ITEM_PERMISSION[change],
  );
  const [digest, resolver, removed] = await Promise.all([
    captureShopRead<Hex>(
      client,
      destination.shop.store,
      jb721TiersHookStoreAbi,
      "encodedIpfsUriOf",
      [destination.shop.hook, BigInt(tierId)],
    ),
    captureShopRead<Address>(
      client,
      destination.shop.store,
      jb721TiersHookStoreAbi,
      "tokenUriResolverOf",
      [destination.shop.hook],
    ),
    captureShopRead<boolean>(
      client,
      destination.shop.store,
      jb721TiersHookStoreAbi,
      "isTierRemoved",
      [destination.shop.hook, BigInt(tierId)],
    ),
  ]);
  if (editsMetadata && resolver.value.toLowerCase() !== zeroAddress)
    throw new Error(
      `The collection on chain ${destination.chainId} uses a custom media resolver. Individual item media must be updated through that resolver.`,
    );
  if (removed.value) throw new Error("The selected item is no longer in this shop.");
  // tierOf identifies a nonexistent item as zero initial supply. Its changing remaining supply
  // is deliberately not a persisted guard: an ordinary purchase does not invalidate media.
  const tier = await client.readContract({
    address: destination.shop.store,
    abi: jb721TiersHookStoreAbi,
    functionName: "tierOf",
    args: [destination.shop.hook, BigInt(tierId), false],
  });
  if (Number(tier.id) !== tierId || Number(tier.initialSupply) === 0)
    throw new Error("The selected item is no longer in this shop.");
  if (change === "remove" && tier.flags.cantBeRemoved)
    throw new Error(`This item cannot be removed on ${chainDisplayName(destination.chainId)}.`);
  return {
    destination,
    tierId,
    /** Out of 200, with whether it may only go down. */
    discountPercent: Number(tier.discountPercent),
    cantIncreaseDiscountPercent: tier.flags.cantIncreaseDiscountPercent,
    metadata: editsMetadata ? await readTierJson(digest.value) : {},
    preconditions: editsMetadata
      ? [...preconditions, digest.condition, resolver.condition, removed.condition]
      : [...preconditions, removed.condition],
  };
}

type WithMetadata = { metadata: Record<string, unknown> };

export function pinMediaEdits<T extends WithMetadata>(
  sources: T[],
  uri: string,
  mediaType: string,
) {
  return pinEdits(sources, (metadata) => replaceTierMedia(metadata, uri, mediaType));
}

/** A new name and description on each chain's own JSON; every other field survives. */
export function pinDetailEdits<T extends WithMetadata>(
  sources: T[],
  name: string,
  description: string,
) {
  return pinEdits(sources, (metadata) => editShopMetadataDetails(metadata, name, description));
}

async function pinEdits<T extends WithMetadata>(
  sources: T[],
  edit: (metadata: Record<string, unknown>) => Record<string, unknown>,
) {
  // Every chain's edit is checked before the first pin.
  const edited = sources.map((source) => edit(source.metadata));
  const pins = new Map<string, Promise<string>>();
  return Promise.all(
    sources.map(async (source, index) => {
      const metadata = edited[index];
      const key = JSON.stringify(metadata);
      let pin = pins.get(key);
      if (!pin) {
        pin = pinJsonMetadata(metadata);
        pins.set(key, pin);
      }
      const cid = await pin;
      return { ...source, encodedIpfsUri: encodeIpfsCid(cid), uri: `ipfs://${cid}` };
    }),
  );
}
