"use client";

import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TxError } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import {
  requireProposedOrDone,
  reviewClosed,
  reviewedCall,
  ReviewRefusal,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import { jb721TiersHookAbi, type JBChainId } from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { isAddress, zeroAddress, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { assertCanMint721Tier } from "./shopPermissions";

export function buildOwnerMintTierIds(tierId: number, quantity: number): number[] {
  if (!Number.isSafeInteger(tierId) || tierId < 1 || tierId > 65_535) {
    throw new Error("The item tier ID is invalid.");
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) {
    throw new Error("Mint between 1 and 50 items at once.");
  }
  return Array.from({ length: quantity }, () => tierId);
}

export function MintItemModal({
  chainId,
  projectId,
  hook,
  tierId,
  itemName,
  remaining,
  onClose,
}: {
  chainId: JBChainId;
  projectId: bigint;
  hook: `0x${string}`;
  tierId: number;
  itemName: string;
  remaining: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId });
  const { address } = useAccount();
  const { run } = useReviewedAction();
  const [beneficiary, setBeneficiary] = useState(address ?? "");
  const [quantity, setQuantity] = useState("1");
  const [phase, setPhase] = useState<
    "form" | "checking" | "sending" | "confirming" | "safe-proposed" | "done"
  >("form");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const maxQuantity = Math.max(0, Math.min(50, remaining));
  const busy = phase === "checking" || phase === "sending" || phase === "confirming";
  const chainName = chainDisplayName(chainId);
  const context = [
    {
      label: "Mints",
      value: `${quantity} × ${itemName}`,
      note: `Item #${tierId}, without payment`,
      strong: true,
    },
    { label: "On", value: chainName },
    { label: "To", value: beneficiary.trim(), mono: true },
  ];

  const validate = () => {
    const recipient = beneficiary.trim();
    const count = Number(quantity);
    if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress) {
      setError("Enter a valid, non-zero beneficiary address.");
      return null;
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > maxQuantity) {
      setError(`Choose between 1 and ${maxQuantity} items.`);
      return null;
    }
    return { recipient, count };
  };

  const review = async () => {
    if (!address || !publicClient || busy) return;
    const input = validate();
    if (!input) return;
    setError(null);
    setReviewing(true);
    try {
      setPhase("checking");
      await assertCanMint721Tier(publicClient as PublicClient, {
        chainId,
        projectId,
        hook,
        operator: address,
        tierId,
        quantity: input.count,
      });
      setPhase("form");
    } catch (cause) {
      setPhase("form");
      setReviewing(false);
      setError(cause instanceof Error ? cause.message : "Could not mint this item.");
    }
  };

  const submit = async () => {
    if (!address || !publicClient || busy) return;
    const input = validate();
    if (!input) return;
    const { recipient, count } = input;

    setError(null);
    try {
      // Repeating a uint16 tier id is the hook's exact quantity encoding. The
      // reviewed-write boundary rechecks the live hook, permission, flag, and
      // inventory after review, then simulates this exact call before signing.
      const tierIds = buildOwnerMintTierIds(tierId, count);
      const request = {
        chainId,
        address: hook,
        abi: jb721TiersHookAbi,
        functionName: "mintFor" as const,
        args: [tierIds, recipient] as const,
      };

      setPhase("sending");
      const operator = address;
      const result = requireProposedOrDone(
        await run({
          account: operator,
          title: "Review free item mint",
          description:
            "This consumes shop inventory, sends the items to the beneficiary, collects no payment, and cannot be undone.",
          confirmLabel: "Confirm & mint",
          context,
          // The live hook, permission, flag and inventory, right before the wallet.
          reverify: async () => {
            await assertCanMint721Tier(publicClient as PublicClient, {
              chainId,
              projectId,
              hook,
              operator,
              tierId,
              quantity: count,
            }).catch((cause: Error) => {
              throw new ReviewRefusal(cause.message);
            });
          },
          onSubmitted: (_call, _step, hash) => {
            setTxHash(hash);
            setPhase("confirming");
          },
          calls: [
            reviewedCall(request, { label: `Mint ${itemName}`, contractName: "JB721TiersHook" }),
          ],
        }),
      );
      if (result.status === "proposed") {
        setTxHash(result.safeTxHash);
        setReviewing(false);
        setPhase("safe-proposed");
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["v6Shop721", chainId, projectId.toString()],
        }),
        queryClient.invalidateQueries({ queryKey: ["v6Shop721TierSupply"] }),
        queryClient.invalidateQueries({ queryKey: ["v6PayShop", chainId, projectId.toString()] }),
      ]);
      setReviewing(false);
      setPhase("done");
    } catch (cause) {
      setPhase("form");
      if (reviewClosed(cause)) setReviewing(false);
      else setError(cause instanceof Error ? cause.message : "Could not mint this item.");
    }
  };

  const status =
    phase === "checking"
      ? "Checking the shop and your permissions…"
      : phase === "sending"
        ? "Confirm in wallet…"
        : phase === "confirming"
          ? "Confirming…"
          : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mint {itemName} without payment</DialogTitle>
          <DialogDescription>
            Send inventory on {chainDisplayName(chainId)} to a beneficiary.
          </DialogDescription>
        </DialogHeader>

        {phase === "done" || phase === "safe-proposed" ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-zinc-900">
              {phase === "safe-proposed" ? "Safe proposal submitted" : "Items minted"}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-600">
              {phase === "safe-proposed"
                ? "The mint is not executed yet. It still needs the Safe’s approvals and onchain execution."
                : `${quantity} × ${itemName} sent to ${beneficiary.trim()}.`}
            </p>
            {txHash ? (
              <p className="mt-2 break-all font-mono text-xs text-zinc-500">{txHash}</p>
            ) : null}
            <Button className="mt-5" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <p className="border border-amber-300 px-4 py-3 text-sm text-amber-900">
              Free minting consumes inventory and is irreversible. The item must allow operator
              mints, which is checked again before sending.
            </p>
            <div className="space-y-4">
              <div>
                <Label htmlFor="mint-item-beneficiary">Beneficiary address</Label>
                <Input
                  id="mint-item-beneficiary"
                  value={beneficiary}
                  onChange={(event) => {
                    setBeneficiary(event.target.value.slice(0, 64));
                    setError(null);
                  }}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  className="mt-2 h-11 font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="mint-item-quantity">Quantity</Label>
                <Input
                  id="mint-item-quantity"
                  type="number"
                  min={1}
                  max={maxQuantity}
                  step={1}
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value.slice(0, 2));
                    setError(null);
                  }}
                  disabled={busy}
                  className="mt-2 h-11 w-28"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Up to {maxQuantity} per transaction and no more than current inventory.
                </p>
              </div>
            </div>
            <TxError error={reviewing ? null : error} />
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <ButtonWithWallet
                targetChainId={chainId}
                onClick={() => void review()}
                loading={busy}
                disabled={busy || maxQuantity === 0}
                connectWalletText="Connect Wallet"
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                Mint
              </ButtonWithWallet>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      {reviewing ? (
        <TxProgress
          open
          onClose={() => setReviewing(false)}
          title="Confirm mint"
          preparing={phase === "checking"}
          steps={[
            {
              title: `Mint ${quantity} × ${itemName}`,
              detail: "Consumes inventory; nothing is paid.",
            },
          ]}
          activeIndex={busy ? 0 : -1}
          start={() => void submit()}
          busy={busy}
          status={status}
          error={error}
          rows={context}
        />
      ) : null}
    </Dialog>
  );
}
