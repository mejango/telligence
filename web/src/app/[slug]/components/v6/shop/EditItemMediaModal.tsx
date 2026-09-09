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
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { jb721TiersHookAbi, type JBChainId } from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import type { ProjectItem } from "../shared";
import { tierDisplayName, type ShopTier, type TierMedia } from "./shopLib";
import { pinMediaEdits, readMediaEditSource } from "./shopMediaEdit";
import { useShopDestinations } from "./useShopDestinations";

export function EditItemMediaModal({
  chainId,
  projectId,
  projects,
  tier,
  media,
  onClose,
}: {
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
  const scope = `shop-media:${chainId}:${projectId}:${tier.id}`;
  const pending = getPendingBatch(scope);
  const [targets, setTargets] = useState<Record<string, number | null>>({
    [`${chainId}:${projectId}`]: tier.id,
  });
  const [file, setFile] = useState<File | null>(null);
  const [uri, setUri] = useState("");
  const [mediaType, setMediaType] = useState("image/png");
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof pinMediaEdits>> | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [phase, setPhase] = useState<"form" | "preparing" | "sending" | "pending" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const busy = phase === "preparing" || phase === "sending";
  const frozen = busy || !!prepared || !!pending;

  const prepare = async () => {
    if (!address || busy) return;
    setError(null);
    setPhase("preparing");
    try {
      if (!file && !/^(?:ipfs:\/\/|https:\/\/)\S+$/u.test(uri.trim()))
        throw new Error("Upload media or enter an HTTPS or IPFS media URI.");
      if (file && file.size > MAX_MEDIA_BYTES) throw new Error("Media must be 500 MB or smaller.");
      const destinations = peers.destinations.filter(
        (destination) => targets[`${destination.chainId}:${destination.projectId}`] !== undefined,
      );
      if (!destinations.length) throw new Error("Choose at least one chain and item.");
      const sources = await Promise.all(
        destinations.map((destination) =>
          readMediaEditSource(
            peers.clientFor(destination.chainId),
            destination,
            targets[`${destination.chainId}:${destination.projectId}`] ?? 0,
            address,
          ),
        ),
      );
      const mediaUri = file ? `ipfs://${await pinMediaFile(file)}` : uri.trim();
      setPrepared(await pinMediaEdits(sources, mediaUri, file?.type || mediaType));
      setReviewing(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("form");
    }
  };

  const submit = async (resume = false) => {
    if (!address || busy || (!prepared && !resume)) return;
    setError(null);
    setPhase("sending");
    setProgress(null);
    try {
      const result = await runBatch({
        label: "Replace shop item media",
        scope,
        onProgress: setProgress,
        calls: resume
          ? []
          : prepared!.map(({ destination, tierId, encodedIpfsUri, preconditions }) => ({
              chainId: destination.chainId,
              address: destination.shop.hook,
              abi: jb721TiersHookAbi,
              functionName: "setMetadata",
              // Empty collection strings and the hook-as-resolver sentinel preserve every unrelated setting.
              args: ["", "", "", "", destination.shop.hook, BigInt(tierId), encodedIpfsUri],
              contractName: "JB721TiersHook",
              recoveryScope: `shop-media:${destination.chainId}:${destination.projectId}:${tierId}`,
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
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replace item media</DialogTitle>
          <DialogDescription>
            Choose the matching item on each chain. Item names, attributes, prices and inventory
            stay as they are; artwork is replaced.
          </DialogDescription>
        </DialogHeader>
        {phase === "done" ? (
          <p>Media updated on every selected chain.</p>
        ) : (
          <>
            <p className="text-sm">{tierDisplayName(media, tier.id)}</p>
            {pending || phase === "pending" ? (
              <div className="space-y-2 bg-melon-50 p-3">
                <p className="text-sm">
                  A saved media update is awaiting completion. Continue it without resubmitting
                  confirmed chains.
                </p>
                <Button disabled={busy} onClick={() => void submit(true)}>
                  Resume saved media update
                </Button>
              </div>
            ) : null}
            <fieldset disabled={frozen} className="space-y-3">
              <legend className="text-sm font-medium">Chains and items to update</legend>
              {peers.destinations.map((destination) => {
                const key = `${destination.chainId}:${destination.projectId}`;
                const selected = targets[key] !== undefined;
                return (
                  <div key={key} className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={`Update media on ${chainDisplayName(destination.chainId)}`}
                        onChange={(event) =>
                          setTargets((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[key] = null;
                            else delete next[key];
                            return next;
                          })
                        }
                      />
                      {chainDisplayName(destination.chainId)} · #{destination.projectId.toString()}
                    </label>
                    {selected ? (
                      <select
                        className="border border-zinc-300 bg-white p-2 text-sm"
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
                        {destination.shop.tiers.map((item) => (
                          <option key={item.id} value={item.id}>
                            Item #{item.id} · category {item.category}
                          </option>
                        ))}
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
              <label className="block text-sm">
                Upload replacement media
                <input
                  className="mt-2 block w-full text-sm"
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf,text/*"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label className="block text-sm">
                Or use a media URI
                <Input
                  aria-label="Replacement media URI"
                  value={uri}
                  onChange={(event) => setUri(event.target.value)}
                  placeholder="ipfs://… or https://…"
                />
              </label>
              {!file ? (
                <label className="flex items-center gap-3 text-sm">
                  Media type
                  <select
                    aria-label="Replacement media type"
                    className="border border-zinc-300 bg-white p-2"
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
            </fieldset>
            {!pending ? (
              <ButtonWithWallet
                loading={busy}
                disabled={busy}
                onClick={() => (prepared ? setReviewing(true) : void prepare())}
              >
                {prepared ? "Continue reviewed media update" : "Review media update"}
              </ButtonWithWallet>
            ) : null}
          </>
        )}
        {error && !reviewing ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </DialogContent>
      {reviewing && prepared ? (
        <TxConfirmDialog
          open
          onOpenChange={setReviewing}
          title="Confirm media replacement"
          chainId={chainId}
          activeIndex={busy ? 0 : -1}
          action="Replace media"
          onConfirm={() => void submit()}
          busy={busy}
          error={error}
          status={progress}
          steps={[
            {
              title: "Replace selected item media",
              detail: "One reviewed call per selected collection.",
            },
          ]}
        >
          {prepared.map(({ destination, tierId, uri: metadataUri }) => (
            <SummaryRow
              key={`${destination.chainId}:${destination.projectId}`}
              label={`${chainDisplayName(destination.chainId)} · project #${destination.projectId} · item #${tierId}`}
            >
              <span className="break-all">{metadataUri}</span>
            </SummaryRow>
          ))}
        </TxConfirmDialog>
      ) : null}
    </Dialog>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update item media.";
}
