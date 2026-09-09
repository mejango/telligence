"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { toast } from "@/components/ui/use-toast";
import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import { formatWalletError } from "@/lib/utils";
import { formatUnits, JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { useAccount } from "wagmi";
import type { DistributionSnapshot } from "./ownerDistributionBatch";

/** Keeps the complete reviewed selection frozen while staged execution is pending. */
export function OwnerDistributionBatchButton({
  label,
  scope,
  tokenSymbol,
  disabled,
  prepare,
  onSuccess,
}: {
  label: string;
  scope: string;
  tokenSymbol: string;
  disabled?: boolean;
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
    if (!snapshots && !saved) return;
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
        calls: saved ? [] : (snapshots ?? []).map((row) => row.call),
        onProgress: setProgress,
      });
      if (result.status === "pending") return;
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
        disabled={disabled && !pending && !saved}
        loading={preparing || busy}
        onClick={() => void review()}
      >
        {saved
          ? `Resume saved batch (${saved.completed}/${saved.total} confirmed)`
          : pending
            ? `Continue ${label.toLowerCase()}`
            : label}
      </ButtonWithWallet>
      {error && !open ? (
        <p role="alert" className="text-sm text-red-600 mt-2">
          {error}
        </p>
      ) : null}
      {snapshots || saved ? (
        <TxConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={`Confirm ${label.toLowerCase()}`}
          chainId={(chainId ?? snapshots?.[0].chainId ?? 1) as JBChainId}
          steps={(snapshots ?? []).map((row) => ({
            title: `${JB_CHAINS[row.chainId]?.name ?? row.chainId} · project ${row.projectId}`,
            detail: `${formatUnits(row.amount, 18)} ${tokenSymbol}`,
          }))}
          stepsIntro="Review every selected transaction. Confirmed steps are retained if execution takes more than one round."
          activeIndex={busy ? 0 : -1}
          action={pending || saved ? "Continue" : "Confirm selected"}
          onConfirm={() => void submit()}
          busy={busy}
          error={error}
          status={
            progress ??
            (pending && !busy && !error
              ? "Execution is pending. Continue to check confirmed steps and resume the remaining transactions."
              : null)
          }
        >
          <div className="max-h-80 overflow-y-auto space-y-4">
            {saved ? (
              <SummaryRow label="Saved selection">
                {saved.completed} of {saved.total} transactions confirmed
              </SummaryRow>
            ) : null}
            {(snapshots ?? []).map((row) => (
              <div key={row.id} className="space-y-2 border-b border-zinc-200 pb-3">
                <SummaryRow label="On">
                  {JB_CHAINS[row.chainId]?.name ?? row.chainId} · project {String(row.projectId)}
                </SummaryRow>
                <SummaryRow label="Amount">
                  {formatUnits(row.amount, 18)} {tokenSymbol}
                </SummaryRow>
                {row.details.map((detail) => (
                  <SummaryRow key={detail.label} label={detail.label}>
                    <span className="break-all">{detail.value}</span>
                  </SummaryRow>
                ))}
              </div>
            ))}
          </div>
        </TxConfirmDialog>
      ) : null}
    </>
  );
}
