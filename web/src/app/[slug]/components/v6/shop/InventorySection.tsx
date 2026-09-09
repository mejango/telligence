"use client";

import EtherscanLink from "@/components/EtherscanLink";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { cn } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { effectiveTierPrice, isRevnetOperator } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { usePayShopCredits } from "../pay/usePayShop";
import { ProjectItem } from "../shared";
import { AddItemsModal } from "./AddItemsModal";
import { EditItemMediaModal } from "./EditItemMediaModal";
import { MintItemModal } from "./MintItemModal";
import {
  categoryLabel,
  describeTransferSchedule,
  discountLabel,
  formatShopAmount,
  ShopConfigFlags,
  ShopInventory,
  ShopTier,
  tierDisplayName,
  TierMedia,
  useTierCart,
} from "./shopLib";
import { canAdjust721Tiers, canMint721Tiers, canSet721Metadata } from "./shopPermissions";
import { TierDetailModal } from "./TierDetailModal";
import { TierMediaPreview } from "./TierMediaPreview";

const SHOP_CONFIG_ROWS: [keyof ShopConfigFlags, string][] = [
  ["preventOverspending", "Require exact payment"],
  ["noNewTiersWithReserves", "Lock reserved items after launch"],
  ["noNewTiersWithVotes", "Lock voting items after launch"],
  ["noNewTiersWithOwnerMinting", "Lock owner minting after launch"],
  ["issueTokensForSplits", "Full token credit on split sales"],
];

/**
 * The Inventory subtab (website/ renderShopSection parity): category filter
 * chips, the category-grouped tier grid, the connected wallet's shop credit,
 * the shared-cart summary pointing at the Pay card, and the operator's
 * "+ Add items" entry.
 */
