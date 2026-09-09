"use client";

import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  MAX_MEDIA_BYTES,
  newDraftItem,
  pinDraftItems,
  type DraftItem,
} from "@/components/shop/itemDraft";
import { ItemDraftFields } from "@/components/shop/ItemDraftFields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { jb721TiersHookAbi, JBChainId } from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { ProjectItem } from "../shared";
import { addItemsConditions, tierConfigsForDestination, type ShopReadCondition } from "./shopBatch";
import { ShopInventory } from "./shopLib";
import { useShopDestinations, type ShopDestination } from "./useShopDestinations";

/**
 * Operator "+ Add items" (website/ openAddTierModal + submitAddTiers parity):
 * stage items → simulate `adjustTiers` on the 721 hook → send. Simulation runs
 * first on every submit so a would-revert call never reaches the wallet.
 */
export function AddItemsModal({
  shop,
  chainId,
  projectId,
  categories,
  projects,
  onClose,
}: {
  shop: ShopInventory;
  chainId: JBChainId;
  projectId: bigint;
  categories: { id: number; name: string }[];
  projects: ProjectItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { runBatch, getPendingBatch } = useMultichainBatch();
  const scope = `shop-add:${chainId}:${projectId}`;
  const saved = getPendingBatch(scope);
  const peers = useShopDestinations(projects, chainId, projectId);
  const [selected, setSelected] = useState<string[]>([`${chainId}:${projectId}`]);
  const [prices, setPrices] = useState<Record<string, Record<number, string>>>({});
  const destinations = peers.destinations.filter((destination) =>
    selected.includes(`${destination.chainId}:${destination.projectId}`),
  );
  const [prepared, setPrepared] = useState<Array<{
    destination: ShopDestination;
    configs: ReturnType<typeof tierConfigsForDestination>;
    preconditions: ShopReadCondition[];
  }> | null>(null);

  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [phase, setPhase] = useState<
    | "form"
    | "checking"
    | "pinning"
    | "simulating"
    | "sending"
    | "confirming"
    | "safe-proposed"
    | "done"
  >("form");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const mediaPreviews = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const preview of mediaPreviews.current) URL.revokeObjectURL(preview);
      mediaPreviews.current.clear();
    },
    [],
  );

  const busy =
    phase === "checking" ||
    phase === "pinning" ||
    phase === "simulating" ||
    phase === "sending" ||
    phase === "confirming";

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setError(null);
  };

  const selectMedia = (index: number, file: File | null) => {
    if (file && file.size > MAX_MEDIA_BYTES) {
      setError("Media must be 500 MB or smaller.");
      return;
    }
    const previous = items[index]?.mediaPreview;
    if (previous) {
      URL.revokeObjectURL(previous);
      mediaPreviews.current.delete(previous);
    }
    const mediaPreview = file?.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (mediaPreview) mediaPreviews.current.add(mediaPreview);
    updateItem(index, {
      mediaFile: file,
      mediaPreview,
    });
  };

  const removeItem = (index: number) => {
    const preview = items[index]?.mediaPreview;
    if (preview) {
      URL.revokeObjectURL(preview);
      mediaPreviews.current.delete(preview);
    }
    setItems((current) => current.filter((_, i) => i !== index));
    setPrices((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, overrides]) => [
          key,
          Object.fromEntries(
            Object.entries(overrides)
              .filter(([itemIndex]) => Number(itemIndex) !== index)
              .map(([itemIndex, price]) => [
                Number(itemIndex) > index ? Number(itemIndex) - 1 : Number(itemIndex),
                price,
              ]),
          ),
        ]),
      ),
    );
    setError(null);
  };

  const review = async () => {
    if (!address || busy || !destinations.length) return;
    setError(null);
    setPhase("checking");
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (
          (item.description.trim() || item.mediaUri.trim() || item.mediaFile) &&
          !item.name.trim()
        ) {
          throw new Error(`Item ${index + 1}: enter a name when composing item metadata.`);
        }
      }
      await Promise.all(
        destinations.map(async (destination) => {
          tierConfigsForDestination(
            items,
            destination,
            prices[`${destination.chainId}:${destination.projectId}`],
          );
          await addItemsConditions(peers.clientFor(destination.chainId), destination, address);
        }),
      );
      setReviewing(true);
    } catch (err) {
      setError(shortError(err));
    } finally {
      setPhase("form");
    }
  };

  const submit = async (resume = false) => {
    if (!address || busy) return;
    setError(null);
    setProgress(null);
    try {
      let batch = prepared;
      if (!batch && !resume) {
        setPhase("checking");
        // Every destination is authorized before uploading any media.
        const conditions = await Promise.all(
          destinations.map((destination) =>
            addItemsConditions(peers.clientFor(destination.chainId), destination, address),
          ),
        );
        setPhase("pinning");
        const pinned = await pinDraftItems(items, categories);
        batch = destinations.map((destination, index) => ({
          destination,
          configs: tierConfigsForDestination(
            pinned,
            destination,
            prices[`${destination.chainId}:${destination.projectId}`],
          ),
          preconditions: conditions[index],
        }));
        setPrepared(batch);
      }
      setPhase("sending");
      const result = await runBatch({
        label: "Add shop items",
        scope,
        onProgress: setProgress,
        calls: resume
          ? []
          : batch!.map(({ destination, configs, preconditions }) => ({
              chainId: destination.chainId,
              address: destination.shop.hook,
              abi: jb721TiersHookAbi,
              functionName: "adjustTiers",
              args: [configs, []],
              contractName: "JB721TiersHook",
              recoveryScope: `shop-add:${destination.chainId}:${destination.projectId}`,
              preconditions,
            })),
      });
      if (result.status === "pending") {
        setPhase("safe-proposed");
        setReviewing(false);
        return;
      }
      await Promise.all(
        (batch ?? peers.destinations.map((destination) => ({ destination }))).flatMap(
          ({ destination }) => [
            queryClient.invalidateQueries({
              queryKey: ["v6Shop721", destination.chainId, destination.projectId.toString()],
            }),
            queryClient.invalidateQueries({
              queryKey: ["v6PayShop", destination.chainId, destination.projectId.toString()],
            }),
            queryClient.invalidateQueries({
              queryKey: ["v6Shop721TierMedia", destination.chainId, destination.shop.hook],
            }),
          ],
        ),
      );
      setReviewing(false);
      setPhase("done");
    } catch (err) {
      setPhase("form");
      setError(shortError(err));
    }
  };

  const status =
    progress ??
    (phase === "checking"
      ? "Checking the shop and your permissions…"
      : phase === "pinning"
        ? "Pinning metadata…"
        : phase === "simulating"
          ? "Simulating…"
          : phase === "sending"
            ? "Confirm in wallet…"
            : phase === "confirming"
              ? "Confirming…"
              : null);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add items for sale</DialogTitle>
          <DialogDescription>
            Stage items and choose the collections to stock. Review each chain’s prices and
            inventory before submitting.
          </DialogDescription>
        </DialogHeader>

        {phase === "done" || phase === "safe-proposed" ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-zinc-900">
              {phase === "safe-proposed"
                ? "Shop update pending"
                : "Items added to every selected collection."}
            </p>
            {phase === "safe-proposed" ? (
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
                Follow the transaction status for submitted destinations, then continue this same
                update. Confirmed chains will not be submitted again.
              </p>
            ) : null}
            {phase === "safe-proposed" ? (
              <Button className="mt-4 mr-2" onClick={() => void submit(true)}>
                Check and continue
              </Button>
            ) : null}
            <Button className="mt-4" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            {saved ? (
              <div className="space-y-2 bg-melon-50 p-3">
                <p className="text-sm">
                  A saved shop update is awaiting completion. Confirmed chains will not be submitted
                  again.
                </p>
                <Button disabled={busy} onClick={() => void submit(true)}>
                  Resume saved shop update
                </Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-5">
              {items.map((item, index) => (
                <div key={index} className="bg-melon-50 p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-800">Item {index + 1}</span>
                    {items.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        disabled={busy || !!prepared || !!saved}
                        className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <ItemDraftFields
                    item={item}
                    index={index}
                    priceSymbol={shop.pricing.symbol}
                    categories={categories}
                    limits={{
                      noNewTiersWithReserves: shop.configFlags?.noNewTiersWithReserves,
                      noNewTiersWithVotes: shop.configFlags?.noNewTiersWithVotes,
                      noNewTiersWithOwnerMinting: shop.configFlags?.noNewTiersWithOwnerMinting,
                      transferabilityFixed: shop.fixedTierTransferability,
                    }}
                    disabled={busy || !!prepared || !!saved}
                    chains={destinations.map((destination) => destination.chainId)}
                    onChange={(patch) => updateItem(index, patch)}
                    onSelectMedia={(file) => selectMedia(index, file)}
                  />
                </div>
              ))}

              <button
                type="button"
                onClick={() => setItems((current) => [...current, newDraftItem()])}
                disabled={busy || !!prepared || !!saved}
                className="self-start border border-dashed border-zinc-400 px-4 py-2.5 text-sm text-zinc-600 hover:border-zinc-700 hover:text-zinc-900"
              >
                + Add an item
              </button>

              <div className="w-full border-t border-zinc-200 pt-5">
                <Label className="text-xs">Add on</Label>
                <div
                  role="group"
                  aria-label="Chains to add items on"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {peers.destinations.map((destination) => {
                    const key = `${destination.chainId}:${destination.projectId}`;
                    return (
                      <label
                        key={key}
                        className="inline-flex min-h-11 items-center gap-2 border border-zinc-300 px-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Add on ${chainDisplayName(destination.chainId)}`}
                          checked={selected.includes(key)}
                          disabled={busy || !!prepared || !!saved}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, key]
                                : current.filter((entry) => entry !== key),
                            )
                          }
                        />
                        <ChainLogo chainId={destination.chainId} width={22} height={22} />
                        {chainDisplayName(destination.chainId)} · #
                        {destination.projectId.toString()}
                      </label>
                    );
                  })}
                  {peers.isLoading ? (
                    <p className="text-xs text-zinc-500">Loading linked shops…</p>
                  ) : null}
                  {peers.unavailable.map((destination) => (
                    <p
                      key={`${destination.chainId}:${destination.projectId}`}
                      className="text-xs text-red-700"
                    >
                      Shop unavailable on {chainDisplayName(destination.chainId)}.
                    </p>
                  ))}
                </div>
              </div>
              {destinations.map((destination) => {
                const key = `${destination.chainId}:${destination.projectId}`;
                return (
                  <fieldset key={key} className="space-y-2 border-t border-zinc-200 pt-3">
                    <legend className="text-sm">
                      {chainDisplayName(destination.chainId)} prices (
                      {destination.shop.pricing.symbol}; {destination.shop.pricing.decimals}{" "}
                      decimals)
                    </legend>
                    {items.map((item, index) => (
                      <label key={index} className="flex items-center gap-3 text-xs">
                        {item.name || `Item ${index + 1}`}
                        <Input
                          aria-label={`Item ${index + 1} price on ${chainDisplayName(destination.chainId)}`}
                          value={prices[key]?.[index] ?? item.price}
                          disabled={busy || !!prepared || !!saved}
                          onChange={(event) =>
                            setPrices((current) => ({
                              ...current,
                              [key]: { ...current[key], [index]: event.target.value },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>

            {error && !reviewing ? (
              <p role="alert" className="bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <ButtonWithWallet
                targetChainId={chainId}
                loading={busy}
                disabled={busy || !!saved || (!prepared && !destinations.length)}
                onClick={() => (prepared ? setReviewing(true) : void review())}
                connectWalletText="Connect Wallet"
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                {prepared ? "Continue reviewed update" : "Add items"}
              </ButtonWithWallet>
            </div>
          </>
        )}
      </DialogContent>
      {reviewing ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewing(false);
          }}
          title="Confirm items"
          chainId={chainId}
          preparing={phase === "checking"}
          steps={[
            {
              title: `Add ${items.length} item${items.length === 1 ? "" : "s"}`,
              detail: `One call per selected collection across ${destinations.length} chain${destinations.length === 1 ? "" : "s"}.`,
            },
          ]}
          activeIndex={busy ? 0 : -1}
          action="Add items"
          onConfirm={() => void submit()}
          busy={busy}
          status={status}
          error={error}
        >
          {items.map((item, index) => (
            <SummaryRow key={index} label={item.name.trim() || `Item ${index + 1}`}>
              <span className="block text-xs text-zinc-500">
                {item.supply.trim() ? `${item.supply.trim()} in stock` : "Unlimited stock"}
              </span>
            </SummaryRow>
          ))}
          {destinations.map((destination) => (
            <SummaryRow
              key={`${destination.chainId}:${destination.projectId}`}
              label={`${chainDisplayName(destination.chainId)} · #${destination.projectId}`}
            >
              {items.map((item, index) => (
                <span className="block" key={index}>
                  {item.name || `Item ${index + 1}`}:{" "}
                  {prices[`${destination.chainId}:${destination.projectId}`]?.[index] ?? item.price}{" "}
                  {destination.shop.pricing.symbol} ·{" "}
                  {item.perChainSupply[destination.chainId] || item.supply || "Unlimited"} stock
                </span>
              ))}
            </SummaryRow>
          ))}
        </TxConfirmDialog>
      ) : null}
    </Dialog>
  );
}

function shortError(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { shortMessage?: string; message?: string };
    return err.shortMessage || err.message || "Could not add the items.";
  }
  return "Could not add the items.";
}
