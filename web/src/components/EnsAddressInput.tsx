"use client";

import { Input } from "@/components/ui/input";
import { useEnsAddress } from "@/hooks/ens/useEnsAddress";
import { useEffect } from "react";
import { isAddress, type Address } from "viem";

/**
 * An address field that also takes an ENS name. The typed text stays the
 * field's value; `onResolved` reports the address it stands for, or null
 * while it stands for none.
 */
export function EnsAddressInput({
  value,
  onChange,
  onResolved,
  disabled,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onResolved: (address: Address | null) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const trimmed = value.trim();
  const typed = isAddress(trimmed) ? trimmed : null;
  const isName = !typed && trimmed.includes(".");
  const { data, isLoading } = useEnsAddress(isName ? trimmed : undefined, { enabled: isName });
  const resolved = typed ?? (isName ? (data ?? null) : null);
  useEffect(() => {
    onResolved(resolved);
    // The parent's setter is stable; only the resolved address matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);
  return (
    <div className="grid gap-1">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-8 text-xs font-mono"
        spellCheck={false}
      />
      {isName ? (
        <span className="text-xs text-zinc-500">
          {isLoading ? "Looking up…" : data ? `→ ${data}` : "Name not found"}
        </span>
      ) : trimmed && !typed ? (
        <span className="text-xs text-zinc-500">Not a valid address</span>
      ) : null}
    </div>
  );
}
