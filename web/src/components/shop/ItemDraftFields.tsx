"use client";

import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import type { DraftItem } from "@/components/shop/itemDraft";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipfsUriToGatewayUrl } from "@/lib/ipfs";
import { type JBChainId } from "@bananapus/nana-sdk-core";
import { type ReactNode, useState } from "react";

/** Sentinel option value; a category id can never be this. */
const ADD_CATEGORY = "add";

/** What the collection this item is going into will and will not accept. */
export type ItemLimits = {
  noNewTiersWithReserves?: boolean;
  noNewTiersWithVotes?: boolean;
  noNewTiersWithOwnerMinting?: boolean;
  /** Whether the project's transfer policy is fixed, so "non-transferable" is a guarantee.
   *  `null` when it could not be read; a launching collection is always fixed. */
  transferabilityFixed?: boolean | null;
};

/** An optional setting behind a checkbox: unchecked hides and clears it. */
function Optional({
  title,
  blurb,
  on,
  onClear,
  disabled,
  children,
}: {
  title: string;
  blurb?: string;
  on: boolean;
  onClear: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(on);
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
        <input
          type="checkbox"
          checked={open}
          onChange={() => {
            if (open) onClear();
            setOpen(!open);
          }}
          disabled={disabled}
          className="h-4 w-4"
        />
        {title}
      </label>
      {open ? (
        <>
          {blurb ? <p className="mt-1 text-xs text-zinc-500">{blurb}</p> : null}
          {children}
        </>
      ) : null}
    </div>
  );
}

/**
 * Every field of one shop item, shared by the create flow's store section and the operator's
 * "Add items" modal. The two write the same drafts and encode them through the same builder, so
 * a collection is stocked exactly the way it was launched.
 */
