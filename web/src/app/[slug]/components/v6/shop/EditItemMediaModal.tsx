"use client";

import { chainDisplayName } from "@/app/constants";
import { pinMediaFile } from "@/app/create/helpers/pinProjectMetaData";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { MAX_MEDIA_BYTES } from "@/components/shop/itemDraft";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TxError } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { reviewClosed } from "@/lib/review-refusal";
import { jb721TiersHookAbi, type JBChainId } from "@bananapus/nana-sdk-core";
import { SHOP_ITEM_DESCRIPTION_MAX, SHOP_ITEM_NAME_MAX } from "@bananapus/nana-sdk-core/v6";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import type { ProjectItem } from "../shared";
import {
  categoryLabel,
  tierDisplayName,
  useTierMedia,
  type ShopInventory,
  type ShopTier,
  type TierMedia,
} from "./shopLib";
import {
  pinDetailEdits,
  pinMediaEdits,
  readMediaEditSource,
  type ItemChange,
} from "./shopMediaEdit";
import { useShopDestinations, type ShopDestination } from "./useShopDestinations";

/** What goes to each chain: new metadata, a discount out of 200, or the removal. */
type PreparedChange = {
  destination: ShopDestination;
  tierId: number;
  preconditions: Awaited<ReturnType<typeof readMediaEditSource>>["preconditions"];
  encodedIpfsUri?: `0x${string}`;
  uri?: string;
};

const COPY = {
  media: {
    title: "Replace item media",
    description: "Choose the matching item on each chain. Only the artwork changes.",
    legend: "Chains and items to update",
    check: "Update media on",
    review: "Review media update",
    resume: "Continue reviewed media update",
    saved:
      "A saved media update is awaiting completion. Continue it without resubmitting confirmed chains.",
    resumeSaved: "Resume saved media update",
    label: "Replace shop item media",
    confirm: "Confirm media replacement",
    step: "Replace selected item media",
    done: "Media updated on every selected chain.",
    fail: "Could not update item media.",
  },
  details: {
    title: "Edit details",
    description:
      "Choose the matching item on each chain. Everything else about the item stays the same.",
    legend: "Chains and items to update",
    check: "Update details on",
    review: "Review details update",
    resume: "Continue reviewed details update",
    saved:
      "A saved details update is awaiting completion. Continue it without resubmitting confirmed chains.",
    resumeSaved: "Resume saved details update",
    label: "Edit shop item details",
    confirm: "Confirm details update",
    step: "Update selected item details",
    done: "Details saved on every selected chain.",
    fail: "Could not update the details.",
  },
  discount: {
    title: "Set discount",
    description: "Choose the matching item on each chain. New purchases pay the discounted price.",
    legend: "Chains and items to update",
    check: "Set the discount on",
    review: "Review discount",
    resume: "Continue reviewed discount",
    saved:
      "A saved discount update is awaiting completion. Continue it without resubmitting confirmed chains.",
    resumeSaved: "Resume saved discount update",
    label: "Set shop item discount",
    confirm: "Confirm discount",
    step: "Set selected item discount",
    done: "Discount set on every selected chain.",
    fail: "Could not set the discount.",
  },
  remove: {
    title: "Remove item",
    description: "Choose the matching item on each chain. It leaves the shop for good.",
    legend: "Chains and items to remove",
    check: "Remove on",
    review: "Review removal",
    resume: "Continue reviewed removal",
    saved:
      "A saved removal is awaiting completion. Continue it without resubmitting confirmed chains.",
    resumeSaved: "Resume saved removal",
    label: "Remove shop item",
    confirm: "Confirm removal",
    step: "Remove selected item",
    done: "Item removed on every selected chain.",
    fail: "Could not remove the item.",
  },
} as const satisfies Record<ItemChange, unknown>;

