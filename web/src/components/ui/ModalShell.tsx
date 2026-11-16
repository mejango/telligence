"use client";

import { X } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogPortalNode, useNativeModalDialog } from "./dialog";

/*
 * Juicebox Money's modal API, on this app's dialog shell. The transaction
 * review is the same pair of files in every Juicebox client and imports these
 * names, as does the confirm. Here they run on the mechanics every dialog in
 * this app uses: `showModal()`, the top-layer registry (so toasts, select
 * popovers and tooltips attach inside), covering the dialog below, and the
 * scroll lock.
 */

/**
 * The bare native modal: a `<dialog>` opened with `showModal()`, for a modal
 * that draws its own chrome. Content must live in a single wrapper child: a
 * press that lands on the dialog element itself is a backdrop press. React
 * owns the open state, so Escape never closes the dialog by itself; unmounting
 * it does. Its surface scrolls, as Juicebox Money's `.modal-dialog` does, so
 * content taller than the window keeps its header and footer in reach.
 */
export function ModalDialog({
  onClose,
  dismissible = true,
  labelledBy,
  describedBy,
  className = "",
  children,
}: {
  onClose: () => void;
  /** When false, Escape and backdrop presses are ignored (e.g. mid-send). */
  dismissible?: boolean;
  labelledBy?: string;
  describedBy?: string;
  /** Layout utilities for the full-viewport dialog surface. */
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const portalNode = useDialogPortalNode(true);
  const dismiss = () => {
    if (dismissible) onClose();
  };
  useNativeModalDialog({
    dialogRef,
    enabled: portalNode !== null,
    onEscapeKeyDown: (event) => {
      event.preventDefault();
      dismiss();
    },
    onOpenChange: (open) => {
      if (!open) dismiss();
    },
    open: true,
  });

  if (!portalNode) return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={cn("ui-dialog overflow-y-auto focus:outline-none", className)}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      {children}
    </dialog>,
    portalNode,
  );
}

/** One close control for every dialog: full-size target, full-size mark. */
export function ModalCloseButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center text-zinc-700 transition-colors hover:bg-melon-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <X aria-hidden="true" className="h-6 w-6" />
    </button>
  );
}

/**
 * `useEnclosingModalCard()`: the panel of the dialog this component is rendered
 * inside, or null. A confirm uses it to replace the panel's content in place
 * rather than open a second dialog over the first.
 *
 * `useHoldEnclosingModal(held)`: while `held`, that dialog refuses Escape, a
 * backdrop press and its close controls. A hosted confirm has no dialog of its
 * own, so this is how its busy keeps a send in flight on screen.
 */
export { useEnclosingDialogPanel as useEnclosingModalCard, useHoldEnclosingModal } from "./dialog";
