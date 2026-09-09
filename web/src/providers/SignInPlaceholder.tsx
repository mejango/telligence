"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Before paint, so the click is acknowledged in the frame it happened in. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Painted the instant sign-in is asked for, while Para's runtime downloads.
 *
 * That runtime is ~725 KiB gzipped and is deliberately not shipped to
 * anonymous visitors, so the first click has to fetch it — several seconds on
 * a slow connection. Rendering nothing until it lands makes the button feel
 * broken, so this stands in: the real sheet's opening, inert, in the same
 * frame, so the swap reads as filling in rather than as a jump.
 *
 * It owns a `showModal()` dialog for the same reason ParaModalHost does —
 * sign-in is reachable from inside other dialogs, and everything outside the
 * topmost one is inert.
 */
export function SignInPlaceholder({
  entry,
  onEntryChange,
}: {
  entry: string;
  onEntryChange: (value: string) => void;
}) {
  const [host] = useState<HTMLDialogElement | null>(() => {
    if (typeof document === "undefined") return null;
    const dialog = document.createElement("dialog");
    dialog.className = "ui-modal-host";
    dialog.dataset.uiModalPortal = "";
    return dialog;
  });

  useBeforePaint(() => {
    if (!host) return;
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);

  // Opening is passive so this lands above any dialog it was launched from,
  // which enters the top layer in its own passive effect.
  useEffect(() => {
    if (host && !host.open) host.showModal();
  }, [host]);

  if (!host) return null;

  return createPortal(
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-black/80 p-6">
      <div className="w-full max-w-sm border border-zinc-200 bg-white p-6">
        <div className="w-full">
          <h2 className="text-lg font-medium text-zinc-900">Sign in</h2>
          <p className="mt-1 text-sm text-zinc-600">Use your passkey, or receive a code.</p>
          <input
            type="text"
            value={entry}
            onChange={(event) => onEntryChange(event.target.value)}
            placeholder="you@email.com | +1 222 333 4444"
            aria-label="Email address or phone number"
            autoComplete="email"
            autoFocus
            className="mt-5 flex h-11 w-full border-2 border-melon-300 bg-melon-25 px-4 text-sm placeholder:text-zinc-500 focus-visible:outline-none"
          />
          <div className="mt-3 flex justify-end">
            <div className="flex h-9 items-center bg-melon-100 px-3 text-sm text-zinc-500">
              Continue
            </div>
          </div>
          {/* Labels and reserved rows, but no provider marks: this component
              is eager, and the marks would ride along on every page load for
              a panel most visitors never open. The full shell renders them a
              moment later, from Para's own chunk. */}
          {["Or, use socials", "... or, a wallet."].map((label) => (
            <div key={label}>
              <p className="mb-2 mt-4 text-xs text-zinc-500">{label}</p>
              <div className="min-h-10" />
            </div>
          ))}
        </div>
      </div>
    </div>,
    host,
  );
}
