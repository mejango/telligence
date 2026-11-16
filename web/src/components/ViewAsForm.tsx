"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEnsAddress } from "@/hooks/ens/useEnsAddress";
import { useViewAs } from "@/lib/view-as";
import { useState } from "react";
import { isAddress } from "viem";

/**
 * Browse the site as any account, without connecting one.
 *
 * Lives at the foot of sign-in because that is the question it answers —
 * "I want to look, not to sign in" — and it should not compete with the ways
 * in that actually transact.
 */
export function ViewAsForm({ onDone }: { onDone: () => void }) {
  const { setViewAs } = useViewAs();
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const typedAddress = isAddress(trimmed) ? trimmed : undefined;
  const looksLikeEns = !typedAddress && trimmed.includes(".");
  const { data: resolvedAddress, isLoading: resolving } = useEnsAddress(
    looksLikeEns ? trimmed : undefined,
    { enabled: looksLikeEns },
  );
  const target = typedAddress ?? (looksLikeEns ? (resolvedAddress ?? undefined) : undefined);

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!target) return;
        setViewAs(target);
        setValue("");
        onDone();
      }}
    >
      <label htmlFor="view-as-account" className="block text-xs text-zinc-500">
        Address or ENS name
      </label>
      <Input
        id="view-as-account"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="0x… or name.eth"
        autoFocus
        className="h-9 px-3 text-sm"
      />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={!target}
        loading={looksLikeEns && resolving}
      >
        View
      </Button>
    </form>
  );
}
