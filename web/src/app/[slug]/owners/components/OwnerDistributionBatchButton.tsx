"use client";

import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { TxError } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { toast } from "@/components/ui/use-toast";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { type GroupWriteTarget, useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { reviewClosed } from "@/lib/review-refusal";
import { formatWalletError } from "@/lib/utils";
import { formatUnits, type JBChainId } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { useAccount } from "wagmi";
import type { DistributionSnapshot } from "./ownerDistributionBatch";

/** Keeps the complete reviewed selection frozen while staged execution is pending. */
const PENDING_LINE =
  "Execution is pending. Try again to check confirmed steps and resume the rest.";

export function OwnerDistributionBatchButton({
  label,
  scope,
  tokenSymbol,
  disabled,
  targets,
  group,
  prepare,
  onSuccess,
}: {
  label: string;
  scope: string;
  tokenSymbol: string;
  disabled?: boolean;
  /** The selected (chain, project) pairs, from the server sucker-group list. */
  targets: readonly GroupWriteTarget[];
  /** Every (chain, project) pair of the group: a batch saved in storage is resumed only when all are verified. */
  group: readonly GroupWriteTarget[];
  prepare: () => Promise<DistributionSnapshot[]>;
  onSuccess?: () => void;
}) {
  const { address, chainId } = useAccount();
  const { runBatch, getPendingBatch } = useMultichainBatch();
  const saved = getPendingBatch(scope);
  const [snapshots, setSnapshots] = useState<DistributionSnapshot[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewedAccount, setReviewedAccount] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fresh = !saved && !pending;
  const gate = useGroupWriteGate(saved ? group : pending ? (snapshots ?? []) : targets);
  const context = [
    ...(saved
      ? [
          {
            label: "Saved selection",
            value: `${saved.completed} of ${saved.total} transactions confirmed`,
          },
        ]
      : []),
    ...(snapshots ?? []).map((row) => ({
      label: `${chainDisplayName(row.chainId)}, project ${String(row.projectId)}`,
      value: `${formatUnits(row.amount, 18)} ${tokenSymbol}`,
      strong: true,
      lines: row.details.map((detail) => `${detail.label}: ${detail.value}`),
    })),
  ];

  async function review() {
    setError(null);
    if (saved || (snapshots && pending)) {
      setOpen(true);
      return;
    }
    setProgress(null);
    setPreparing(true);
    try {
      const rows = await prepare();
      if (rows.length === 0) throw new Error("Select at least one destination.");
      if (new Set(rows.map((row) => row.id)).size !== rows.length)
        throw new Error(
          "The selection contains the same allocation more than once. Reload before continuing.",
        );
      gate.assertVerified(rows);
      setSnapshots(rows);
      setReviewedAccount(address?.toLowerCase() ?? null);
      setOpen(true);
    } catch (cause) {
      setError(formatWalletError(cause));
    } finally {
      setPreparing(false);
    }
  }

  async function submit() {
    if ((!snapshots && !saved) || gate.blocked) return;
    setBusy(true);
    setError(null);
    // Errors can follow confirmed earlier rounds; keep their original snapshots
    // so retries cannot silently recalculate an amount or replay completed calls.
    setPending(true);
    try {
      if (snapshots && address?.toLowerCase() !== reviewedAccount)
        throw new Error(
          "The connected account changed. Reconnect the account used for this review.",
        );
      const result = await runBatch({
        label,
        scope,
        context,
        calls: saved ? [] : (snapshots ?? []).map((row) => row.call),
        onProgress: setProgress,
      });
      if (result.status === "pending") {
        setError(PENDING_LINE);
        return;
      }
      toast({
        title: `${label}: confirmed`,
        description: "Every selected transaction was confirmed.",
      });
      setPending(false);
      setOpen(false);
      setSnapshots(null);
      onSuccess?.();
    } catch (cause) {
      const savedBatch = getPendingBatch(scope);
      if (reviewClosed(cause)) {
        setPending(Boolean(savedBatch));
        setOpen(false);
        return;
      }
      setPending(Boolean(savedBatch));
      if (!savedBatch) {
        setSnapshots(null);
        setOpen(false);
      }
      setError(formatWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ButtonWithWallet
        targetChainId={chainId as JBChainId | undefined}
        variant="outline"
        disabled={(disabled && fresh) || gate.blocked}
        loading={preparing || busy || gate.pending}
        onClick={() => void review()}
      >
        {saved
          ? `Resume saved batch (${saved.completed}/${saved.total} confirmed)`
          : pending
            ? `Continue ${label.toLowerCase()}`
            : label}
      </ButtonWithWallet>
      {gate.line ? <p className="text-xs text-zinc-600">{gate.line}</p> : null}
      <TxError error={open ? null : error} />
      {snapshots || saved ? (
        <TxProgress
          open={open}
          onClose={() => setOpen(false)}
          title={`Confirm ${label.toLowerCase()}`}
          steps={(snapshots ?? []).map((row) => ({
            title: `Project ${row.projectId} on ${chainDisplayName(row.chainId)}`,
            detail: `${formatUnits(row.amount, 18)} ${tokenSymbol}`,
          }))}
          stepsIntro="Review every selected transaction. Confirmed steps are retained if execution takes more than one round."
          activeIndex={busy ? 0 : -1}
          start={() => void submit()}
          busy={busy}
          error={error}
          rows={context}
          status={progress}
        />
      ) : null}
    </>
  );
}
