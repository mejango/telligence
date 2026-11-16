"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { addStepsToBatch, describeStep } from "@/lib/safe-batch";
import { resolvePreset, SAFE_BATCH_PRESETS, type PresetResolution } from "@/lib/safe-batch-presets";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { chainName, publicClientFor, type ChainProjectRow } from "./operatorLib";

type Resolved = { row: ChainProjectRow; result: PresetResolution };

/**
 * Resolve a preset against every project chain and stage its steps: a chain
 * checklist (available chains pre-checked), the resolved steps, then one
 * "Add N steps to batch".
 * Nothing is submitted here.
 */
export function SafeBatchPresetDialog({
  rows,
  open,
  onOpenChange,
}: {
  rows: ChainProjectRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const preset = SAFE_BATCH_PRESETS[0]!;
  const { toast } = useToast();
  const [unchecked, setUnchecked] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const resolution = useQuery({
    queryKey: [
      "safe-batch-preset",
      preset.id,
      rows.map((row) => `${row.chainId}:${row.projectId}`).join(","),
    ],
    enabled: open,
    staleTime: 15_000,
    retry: 1,
    queryFn: (): Promise<Resolved[]> =>
      Promise.all(
        rows.map(async (row) => ({
          row,
          result: await resolvePreset(preset, {
            chainId: row.chainId,
            projectId: row.projectId,
            client: publicClientFor(row.chainId),
          }),
        })),
      ),
  });
  const resolved = resolution.data ?? [];
  const ready = resolved.filter(
    (item): item is Resolved & { result: Extract<PresetResolution, { status: "ready" }> } =>
      item.result.status === "ready" && !unchecked.has(item.row.chainId),
  );
  const count = ready.reduce((sum, item) => sum + item.result.steps.length, 0);

  const add = () => {
    setError(null);
    try {
      const chains = addStepsToBatch(
        ready.flatMap(({ result }) => result.steps),
        ready.flatMap(({ result }) => result.dropped),
      );
      toast({
        title: "Added to the batch",
        description: `Added to the batch for ${chains.map(chainName).join(", ")}.`,
      });
      onOpenChange(false);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="text-base font-medium">{preset.title}</DialogTitle>
        <p className="text-xs text-zinc-500">{preset.description}</p>
        {resolution.isLoading ? (
          <SkeletonLines lines={4} />
        ) : resolution.isError ? (
          <p className="text-sm text-red-600">Could not read the project's hook and gateway.</p>
        ) : (
          <div className="divide-y divide-melon-200">
            {resolved.map(({ row, result }) => (
              <div key={row.chainId} className="py-3 text-xs first:pt-0 last:pb-0">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={result.status !== "ready"}
                    checked={result.status === "ready" && !unchecked.has(row.chainId)}
                    onChange={(event) =>
                      setUnchecked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.delete(row.chainId);
                        else next.add(row.chainId);
                        return next;
                      })
                    }
                  />
                  <ChainLogo chainId={row.chainId} width={14} height={14} />
                  {chainName(row.chainId)}
                </label>
                {result.status !== "ready" ? (
                  <p className="mt-1 text-zinc-500">{result.message}</p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {result.steps.map((step, index) => (
                      <li key={step.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-500">{index + 1}.</span>
                        <span className="font-medium text-zinc-900">{step.label}</span>
                        <span className="text-zinc-500">{describeStep(step)}</span>
                      </li>
                    ))}
                    {result.notes.map((note) => (
                      <li key={note} className="text-zinc-500">
                        {note}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" disabled={count === 0} onClick={add}>
            Add {count} step{count === 1 ? "" : "s"} to batch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
