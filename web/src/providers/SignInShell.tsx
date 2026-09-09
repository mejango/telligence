"use client";

import { BrandMark, WalletFallbackMark } from "@/components/BrandMarks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { offerableWallets } from "@/lib/wallet-list";
import type { TOAuthMethod } from "@getpara/web-sdk";
import { useConnectors } from "wagmi";

/** Kept in step with the sheet's own list. */
const OAUTH_METHODS: { method: TOAuthMethod; label: string }[] = [
  { method: "GOOGLE", label: "Google" },
  { method: "TWITTER", label: "X" },
  { method: "APPLE", label: "Apple" },
  { method: "DISCORD", label: "Discord" },
  { method: "FARCASTER", label: "Farcaster" },
  { method: "TELEGRAM", label: "Telegram" },
  { method: "FACEBOOK", label: "Facebook" },
];

/**
 * The sign-in sheet before Para can drive it.
 *
 * None of what you see here needs Para: the provider marks are inlined SVG
 * and the wallet marks come from EIP-6963 through Wagmi, which is already
 * running. So this renders the real thing rather than grey boxes, and the
 * swap to the live sheet changes nothing visible.
 *
 * The field is genuinely editable, and its value lives above the boundary —
 * so an address typed during the wait is still there when the sheet takes
 * over, rather than being thrown away with this component.
 */
export function SignInShell({
  entry,
  onEntryChange,
}: {
  entry: string;
  onEntryChange: (value: string) => void;
}) {
  const connectors = offerableWallets(useConnectors());

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900">Sign in</h2>
          <p className="mt-1 text-sm text-zinc-600">Use your passkey, or receive a code.</p>
        </div>
      </div>

      <div className="mt-5">
        <Input
          type="text"
          value={entry}
          onChange={(event) => onEntryChange(event.target.value)}
          placeholder="you@email.com | +1 222 333 4444"
          aria-label="Email address or phone number"
          autoComplete="email"
          autoFocus
          className="h-11 px-4"
        />
        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" disabled aria-busy="true">
            Continue
          </Button>
        </div>
      </div>

      <p className="mb-2 mt-5 text-xs text-zinc-500">Or, use socials</p>
      <div className="scroll-row flex gap-1.5 overflow-x-auto">
        {OAUTH_METHODS.map(({ method, label }) => (
          <Button
            key={method}
            type="button"
            variant="secondary"
            disabled
            title={label}
            aria-label={label}
            className="flex h-10 w-10 shrink-0 items-center justify-center px-0"
          >
            <BrandMark method={method} className="h-5 w-5 shrink-0" />
          </Button>
        ))}
      </div>

      <p className="mb-2 mt-4 text-xs text-zinc-500">... or, a wallet.</p>
      <div className="scroll-row flex min-h-10 gap-1.5 overflow-x-auto">
        {connectors.map((connector) => (
          <Button
            key={connector.id}
            type="button"
            variant="secondary"
            disabled
            title={connector.name}
            aria-label={connector.name}
            className="flex h-10 w-10 shrink-0 items-center justify-center px-0"
          >
            {connector.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connector.icon} alt="" className="h-5 w-5 shrink-0" />
            ) : (
              <WalletFallbackMark id={connector.id} className="h-5 w-5 shrink-0" />
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
