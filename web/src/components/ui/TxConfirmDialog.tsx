"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useEnclosingDialogPanel,
} from "@/components/ui/dialog";
import { X } from "@/components/ui/icons";
import { TxSteps } from "@/components/ui/TxSteps";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, type ComponentProps } from "react";
import { createPortal } from "react-dom";

/**
 * The Pay confirm's shell, for every write: a title, label/value rows, the
 * wallet-prompt queue, then one right-aligned action. Closing is the way back
 * to the form; a flow mid-signature cannot be closed.
 */
export function TxConfirmDialog({
  open,
  onOpenChange,
  title,
  chainId,
  steps,
  activeIndex,
  stepsIntro,
  action,
  onConfirm,
  busy = false,
  disabled = false,
  preparing = false,
  status,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  chainId: JBChainId;
  steps: ComponentProps<typeof TxSteps>["steps"];
  /** Index of the step the wallet is on; -1 before the first prompt. */
  activeIndex: number;
  /** Replaces the "Your wallet will ask for N actions" line. */
  stepsIntro?: string;
  action: string;
  onConfirm: () => void;
  busy?: boolean;
  /** The review is ready, but another input is required before confirming. */
  disabled?: boolean;
  /** Rows and steps are still being read; `status` says what is happening. */
  preparing?: boolean;
  status?: string | null;
  error?: string | null;
  children?: React.ReactNode;
}) {
  const body = (
    <div className="text-left">
      {preparing ? (
        <p className="py-4 text-sm text-zinc-500">{status ?? "Preparing…"}</p>
      ) : (
        <div className="flex flex-col gap-3 py-2">
          {children}
          <TxSteps steps={steps} activeIndex={activeIndex} intro={stepsIntro} />
          {status ? <p className="text-sm text-zinc-500">{status}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      )}
      <div className="flex justify-end">
        <ButtonWithWallet
          targetChainId={chainId}
          loading={busy}
          disabled={busy || preparing || disabled}
          onClick={onConfirm}
          connectWalletText="Connect Wallet"
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          {action}
        </ButtonWithWallet>
      </div>
    </div>
  );

  // While the confirm is mounted in a host dialog, the host shows nothing else.
  const host = useEnclosingDialogPanel();
  useEffect(() => {
    if (!host || !open) return;
    const hidden = Array.from(host.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute("data-tx-confirm") && !child.hidden,
    );
    hidden.forEach((child) => (child.hidden = true));
    return () => hidden.forEach((child) => (child.hidden = false));
  }, [host, open]);

  // Inside a dialog already, the confirm replaces that dialog's body in place:
  // one scrim, one panel, and closing brings the form back.
  if (host) {
    if (!open) return null;
    return createPortal(
      <div data-tx-confirm className="text-left">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>
          <button
            type="button"
            className="opacity-70 hover:opacity-100 disabled:pointer-events-none"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </button>
        </div>
        {body}
      </div>,
      host,
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>{body}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

/** The pay confirm's row grammar: a label on the left, the value on the right. */
export function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-right text-sm text-zinc-900">{children}</span>
    </div>
  );
}