export function EditItemMediaModal({
  chainId,
  projectId,
  projects,
  tier,
  media,
  mode = "media",
  onClose,
}: {
  /** Which change this dialog makes to the item. */
  mode?: ItemChange;
  chainId: JBChainId;
  projectId: bigint;
  projects: ProjectItem[];
  tier: ShopTier;
  media: TierMedia | undefined;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const peers = useShopDestinations(projects, chainId, projectId);
  const queryClient = useQueryClient();
  const { runBatch, getPendingBatch } = useMultichainBatch();
  const copy = COPY[mode];
  const scope = `shop-${mode}:${chainId}:${projectId}:${tier.id}`;
  const pending = getPendingBatch(scope);
  const [targets, setTargets] = useState<Record<string, number | null>>({
    [`${chainId}:${projectId}`]: tier.id,
  });
  const [file, setFile] = useState<File | null>(null);
  const [uri, setUri] = useState("");
  const [mediaType, setMediaType] = useState("image/png");
  const [name, setName] = useState(media?.name ?? "");
  const [description, setDescription] = useState(media?.description ?? "");
  const [discount, setDiscount] = useState(String(tier.discountPercent / 2));
  const [prepared, setPrepared] = useState<PreparedChange[] | null>(null);
  /** The reviewed discount, out of the hook's 200. */
  const [units, setUnits] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [phase, setPhase] = useState<"form" | "preparing" | "sending" | "pending" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const busy = phase === "preparing" || phase === "sending";
  const frozen = busy || !!prepared || !!pending;
  const chosen = peers.destinations.filter(
    (destination) => targets[`${destination.chainId}:${destination.projectId}`] !== undefined,
  );
  // Peer projects come from the server sucker-group list: edit only registry-listed pairs.
  const group = [{ chainId, projectId }, ...projects];
  const gate = useGroupWriteGate(prepared ? [] : pending ? group : chosen);

  const prepare = async () => {
    if (!address || busy) return;
    setError(null);
    setPhase("preparing");
    try {
      if (mode === "media") {
        if (!file && !/^(?:ipfs:\/\/|https:\/\/)\S+$/u.test(uri.trim()))
          throw new Error("Upload media or enter an https:// or ipfs:// link.");
        if (file && file.size > MAX_MEDIA_BYTES)
          throw new Error("Media must be 500 MB or smaller.");
      }
      // Half a percent is the hook's smallest step.
      const nextUnits = Number(discount) * 2;
      if (
        mode === "discount" &&
        (discount.trim() === "" || !Number.isInteger(nextUnits) || nextUnits < 0 || nextUnits > 200)
      )
        throw new Error("Enter a discount from 0 to 100, in steps of 0.5.");
      const destinations = chosen;
      if (!destinations.length) throw new Error("Choose at least one chain and item.");
      gate.assertVerified(destinations);
      const sources = await Promise.all(
        destinations.map((destination) =>
          readMediaEditSource(
            peers.clientFor(destination.chainId),
            destination,
            targets[`${destination.chainId}:${destination.projectId}`] ?? 0,
            address,
            mode,
          ),
        ),
      );
      if (mode === "discount") {
        if (sources.every((source) => source.discountPercent === nextUnits))
          throw new Error("The selected chains already have this discount.");
        const capped = sources.find(
          (source) => source.cantIncreaseDiscountPercent && nextUnits > source.discountPercent,
        );
        if (capped)
          throw new Error(
            `This item's discount can only be lowered on ${chainDisplayName(capped.destination.chainId)}.`,
          );
        setUnits(nextUnits);
        setPrepared(sources);
      } else if (mode === "remove") setPrepared(sources);
      else if (mode === "details") setPrepared(await pinDetailEdits(sources, name, description));
      else {
        const mediaUri = file ? `ipfs://${await pinMediaFile(file)}` : uri.trim();
        setPrepared(await pinMediaEdits(sources, mediaUri, file?.type || mediaType));
      }
      setReviewing(true);
    } catch (err) {
      setError(errorMessage(err, copy.fail));
    } finally {
      setPhase("form");
    }
  };

  const context = [
    ...(mode === "details"
      ? [
          { label: "New name", value: name.trim() },
          { label: "New description", value: description.trim() || "None" },
        ]
      : []),
    ...(prepared ?? []).map(({ destination, tierId, uri }) => ({
      label: `Item #${tierId} of project #${destination.projectId} on ${chainDisplayName(destination.chainId)}`,
      value: uri ?? (mode === "discount" ? `${units / 2}% off` : "Removed from the shop"),
      mono: !!uri,
    })),
  ];

  const submit = async (resume = false) => {
    if (!address || busy || (!prepared && !resume) || (resume && gate.blocked)) return;
    setError(null);
    setPhase("sending");
    setProgress(null);
    try {
      if (prepared) gate.assertVerified(prepared.map(({ destination }) => destination));
      const result = await runBatch({
        label: copy.label,
        context: resume ? undefined : context,
        scope,
        onProgress: setProgress,
        calls: resume
          ? []
          : prepared!.map(({ destination, tierId, encodedIpfsUri, preconditions }) => ({
              chainId: destination.chainId,
              address: destination.shop.hook,
              abi: jb721TiersHookAbi,
              ...(mode === "discount"
                ? { functionName: "setDiscountPercentOf", args: [BigInt(tierId), BigInt(units)] }
                : mode === "remove"
                  ? { functionName: "adjustTiers", args: [[], [BigInt(tierId)]] }
                  : {
                      functionName: "setMetadata",
                      // Empty collection strings and the hook-as-resolver sentinel preserve every unrelated setting.
                      args: ["", "", "", "", destination.shop.hook, BigInt(tierId), encodedIpfsUri],
                    }),
              contractName: "JB721TiersHook",
              recoveryScope: `shop-${mode}:${destination.chainId}:${destination.projectId}:${tierId}`,
              preconditions,
            })),
      });
      setReviewing(false);
      setPhase(result.status === "success" ? "done" : "pending");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["v6Shop721"] }),
        queryClient.invalidateQueries({ queryKey: ["v6PayShop"] }),
        queryClient.invalidateQueries({ queryKey: ["v6Shop721TierMedia"] }),
      ]);
    } catch (err) {
      setPhase("form");
      if (reviewClosed(err)) setReviewing(false);
      else setError(errorMessage(err, copy.fail));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {phase === "done" ? (
          <p>{copy.done}</p>
        ) : (
          <>
            <p className="text-sm">{tierDisplayName(media, tier.id)}</p>
            {pending || phase === "pending" ? (
              <div className="space-y-2 border border-zinc-200 p-3">
                <p className="text-sm">{copy.saved}</p>
                <Button disabled={busy || gate.blocked} onClick={() => void submit(true)}>
                  {copy.resumeSaved}
                </Button>
              </div>
            ) : null}
            <fieldset disabled={frozen} className="space-y-3">
              <legend className="text-sm font-medium">{copy.legend}</legend>
              {peers.destinations.map((destination) => {
                const key = `${destination.chainId}:${destination.projectId}`;
                const selected = targets[key] !== undefined;
                return (
                  <div key={key} className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={`${copy.check} ${chainDisplayName(destination.chainId)}`}
                        onChange={(event) =>
                          setTargets((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[key] = null;
                            else delete next[key];
                            return next;
                          })
                        }
                        className="h-4 w-4"
                      />
                      {chainDisplayName(destination.chainId)}
                    </label>
                    {selected ? (
                      <select
                        className="min-w-0 max-w-full border-2 border-melon-300 bg-melon-25 p-2 text-sm"
                        aria-label={`Item on ${chainDisplayName(destination.chainId)}`}
                        value={targets[key] ?? ""}
                        onChange={(event) =>
                          setTargets((current) => ({
                            ...current,
                            [key]: event.target.value ? Number(event.target.value) : null,
                          }))
                        }
                      >
                        <option value="">Choose an item…</option>
                        <ItemOptions chainId={destination.chainId} shop={destination.shop} />
                      </select>
                    ) : null}
                  </div>
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
              {mode === "media" ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:border-zinc-500">
                      {file ? "Change media" : "Upload media"}
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/*,video/*,audio/*,application/pdf,text/*"
                        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    {file ? (
                      <span className="min-w-0 text-xs wrap-anywhere">{file.name}</span>
                    ) : null}
                  </div>
                  <label className="block text-sm">
                    Or use a link
                    <Input
                      aria-label="Replacement media URI"
                      value={uri}
                      onChange={(event) => setUri(event.target.value)}
                      placeholder="ipfs://… or https://…"
                      className="mt-2"
                    />
                  </label>
                  {!file ? (
                    <label className="block text-sm">
                      Media type
                      <select
                        aria-label="Replacement media type"
                        className="mt-2 block border-2 border-melon-300 bg-melon-25 p-2"
                        value={mediaType}
                        onChange={(event) => setMediaType(event.target.value)}
                      >
                        <option value="image/png">Image</option>
                        <option value="video/mp4">Video</option>
                        <option value="audio/mpeg">Audio</option>
                        <option value="application/pdf">Document</option>
                      </select>
                    </label>
                  ) : null}
                </>
              ) : mode === "details" ? (
                <>
                  <label className="block text-sm">
                    Name
                    <Input
                      value={name}
                      maxLength={SHOP_ITEM_NAME_MAX}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-2"
                    />
                  </label>
                  <label className="block text-sm">
                    Description
                    <textarea
                      value={description}
                      maxLength={SHOP_ITEM_DESCRIPTION_MAX}
                      rows={4}
                      onChange={(event) => setDescription(event.target.value)}
                      className="mt-2 block w-full border-2 border-melon-300 bg-melon-25 p-2 text-sm"
                    />
                  </label>
                </>
              ) : mode === "discount" ? (
                <label className="block text-sm">
                  Discount (% off)
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                    className="mt-2"
                  />
                </label>
              ) : (
                <p className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  Buyers can no longer mint this item. Items already minted stay with their holders.
                  Adding it again makes a new item.
                </p>
              )}
            </fieldset>
            {!pending ? (
              <ButtonWithWallet
                loading={busy || gate.pending}
                disabled={busy || gate.blocked}
                onClick={() => (prepared ? setReviewing(true) : void prepare())}
              >
                {prepared ? copy.resume : copy.review}
              </ButtonWithWallet>
            ) : null}
          </>
        )}
        {gate.line ? <p className="text-xs text-zinc-600">{gate.line}</p> : null}
        <TxError error={reviewing ? null : error} />
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </DialogContent>
      {reviewing && prepared ? (
        <TxProgress
          open
          onClose={() => setReviewing(false)}
          title={copy.confirm}
          activeIndex={busy ? 0 : -1}
          start={() => void submit()}
          busy={busy}
          error={error}
          status={progress}
          rows={context}
          steps={[
            {
              title: copy.step,
              detail: "One transaction per selected chain.",
            },
          ]}
        />
      ) : null}
    </Dialog>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** A chain's items by the names shoppers know them by. */
function ItemOptions({ chainId, shop }: { chainId: JBChainId; shop: ShopInventory }) {
  const { data: media } = useTierMedia(chainId, shop);
  return shop.tiers.map((item) => (
    <option key={item.id} value={item.id}>
      {tierDisplayName(media[item.id], item.id)}, {categoryLabel(item.category, shop.tiers, media)}
    </option>
  ));
}
