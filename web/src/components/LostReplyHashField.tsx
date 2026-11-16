"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { isHash, type Hex } from "viem";

/**
 * The hash of a send whose wallet reply was lost, given by the user: checked against the exact
 * send it is for, never sent again. `onCheck` says why a hash was refused, or nothing when it
 * took it. `optional`: an empty field checks the send's saved record instead.
 */
export function LostReplyHashField({
  id,
  busy = false,
  optional = false,
  onCheck,
}: {
  id: string;
  busy?: boolean;
  optional?: boolean;
  onCheck: (hash: Hex | undefined) => Promise<string | null | void>;
}) {
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const value = hash.trim();
  const check = async () => {
    if (value ? !isHash(value) : !optional) return setError("Enter a complete transaction hash.");
    setChecking(true);
    setError(null);
    try {
      setError((await onCheck(value ? (value as Hex) : undefined)) ?? null);
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm">
        Transaction hash, if the wallet reply was lost
      </label>
      <input
        id={id}
        value={hash}
        onChange={(event) => setHash(event.target.value)}
        placeholder="0x…"
        className="w-full border border-teal-200 bg-teal-25 p-2 font-mono text-sm"
        disabled={busy || checking}
      />
      {error ? (
        <p role="alert" className="break-words text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => void check()}
        disabled={busy || checking || (!optional && !value)}
      >
        Check existing transaction
      </Button>
    </div>
  );
}
