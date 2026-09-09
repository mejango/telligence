"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEnsAddress } from "@/hooks/ens/useEnsAddress";
import { useViewAs } from "@/lib/view-as";
import { useState } from "react";
import { isAddress } from "viem";

/**
 * Prompt for an address or ENS name to browse the whole site as. Activating it
 * only changes what data is displayed; transacting stays refused until exit.
 */
export function ViewAsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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

  const activate = () => {
    if (!target) return;
    setViewAs(target);
    setValue("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>View site as</DialogTitle>
          <DialogDescription>
            Browse the entire site as another account. Balances, holdings, and permissions display
            for that account; transacting is disabled until you exit.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            activate();
          }}
        >
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Address or ENS name"
            aria-label="Account to view the site as"
            autoFocus
          />
          <Button
            type="submit"
            variant="default"
            size="sm"
            className="min-h-10"
            disabled={!target}
            loading={looksLikeEns && resolving}
          >
            View
          </Button>
        </form>
        {looksLikeEns && !resolving && !resolvedAddress ? (
          <p className="text-xs text-zinc-500">That ENS name does not resolve to an address.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