export function ItemDraftFields({
  item,
  index,
  priceSymbol,
  categories,
  limits,
  disabled = false,
  chains,
  onAddCategory,
  onChange,
  onSelectMedia,
}: {
  item: DraftItem;
  index: number;
  /** The symbol items are priced in — "USD", "ETH", or the reserve token's. */
  priceSymbol: string;
  categories: { id: number; name: string }[];
  limits: ItemLimits;
  disabled?: boolean;
  /** When given, quantity can be set per chain. Absent for a single live hook. */
  chains?: JBChainId[];
  /** Names a new category and returns its id. Absent where categories are fixed. */
  onAddCategory?: (name: string) => number;
  onChange: (patch: Partial<DraftItem>) => void;
  onSelectMedia: (file: File | null) => void;
}) {
  const [namingCategory, setNamingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  const commitCategory = () => {
    const name = newCategory.trim();
    setNewCategory("");
    setNamingCategory(false);
    if (!name || !onAddCategory) return;
    // A name already on the list is that category, not a second one. The name travels in this
    // item's own metadata, which is where the shop reads category labels from.
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    onChange({ category: String(existing ? existing.id : onAddCategory(name)) });
  };

  // Pinned media with no local file (an imported draft) previews from the gateway.
  const preview =
    item.mediaPreview ??
    (item.mediaUri && (!item.mediaType || item.mediaType.startsWith("image/"))
      ? ipfsUriToGatewayUrl(item.mediaUri)
      : undefined);

  return (
    <>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 flex-col items-start gap-2">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-20 w-20 border border-zinc-200 object-cover" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center border border-dashed border-zinc-300 bg-white text-2xl">
              {item.mediaFile || item.mediaUri ? "📄" : "🖼️"}
            </span>
          )}
          <label className="cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:border-zinc-500">
            {item.mediaFile || item.mediaUri ? "Change media" : "Upload media"}
            <input
              type="file"
              accept="image/*,video/*,audio/*,application/pdf,text/*,.md,.markdown"
              disabled={disabled}
              className="sr-only"
              onChange={(event) => onSelectMedia(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <Input
            aria-label={`Item ${index + 1} name`}
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Item name"
            disabled={disabled}
            className="h-11 bg-white"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Price ({priceSymbol})</Label>
              <Input
                value={item.price}
                onChange={(e) => onChange({ price: e.target.value })}
                placeholder={priceSymbol === "USD" ? "25" : "0.01"}
                inputMode="decimal"
                disabled={disabled}
                className="mt-1 h-11 bg-white"
              />
            </div>
            <Optional
              title={`Limited supply${chains && chains.length > 1 ? " (on each chain)" : ""}`}
              on={
                !!item.supply.trim() ||
                Object.values(item.perChainSupply).some((value) => value?.trim())
              }
              onClear={() =>
                onChange({ supply: "", perChainSupply: {}, perChainSupplyOpen: false })
              }
              disabled={disabled}
            >
              <Input
                aria-label={`Item ${index + 1} quantity`}
                value={item.supply}
                onChange={(e) => onChange({ supply: e.target.value })}
                placeholder="Quantity"
                inputMode="numeric"
                disabled={disabled}
                className="mt-2 h-11 bg-white"
              />
              {chains && chains.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => onChange({ perChainSupplyOpen: !item.perChainSupplyOpen })}
                    disabled={disabled}
                    aria-expanded={item.perChainSupplyOpen}
                    className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    {item.perChainSupplyOpen ? "Same on every chain" : "Set per chain"}
                  </button>
                  {item.perChainSupplyOpen ? (
                    <div className="mt-2 space-y-2">
                      {chains.map((chain) => (
                        <div key={chain} className="flex items-center gap-2">
                          <span className="flex w-36 shrink-0 items-center gap-2 text-xs text-zinc-500">
                            <ChainLogo chainId={chain} width={18} height={18} />
                            {chainDisplayName(chain)}
                          </span>
                          <Input
                            aria-label={`${chainDisplayName(chain)} quantity`}
                            value={item.perChainSupply[chain] ?? ""}
                            onChange={(e) =>
                              onChange({
                                perChainSupply: {
                                  ...item.perChainSupply,
                                  [chain]: e.target.value,
                                },
                              })
                            }
                            // Blank falls back to the quantity above; "unlimited" is the one
                            // override that cannot be written as a number.
                            placeholder={item.supply.trim() || "Unlimited"}
                            disabled={disabled}
                            className="h-10 bg-white"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </Optional>
          </div>
        </div>
      </div>

      <Input
        value={item.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Short description (optional)"
        disabled={disabled}
        className="mt-3 h-11 bg-white"
      />

      <button
        type="button"
        onClick={() => onChange({ moreOpen: !item.moreOpen })}
        disabled={disabled}
        aria-expanded={item.moreOpen}
        className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-800"
      >
        {item.moreOpen ? "Fewer options" : "More options"}
      </button>

      {item.moreOpen ? (
        <div className="mt-4 space-y-5 border-t border-zinc-200 pt-4">
          <div>
            <Label className="text-xs">Category</Label>
            <p className="mt-1 text-xs text-zinc-500">
              Group this item with others in the collection.
            </p>
            <select
              aria-label={`Item ${index + 1} category`}
              value={item.category}
              onChange={(e) => {
                if (e.target.value === ADD_CATEGORY) {
                  setNamingCategory(true);
                  return;
                }
                setNamingCategory(false);
                onChange({ category: e.target.value });
              }}
              disabled={disabled}
              className="mt-2 h-11 min-w-56 border border-zinc-300 bg-white px-3 text-sm"
            >
              <option value="0">Default</option>
              {categories
                .filter((category) => category.id !== 0)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              {onAddCategory ? <option value={ADD_CATEGORY}>+ Add category…</option> : null}
            </select>
            {namingCategory && onAddCategory ? (
              <Input
                aria-label="New category name"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                onBlur={commitCategory}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitCategory();
                }}
                placeholder="Category name"
                autoFocus
                disabled={disabled}
                className="mt-2 h-10 w-56 bg-white"
              />
            ) : null}
          </div>

          <div>
            <Label className="text-xs">Split sales</Label>
            <p className="mt-1 text-xs text-zinc-500">
              Route a share of each sale to other wallets.
            </p>
            {item.splits.length > 0 ? (
              <div className="mt-2 space-y-2">
                {item.splits.map((split, splitIndex) => (
                  <div
                    key={splitIndex}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2"
                  >
                    <Input
                      aria-label={`Split ${splitIndex + 1} percent`}
                      value={split.percent}
                      onChange={(e) => {
                        const splits = item.splits.map((current, i) =>
                          i === splitIndex ? { ...current, percent: e.target.value } : current,
                        );
                        onChange({ splits });
                      }}
                      placeholder="%"
                      inputMode="decimal"
                      disabled={disabled}
                      className="h-10 bg-white"
                    />
                    <Input
                      aria-label={`Split ${splitIndex + 1} beneficiary`}
                      value={split.beneficiary}
                      onChange={(e) => {
                        const splits = item.splits.map((current, i) =>
                          i === splitIndex ? { ...current, beneficiary: e.target.value } : current,
                        );
                        onChange({ splits });
                      }}
                      placeholder="0x… beneficiary"
                      disabled={disabled}
                      className="h-10 bg-white font-mono text-xs"
                    />
                    <button
                      type="button"
                      aria-label={`Remove split ${splitIndex + 1}`}
                      onClick={() =>
                        onChange({
                          splits: item.splits.filter((_, i) => i !== splitIndex),
                        })
                      }
                      disabled={disabled}
                      className="px-2 text-zinc-500 hover:text-zinc-900"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() =>
                onChange({
                  splits: [...item.splits, { percent: "", beneficiary: "" }],
                })
              }
              disabled={disabled}
              className="mt-2 border border-dashed border-zinc-400 bg-white px-3 py-2 text-xs font-medium"
            >
              + Add a recipient
            </button>
          </div>

          <Optional
            title="Add discount"
            blurb="Launch this item at a discount off its listed price."
            on={!!item.discountPct.trim()}
            onClear={() => onChange({ discountPct: "" })}
            disabled={disabled}
          >
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={item.discountPct}
                onChange={(e) => onChange({ discountPct: e.target.value })}
                placeholder="0"
                inputMode="decimal"
                disabled={disabled}
                className="h-10 w-24 bg-white"
              />
              <span className="text-sm text-zinc-600">% off</span>
            </div>
          </Optional>

          <Optional
            title="Reserve inventory"
            blurb="Set aside some inventory for a specific wallet as others buy it."
            on={!!item.reserveFrequency.trim() || !!item.reserveBeneficiary.trim()}
            onClear={() => onChange({ reserveFrequency: "", reserveBeneficiary: "" })}
            disabled={disabled}
          >
            {limits.noNewTiersWithReserves ? (
              <p className="mt-2 text-xs text-zinc-500">
                This collection no longer accepts new reserved items.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-zinc-600">1 of every</span>
                <Input
                  value={item.reserveFrequency}
                  onChange={(e) => onChange({ reserveFrequency: e.target.value })}
                  placeholder="—"
                  inputMode="numeric"
                  disabled={disabled}
                  className="h-10 w-20 bg-white"
                />
                <span className="text-sm text-zinc-600">sold goes to</span>
                <Input
                  value={item.reserveBeneficiary}
                  onChange={(e) => onChange({ reserveBeneficiary: e.target.value })}
                  placeholder="0x… beneficiary"
                  disabled={disabled}
                  className="h-10 min-w-52 flex-1 bg-white font-mono text-xs"
                />
              </div>
            )}
          </Optional>

          {limits.noNewTiersWithVotes ? (
            <p className="text-xs text-zinc-500">
              Voting power: this collection only accepts free items because new voting power is
              locked.
            </p>
          ) : null}

          <div>
            <Label className="text-xs">Item rules</Label>
            <p className="mt-1 text-xs text-zinc-500">
              Transferability is chosen once when the item is added and cannot change later.
            </p>
            <div className="mt-2 space-y-2">
              {(
                [
                  {
                    key: "allowOwnerMint" as const,
                    title: "Revnet operator can mint for free",
                    description: "The revnet operator can mint this item without paying.",
                    disabled: !!limits.noNewTiersWithOwnerMinting,
                  },
                  {
                    key: "nonTransferable" as const,
                    title: "Non-transferable",
                    description:
                      limits.transferabilityFixed === true
                        ? "This item can never move between wallets. Minting and burning remain available."
                        : limits.transferabilityFixed === false
                          ? "This legacy revnet has stage-controlled transfers, so it cannot guarantee a permanently non-transferable item."
                          : "The revnet's fixed transfer policy could not be verified, so non-transferable items are unavailable right now.",
                    disabled: limits.transferabilityFixed !== true,
                  },
                  {
                    key: "cantBeRemoved" as const,
                    title: "Permanent",
                    description: "This item can never be removed from the shop.",
                    disabled: false,
                  },
                  {
                    key: "allowCredits" as const,
                    title: "Allow credit purchases",
                    description: "Buyers can spend leftover pay credits on this item.",
                    disabled: false,
                  },
                  {
                    key: "operatorCanEditDiscount" as const,
                    title: "Discounts can change later",
                    description: "The revnet operator can raise or end the discount after launch.",
                    disabled: false,
                  },
                ] as const
              ).map((rule) => (
                <label key={rule.key} className="flex gap-3 border border-zinc-200 bg-white p-3">
                  <input
                    type="checkbox"
                    checked={item[rule.key]}
                    onChange={() => onChange({ [rule.key]: !item[rule.key] })}
                    disabled={disabled || rule.disabled}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-800">{rule.title}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {rule.disabled ? "This collection has locked this option." : rule.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