export function InventorySection({
  shop,
  chainId,
  projectId,
  projects,
  mediaById,
}: {
  shop: ShopInventory;
  chainId: JBChainId;
  projectId: bigint;
  projects: ProjectItem[];
  mediaById: Record<number, TierMedia> | undefined;
}) {
  const { address } = useViewedAccount();
  const publicClient = usePublicClient({ chainId });
  const { hasPermission } = useUserPermissions();
  const { count, total } = useTierCart(shop, chainId);
  const { data: credits } = usePayShopCredits(chainId, shop.hook);

  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [detailTierId, setDetailTierId] = useState<number | null>(null);
  const [addItemsOpen, setAddItemsOpen] = useState(false);
  const [mintTierId, setMintTierId] = useState<number | null>(null);
  const [mediaTierId, setMediaTierId] = useState<number | null>(null);

  // Use both the indexed affordance and the hook's live permission semantics.
  // The latter covers indexer lag and delegates authorized specifically to
  // adjust this shop.
  const { data: isOperator } = useQuery({
    queryKey: ["v6RevnetOperator", chainId, projectId.toString(), address],
    enabled: !!address && !!publicClient,
    staleTime: 60_000,
    retry: 1,
    queryFn: () =>
      isRevnetOperator(publicClient as PublicClient, {
        chainId,
        revnetId: projectId,
        operator: address!,
      }),
  });
  const { data: canManageLive } = useQuery({
    queryKey: ["v6ShopAdjustPermission", chainId, projectId.toString(), shop.hook, address],
    enabled: !!address && !!publicClient,
    staleTime: 15_000,
    retry: 1,
    queryFn: () =>
      canAdjust721Tiers(publicClient as PublicClient, {
        chainId,
        projectId,
        hook: shop.hook,
        operator: address!,
      }),
  });
  const canAddItems =
    hasPermission("ADJUST_721_TIERS") || hasPermission("ROOT") || !!isOperator || !!canManageLive;
  const { data: canMintLive } = useQuery({
    queryKey: ["v6ShopMintPermission", chainId, projectId.toString(), shop.hook, address],
    enabled: !!address && !!publicClient,
    staleTime: 15_000,
    retry: 1,
    queryFn: () =>
      canMint721Tiers(publicClient as PublicClient, {
        chainId,
        projectId,
        hook: shop.hook,
        operator: address!,
      }),
  });
  const { data: canEditMedia } = useQuery({
    queryKey: ["v6ShopMetadataPermission", chainId, projectId.toString(), shop.hook, address],
    enabled: !!address && !!publicClient,
    staleTime: 15_000,
    retry: 1,
    queryFn: () =>
      canSet721Metadata(publicClient as PublicClient, {
        chainId,
        projectId,
        hook: shop.hook,
        operator: address!,
      }),
  });
  const canMintItems =
    hasPermission("MINT_721") || hasPermission("ROOT") || !!isOperator || !!canMintLive;

  const categories = useMemo(() => {
    const ids = [...new Set(shop.tiers.map((tier) => tier.category))].sort((a, b) => a - b);
    return ids.map((id) => ({ id, name: categoryLabel(id, shop.tiers, mediaById) }));
  }, [shop.tiers, mediaById]);

  const visibleCategories = useMemo(
    () =>
      categories
        .filter((category) => selectedCategory === null || category.id === selectedCategory)
        .map((category) => ({
          ...category,
          tiers: shop.tiers.filter((tier) => tier.category === category.id),
        })),
    [categories, selectedCategory, shop.tiers],
  );

  const detailTier =
    detailTierId == null ? null : (shop.tiers.find((tier) => tier.id === detailTierId) ?? null);
  const mediaTier = shop.tiers.find((tier) => tier.id === mediaTierId);
  const mintTier =
    mintTierId == null ? null : (shop.tiers.find((tier) => tier.id === mintTierId) ?? null);

  return (
    <div className="space-y-5">
      <section className="bg-melon-50 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Items</h2>
          {canAddItems ? (
            <button
              type="button"
              onClick={() => setAddItemsOpen(true)}
              className="min-h-10 bg-teal-500 px-4 text-sm font-medium text-melon-950 transition-colors hover:bg-teal-600"
              title="Add items for sale (revnet operator only)"
            >
              + Add items
            </button>
          ) : null}
        </div>

        {address && shop.tiers.length > 0 && (credits ?? 0n) > 0n ? (
          <p
            className="mt-4 text-sm text-teal-800"
            title="Overpayment becomes shop credit and is applied automatically to eligible items at checkout."
          >
            Your shop credit:{" "}
            <span className="font-medium">
              {formatShopAmount(credits!, shop.pricing.decimals)} {shop.pricing.symbol}
            </span>{" "}
            — applied automatically at checkout.
          </p>
        ) : null}

        {shop.tiers.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No items being sold yet.
            {canAddItems ? " Add the first one with the button above." : ""}
          </p>
        ) : (
          <>
            {categories.length > 1 ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {[{ id: null as number | null, name: "All" }, ...categories].map((category) => (
                  <button
                    key={category.id ?? "all"}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                    aria-pressed={selectedCategory === category.id}
                    className={cn(
                      "border px-3 py-1.5 text-xs font-medium transition-colors",
                      selectedCategory === category.id
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-teal-300 hover:text-teal-600",
                    )}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-5">
              {visibleCategories.map((category) => (
                <div key={category.id}>
                  {categories.length > 1 ? (
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {category.name}
                    </h3>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {category.tiers.map((tier) => (
                      <TierCard
                        key={tier.id}
                        shop={shop}
                        chainId={chainId}
                        tier={tier}
                        media={mediaById?.[tier.id]}
                        onOpen={() => setDetailTierId(tier.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {count > 0 ? (
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="mt-4 flex w-full items-center justify-between gap-3 bg-teal-500 px-4 py-3 text-sm font-medium text-melon-950 hover:bg-teal-600"
          >
            <span>
              {count} item{count === 1 ? "" : "s"} selected —{" "}
              {formatShopAmount(total, shop.pricing.decimals)} {shop.pricing.symbol}
            </span>
            <span>Check out in the Pay card →</span>
          </button>
        ) : null}
      </section>

      <section className="bg-melon-50 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Collection</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-zinc-500">Name</dt>
            <dd className="font-medium text-zinc-900">
              {shop.collection.name || "Not yet named"}
              {shop.collection.symbol ? (
                <span className="ml-1.5 font-normal text-zinc-500">({shop.collection.symbol})</span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-zinc-500">Address</dt>
            <dd>
              <EtherscanLink value={shop.hook} truncateTo={6} className="font-mono text-zinc-700" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-zinc-500">Currency</dt>
            <dd className="font-medium text-zinc-900">{shop.pricing.symbol}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <dt className="text-zinc-500">Item transfer policy</dt>
            <dd className="text-right font-medium text-zinc-900">
              {shop.fixedTierTransferability === true
                ? "Fixed per item"
                : shop.fixedTierTransferability === false
                  ? (describeTransferSchedule(shop.transferPauseByStage) ?? "Set by each stage")
                  : "Status unavailable"}
            </dd>
          </div>
        </dl>
      </section>

      <ShopConfigDetails flags={shop.configFlags} />

      {detailTier ? (
        <TierDetailModal
          shop={shop}
          chainId={chainId}
          projects={projects}
          tier={detailTier}
          media={mediaById?.[detailTier.id]}
          onMint={
            canMintItems && detailTier.flags?.allowOwnerMint && detailTier.remaining > 0
              ? () => {
                  setDetailTierId(null);
                  setMintTierId(detailTier.id);
                }
              : undefined
          }
          onEditMedia={
            canEditMedia
              ? () => {
                  setDetailTierId(null);
                  setMediaTierId(detailTier.id);
                }
              : undefined
          }
          onClose={() => setDetailTierId(null)}
        />
      ) : null}

      {mintTier ? (
        <MintItemModal
          chainId={chainId}
          projectId={projectId}
          hook={shop.hook}
          tierId={mintTier.id}
          itemName={tierDisplayName(mediaById?.[mintTier.id], mintTier.id)}
          remaining={mintTier.remaining}
          onClose={() => setMintTierId(null)}
        />
      ) : null}

      {mediaTier ? (
        <EditItemMediaModal
          chainId={chainId}
          projectId={projectId}
          projects={projects}
          tier={mediaTier}
          media={mediaById?.[mediaTier.id]}
          onClose={() => setMediaTierId(null)}
        />
      ) : null}

      {addItemsOpen ? (
        <AddItemsModal
          shop={shop}
          chainId={chainId}
          projectId={projectId}
          categories={categories}
          projects={projects}
          onClose={() => setAddItemsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ShopConfigDetails({ flags }: { flags: ShopConfigFlags | null }) {
  return (
    <details className="group bg-melon-50 px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-zinc-500 transition-colors hover:text-zinc-700">
        <span>Shop config</span>
        <span
          aria-hidden="true"
          className="inline-block text-zinc-400 transition-transform group-open:rotate-90"
        >
          ▸
        </span>
      </summary>
      {flags ? (
        <dl className="mt-4 space-y-2 border-t border-melon-200 pt-4 text-sm">
          {SHOP_CONFIG_ROWS.map(([key, label]) => (
            <div key={key} className="flex items-baseline justify-between gap-4">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="font-medium text-zinc-800">{flags[key] ? "On" : "Off"}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 border-t border-melon-200 pt-4 text-sm text-zinc-500">
          Couldn&apos;t read the current shop config.
        </p>
      )}
    </details>
  );
}

function TierCard({
  shop,
  chainId,
  tier,
  media,
  onOpen,
}: {
  shop: ShopInventory;
  chainId: JBChainId;
  tier: ShopTier;
  media: TierMedia | undefined;
  onOpen: () => void;
}) {
  const { quantityOf, setTierQuantity } = useTierCart(shop, chainId);

  const name = tierDisplayName(media, tier.id);
  const quantity = quantityOf(tier.id);
  const soldOut = !tier.unlimited && tier.remaining <= 0;
  const cap = tier.unlimited ? 99 : tier.remaining;
  const discounted = tier.discountPercent > 0;
  const effective = effectiveTierPrice(tier.price, tier.discountPercent);

  return (
    <div
      data-tier-id={tier.id}
      className={cn(
        "overflow-hidden border bg-white transition",
        quantity > 0 ? "border-teal-500" : "border-zinc-200",
        soldOut && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View details for ${name}`}
        className="relative block aspect-square w-full bg-white text-left"
      >
        <TierMediaPreview media={media} tierId={tier.id} alt={name} />
        {discounted ? (
          <span className="absolute left-2 top-2 rounded-full bg-teal-500 px-2 py-0.5 text-[11px] font-medium text-melon-950">
            {discountLabel(tier.discountPercent)}
          </span>
        ) : null}
        {soldOut ? (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-900">
            Sold out
          </span>
        ) : null}
        {shop.fixedTierTransferability === true && tier.flags?.transfersPausable ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            Non-transferable
          </span>
        ) : shop.fixedTierTransferability === false &&
          shop.transfersPaused === true &&
          tier.flags?.transfersPausable ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            Transfers paused (legacy)
          </span>
        ) : null}
        {quantity > 0 ? (
          <span className="absolute bottom-2 right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-teal-500 px-1.5 text-xs font-medium text-melon-950">
            {quantity}
          </span>
        ) : null}
      </button>

      <div className="border-t border-zinc-200 bg-melon-50 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full truncate text-left text-sm font-medium text-zinc-900 hover:underline"
        >
          {name}
        </button>

        <p className="mt-1 text-sm text-zinc-900">
          <span className="font-medium">
            {formatShopAmount(effective, shop.pricing.decimals)} {shop.pricing.symbol}
          </span>
          {discounted ? (
            <span className="ml-1.5 text-xs text-zinc-400 line-through">
              {formatShopAmount(tier.price, shop.pricing.decimals)}
            </span>
          ) : null}
        </p>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">
            {soldOut
              ? "None left"
              : tier.unlimited
                ? "Unlimited"
                : `${tier.remaining.toLocaleString("en-US")} left`}
          </p>
          {soldOut ? null : quantity === 0 ? (
            <button
              type="button"
              onClick={() => setTierQuantity(tier, media, 1)}
              className="border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:border-teal-400 hover:text-teal-600"
            >
              Add
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTierQuantity(tier, media, quantity - 1)}
                aria-label={`Remove one ${name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-700"
              >
                −
              </button>
              <span className="min-w-4 text-center text-xs tabular-nums">{quantity}</span>
              <button
                type="button"
                onClick={() => setTierQuantity(tier, media, Math.min(cap, quantity + 1))}
                disabled={quantity >= cap}
                aria-label={`Add one ${name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-700 disabled:opacity-40"
              >
                +
              </button>
            </div>
          )}
        </div>

        {tier.reserveFrequency > 0 || tier.votingUnits > 0n ? (
          <p className="mt-1 text-[11px] text-zinc-400">
            {tier.reserveFrequency > 0 ? `1 of every ${tier.reserveFrequency} reserved` : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
