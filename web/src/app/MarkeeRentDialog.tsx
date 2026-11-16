"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { LostReplyHashField } from "@/components/LostReplyHashField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SummaryRow } from "@/components/ui/TxProgress";
import { WalletConnectButton } from "@/components/WalletButton";
import { useMarkee } from "@/hooks/useMarkee";
import {
  MARKEE_ADMIN,
  MARKEE_CHAIN_ID,
  parseMonthlyRate,
  ratePerSecToMonthly,
  recommendedTakeoverMonthlyRate,
  roundUpToNearestThousandth,
  validateMarkeeText,
  type BoardState,
} from "@/lib/markee";
import { useEffect, useRef, useState } from "react";
import { formatEther, type Address } from "viem";
import { useAccount } from "wagmi";

/** What the homepage card shows once the rent dialog's own reads have answered. */
export type MarkeeCardState = {
  boardAddress?: Address;
  board?: BoardState;
  loading: boolean;
  error?: string;
};

/**
 * The Rent dialog and every write and recovery path behind it. It loads when the card's Take over
 * is first opened, and reports its reads back to the card so both show the same board.
 */
export function MarkeeRentDialog({
  initialBoardAddress,
  open,
  onOpenChange,
  onCardState,
}: {
  initialBoardAddress?: Address;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCardState: (state: MarkeeCardState) => void;
}) {
  const markee = useMarkee(initialBoardAddress);
  const { address, isConnected } = useAccount();
  const [message, setMessage] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [preview, setPreview] = useState(false);
  const recommendedRate = markee.board
    ? recommendedTakeoverMonthlyRate(markee.board.minimumMonthlyRate, markee.board.effectiveTopRate)
    : undefined;

  useEffect(() => {
    if (recommendedRate !== undefined) {
      setMonthlyRate((current) => current || formatEther(recommendedRate));
    }
  }, [recommendedRate]);

  let validation: string | undefined;
  let funding: ReturnType<typeof markee.quoteFunding> | undefined;
  if (markee.board && monthlyRate) {
    try {
      if (message.trim()) validateMarkeeText(message.trim(), markee.board.maxMessageLength);
      parseMonthlyRate(monthlyRate, markee.board.minimumMonthlyRate);
      if (markee.wallet) funding = markee.quoteFunding(monthlyRate);
    } catch (error) {
      validation = error instanceof Error ? error.message : "Check your message and rate.";
    }
  }
  const hasStream = Boolean(markee.wallet && markee.wallet.flowRate > 0n);
  const canTakeover = Boolean(
    markee.board &&
    message.trim() &&
    monthlyRate &&
    !validation &&
    !hasStream &&
    !markee.pending &&
    !markee.loading &&
    !markee.error &&
    (!markee.wallet || markee.wallet.deposit === 0n),
  );

  const { boardAddress, board, loading, error, refresh } = markee;
  useEffect(() => {
    onCardState({ boardAddress, board, loading, error });
  }, [onCardState, boardAddress, board, loading, error]);
  // The hook reads on mount, which is this dialog's first open; each later open reads again.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) void refresh();
    wasOpen.current = open;
  }, [open, refresh]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (markee.busy && !nextOpen && !(markee.following && markee.dismiss())) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rent this space</DialogTitle>
          <DialogDescription>
            Stream to feature your message. You can change or stop your stream.
          </DialogDescription>
        </DialogHeader>

        {!markee.board && !markee.loading && !markee.boardAddress && (
          <div className="space-y-3 border border-teal-200 p-4 text-sm">
            <p>This advertisement needs to be set up before it can accept streams.</p>
            {markee.canCreateBoard ? (
              <Button
                type="button"
                onClick={() => void markee.createBoard()}
                disabled={markee.busy || markee.pending}
                className="w-full"
              >
                Create advertisement
              </Button>
            ) : !isConnected ? (
              <>
                <p className="break-words text-xs text-teal-700">
                  Set up from the admin wallet {MARKEE_ADMIN}.
                </p>
                <WalletConnectButton label="Connect admin wallet" className="w-full" />
              </>
            ) : (
              <p className="break-words text-xs text-teal-700">
                Connect the admin wallet {MARKEE_ADMIN} to create the board.
              </p>
            )}
          </div>
        )}

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canTakeover) void markee.takeover(message.trim(), monthlyRate);
          }}
        >
          <div>
            <label htmlFor="markee-message" className="mb-2 block text-sm">
              Your message
            </label>
            <textarea
              id="markee-message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setPreview(false);
              }}
              rows={3}
              required
              disabled={markee.busy}
              placeholder="What would you like to say?"
              className="w-full resize-y border border-teal-200 bg-teal-25 p-3 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          {preview && (
            <div className="border border-teal-200 p-4">
              <p className="mb-2 text-xs text-teal-700">Preview</p>
              <p className="whitespace-pre-wrap break-words text-base">{message.trim()}</p>
            </div>
          )}
          <div className="space-y-3 border border-teal-200 p-4">
            <label htmlFor="markee-monthly-rate" className="block text-sm">
              Your rate
            </label>
            <div className="flex items-center gap-3">
              <input
                id="markee-monthly-rate"
                value={monthlyRate}
                onChange={(event) => setMonthlyRate(event.target.value)}
                inputMode="decimal"
                disabled={markee.busy}
                placeholder="0.00"
                className="min-w-0 flex-1 border border-teal-200 bg-teal-25 p-2 text-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <span className="shrink-0 text-sm">ETH / month</span>
            </div>
            {markee.board && (
              <div className="grid grid-cols-2 gap-3">
                <SummaryRow label="Minimum">
                  {formatEther(roundUpToNearestThousandth(markee.board.minimumMonthlyRate))} ETH /
                  month
                </SummaryRow>
                <SummaryRow label="Leading rate">
                  {formatEther(ratePerSecToMonthly(markee.board.effectiveTopRate))} ETH / month
                </SummaryRow>
              </div>
            )}
            <p className="text-xs leading-relaxed text-teal-700">
              The leading message is featured. Beneficiary proceeds stream as ETHx to team.rev.eth
              on Base. Gas and refundable buffer deposits apply.
            </p>
            {funding && (
              <p className="text-xs leading-relaxed text-teal-700">
                Wrap {formatEther(funding.wrapValue)} ETH into ETHx upfront, targeting one month of
                funding plus required buffers. Other streams share this balance. Unspent ETHx stays
                in your wallet.
              </p>
            )}
          </div>
          {validation && <p className="text-sm text-red-700">{validation}</p>}
          {markee.error && (
            <p role="alert" className="break-words text-sm text-red-700">
              {markee.error}
            </p>
          )}
          {markee.status && (
            <p role="status" className="break-words text-sm text-teal-700">
              {markee.status}
            </p>
          )}
          {markee.pending && (
            // Empty, it checks the saved submission; Markee's own check shows its line.
            <LostReplyHashField
              id="markee-recovery-hash"
              busy={markee.busy}
              optional
              onCheck={(hash) => markee.recover(hash)}
            />
          )}
          {markee.error && !markee.busy && (
            <Button type="button" variant="outline" onClick={() => void markee.refresh()}>
              Retry checks
            </Button>
          )}
          {hasStream && (
            <div className="space-y-2 text-sm">
              <p>
                You already back a message on this board. Stop it and withdraw its buffer before
                creating a new one.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void markee.stop()}
                disabled={markee.busy || markee.pending}
              >
                Stop stream
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void markee.updateStream(monthlyRate)}
                disabled={markee.busy || markee.pending || !monthlyRate || !!validation}
              >
                Update stream
              </Button>
            </div>
          )}
          {markee.wallet && markee.wallet.deposit > 0n && !hasStream && (
            <div className="space-y-2">
              <p className="text-sm">Withdraw the unused buffer before starting a new stream.</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void markee.withdraw()}
                disabled={markee.busy || markee.pending}
              >
                Withdraw unused deposit
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPreview(!preview)}
              disabled={!message.trim() || markee.busy}
            >
              Preview
            </Button>
            <ButtonWithWallet
              targetChainId={MARKEE_CHAIN_ID}
              connectWalletText="Take over"
              type="submit"
              disabled={!canTakeover || markee.busy}
            >
              Take over
            </ButtonWithWallet>
          </div>
        </form>
        {markee.boardAddress && (
          <a
            href={`https://www.markee.xyz/markee/${markee.boardAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-xs text-teal-700 underline underline-offset-4"
          >
            View board on Markee
          </a>
        )}
        {!address && markee.board && (
          <p className="text-xs text-teal-700">Connect your wallet to rent this advertisement.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
