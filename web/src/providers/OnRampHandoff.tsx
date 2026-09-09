"use client";

import { Button } from "@/components/ui/button";
import { X } from "@/components/ui/icons";

/**
 * What we say once the purchase is handed to the on-ramp provider.
 *
 * Card purchases of crypto are declined far more often than people expect —
 * the only public study of the question put card authorisation around 43%
 * against 96% for bank transfer — and the decline arrives in the provider's
 * window with no explanation. Saying so up front, with the one lever that
 * actually helps, is cheaper than a support ticket that reads "your site is
 * broken".
 *
 * `url` is the same window we just opened: popup blockers are common enough
 * that the handoff needs a link the visitor can click themselves.
 */
export function OnRampHandoff({
  url,
  asset,
  onClose,
}: {
  url: string;
  /** What the provider is being asked to deliver, so the heading names it. */
  asset?: string;
  onClose: () => void;
}) {
  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-medium text-zinc-900">
          {asset ? `Buy ${asset} in the new window` : "Finish in the new window"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 p-1 text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 text-sm text-zinc-600">
        Your wallet address is already filled in. Purchases don&apos;t always go through on the
        first try — card declines are common and usually come with no explanation.
      </p>

      <p className="mt-4 text-sm font-medium text-zinc-900">If it doesn&apos;t work</p>
      <ul className="mt-1.5 space-y-1.5 text-sm text-zinc-600">
        <li>
          Pick a bank transfer instead of a card if one is offered — it goes through far more often.
        </li>
        <li>Try a smaller amount. Small purchases are approved more often.</li>
        <li>Try a different card, or come back and pick another wallet.</li>
      </ul>

      <div className="mt-5 flex items-center justify-between">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
        >
          Window didn&apos;t open?
        </a>
        <Button type="button" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * The provider's own page, inside our dialog.
 *
 * For a purchase started mid-payment: sending someone to another window loses the thread of
 * what they were doing. Para's portal answers over a `MessagePort` it supplies, so it does not
 * care whether it is a popup or a frame — what it does care about is that the purchase was
 * recorded, which `recordOnRampPurchase` does before this renders.
 */
export function OnRampFrame({
  url,
  asset,
  onClose,
}: {
  url: string;
  asset?: string;
  onClose: () => void;
}) {
  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-medium text-zinc-900">
          {asset ? `Buy ${asset}` : "Buy ETH or USDC"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 p-1 text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Your wallet address is already filled in. Come back here when it&apos;s done.
      </p>
      <iframe
        src={url}
        title={asset ? `Buy ${asset}` : "Buy crypto"}
        className="mt-3 h-[32rem] w-full border border-zinc-200"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
      >
        Open in a separate window instead
      </a>
    </div>
  );
}
