import { ItemDraftFields } from "@/components/shop/ItemDraftFields";
import { MAX_MEDIA_BYTES, newDraftItem, type DraftItem } from "@/components/shop/itemDraft";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormContext } from "@/lib/forms";
import { sortChains } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { RevnetFormData } from "../types";
import { useCreateForm } from "./useCreateForm";

/**
 * The shop that deploys with the revnet.
 *
 * Items are optional. The collection itself is not: REVDeployer deploys an empty 721 hook for
 * every revnet whether or not one is configured, so the only question here is what it holds and
 * how it is set up — which is why nothing in this section is gated on adding an item.
 */
export function StoreSection({ disabled = false }: { disabled?: boolean }) {
  const { values, setFieldValue } = useFormContext<RevnetFormData>();
  const { revnetTokenSymbol, reserveAssetSymbol } = useCreateForm();
  const store = values.store;
  const chains = sortChains(values.chainIds);
  const [configOpen, setConfigOpen] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Object URLs outlive the component unless they are handed back.
  const previews = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const preview of previews.current) URL.revokeObjectURL(preview);
      previews.current.clear();
    },
    [],
  );

  const priceSymbol =
    store.pricing === "USD"
      ? "USD"
      : values.issuanceBaseCurrency === "USD" && values.reserveAsset !== "CUSTOM"
        ? "USD"
        : reserveAssetSymbol;

  // Two writes in one handler — naming a category, then putting the item in it — would each
  // spread the same render's `store` and the second would drop the first. The ref carries the
  // value forward within the tick.
  const storeRef = useRef(store);
  storeRef.current = store;
  const setStore = (patch: Partial<RevnetFormData["store"]>) => {
    storeRef.current = { ...storeRef.current, ...patch };
    setFieldValue("store", storeRef.current);
  };
  const setItem = (index: number, patch: Partial<DraftItem>) => {
    setStore({
      items: storeRef.current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  };
  const selectMedia = (index: number, file: File | null) => {
    if (file && file.size > MAX_MEDIA_BYTES) {
      setMediaError("Media must be 500 MB or smaller.");
      return;
    }
    setMediaError(null);
    const previous = store.items[index]?.mediaPreview;
    if (previous) {
      URL.revokeObjectURL(previous);
      previews.current.delete(previous);
    }
    const mediaPreview = file?.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (mediaPreview) previews.current.add(mediaPreview);
    setItem(index, { mediaFile: file, mediaPreview });
  };
  const removeItem = (index: number) => {
    const preview = store.items[index]?.mediaPreview;
    if (preview) {
      URL.revokeObjectURL(preview);
      previews.current.delete(preview);
    }
    setStore({ items: store.items.filter((_, i) => i !== index) });
  };

  // Categories are just numbers onchain; their names ride along in each item's metadata, which
  // is where the shop reads its labels from.
  const addCategory = (name: string) => {
    const id = storeRef.current.categories.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    setStore({ categories: [...storeRef.current.categories, { id, name }] });
    return id;
  };

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">4. Store</h2>
        <p className="text-lg text-zinc-600">
          Sell things right from your revnet. Each sale pays the revnet, and the buyer gets the item
          plus {revnetTokenSymbol}.
        </p>
        <p className="mt-2 text-lg text-zinc-600">The Operator can add items later.</p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        <div>
          <Label className="text-xs">Pricing currency</Label>
          <p className="mt-1 text-xs text-zinc-500">
            What items are priced in — buyers can still pay with anything the revnet accepts.
          </p>
          <Select
            value={store.pricing}
            onValueChange={(value) => setStore({ pricing: value as typeof store.pricing })}
            disabled={disabled}
          >
            <SelectTrigger
              aria-label="Pricing currency"
              className="mt-2 w-56 border-2 border-melon-300 bg-melon-25 hover:border-melon-400 focus:border-melon-600 focus:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reserve">
                {values.issuanceBaseCurrency === "USD" && values.reserveAsset !== "CUSTOM"
                  ? "USD"
                  : reserveAssetSymbol}
              </SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {store.items.length > 0 ? (
          <div className="mt-5 flex flex-col gap-5">
            {store.items.map((item, index) => (
              <div key={index} className="bg-melon-50 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-800">Item {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    disabled={disabled}
                    className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                  >
                    Remove
                  </button>
                </div>
                <ItemDraftFields
                  item={item}
                  index={index}
                  priceSymbol={priceSymbol}
                  categories={store.categories}
                  limits={{
                    noNewTiersWithReserves: store.noNewTiersWithReserves,
                    noNewTiersWithVotes: store.noNewTiersWithVotes,
                    noNewTiersWithOwnerMinting: store.noNewTiersWithOwnerMinting,
                    // Every stage of a new revnet keeps the collection's transfer gate closed,
                    // so a non-transferable item here is a permanent guarantee.
                    transferabilityFixed: true,
                  }}
                  disabled={disabled}
                  chains={chains}
                  onAddCategory={addCategory}
                  onChange={(patch) => setItem(index, patch)}
                  onSelectMedia={(file) => selectMedia(index, file)}
                />
              </div>
            ))}
          </div>
        ) : null}

        {mediaError ? <p className="mt-3 text-sm text-red-700">{mediaError}</p> : null}

        <button
          type="button"
          onClick={() => setStore({ items: [...store.items, newDraftItem()] })}
          disabled={disabled}
          className="mt-4 border border-dashed border-zinc-400 bg-white px-4 py-3 text-sm font-medium hover:border-zinc-600 disabled:opacity-50"
        >
          + Add an item
        </button>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setConfigOpen(!configOpen)}
            aria-expanded={configOpen}
            className="text-sm font-medium text-teal-700 hover:text-teal-900"
          >
            Store config {configOpen ? "▾" : "▸"}
          </button>
          {configOpen ? (
            <div className="mt-4 space-y-5 border border-zinc-200 p-4">
              <p className="text-xs text-zinc-500">
                The collection&apos;s name and symbol can be changed later, by the revnet operator
                as long as it keeps &ldquo;Update item metadata&rdquo;. Everything else here is
                fixed when the revnet deploys.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Collection name</Label>
                  <Input
                    value={store.collectionName}
                    onChange={(event) => setStore({ collectionName: event.target.value })}
                    placeholder={values.name ? `${values.name} Store` : "Collection name"}
                    disabled={disabled}
                    className="mt-1 h-11 bg-white"
                  />
                </div>
                <div>
                  <Label className="text-xs">Collection symbol</Label>
                  <Input
                    value={store.collectionSymbol}
                    onChange={(event) => setStore({ collectionSymbol: event.target.value })}
                    placeholder={`${values.tokenSymbol || "TOKEN"}STORE`}
                    disabled={disabled}
                    className="mt-1 h-11 bg-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                {(
                  [
                    [
                      "preventOverspending",
                      "Require exact payment",
                      "Buyers must pay exactly the item price — no overpaying for extra credit.",
                    ],
                    [
                      "noNewTiersWithReserves",
                      "Lock reserved items after launch",
                      "Items added later can never set aside reserved inventory.",
                    ],
                    [
                      "noNewTiersWithVotes",
                      "Lock voting items after launch",
                      "Items added later can never carry custom voting power.",
                    ],
                    [
                      "noNewTiersWithOwnerMinting",
                      "Lock free minting after launch",
                      "Items added later can never be minted for free.",
                    ],
                  ] as const
                ).map(([key, title, blurb]) => (
                  <label key={key} className="flex gap-3 border border-zinc-200 bg-white p-3">
                    <input
                      type="checkbox"
                      checked={store[key]}
                      onChange={() => setStore({ [key]: !store[key] })}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-800">{title}</span>
                      <span className="mt-0.5 block text-xs text-zinc-500">{blurb}</span>
                    </span>
                  </label>
                ))}
                <p className="bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600">
                  Items can&apos;t cash out for surplus: a revnet&apos;s tokens already can, and the
                  two can&apos;t both redeem.
                </p>
              </div>

              <div className="space-y-2 border-t border-zinc-200 pt-4">
                <span className="text-xs font-semibold text-zinc-500">
                  What the revnet operator can do after launch
                </span>
                {(
                  [
                    ["operatorCanAdjustTiers", "Add & remove items"],
                    ["operatorCanUpdateMetadata", "Update item metadata"],
                    ["operatorCanMint", "Mint items for free"],
                    ["operatorCanIncreaseDiscount", "Increase discounts"],
                  ] as const
                ).map(([key, title]) => (
                  <label key={key} className="flex gap-3 border border-zinc-200 bg-white p-3">
                    <input
                      type="checkbox"
                      checked={store[key]}
                      onChange={() => setStore({ [key]: !store[key] })}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span className="text-sm font-medium text-zinc-800">{title}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
