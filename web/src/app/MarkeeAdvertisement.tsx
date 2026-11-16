"use client";

import { useOpenedOnce } from "@/hooks/useOpenedOnce";
import { MARKEE_CHAIN_ID, readMarkeeBoard, savedMarkeeBoard } from "@/lib/markee";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import type { MarkeeCardState } from "./MarkeeRentDialog";

// Renting runs reviewed wallet writes and durable recovery; that code loads only when a visitor
// opens Take over (hover or focus loads it a moment early).
const loadRentDialog = () => import("./MarkeeRentDialog");
const MarkeeRentDialog = dynamic(() => loadRentDialog().then((module) => module.MarkeeRentDialog), {
  ssr: false,
});

/** The card's own read of the board it shows: the same board the rent dialog selects. */
function useMarkeeCard(initialBoardAddress?: Address): MarkeeCardState {
  const client = usePublicClient({ chainId: MARKEE_CHAIN_ID });
  const [state, setState] = useState<MarkeeCardState>({ loading: true });
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!client) return setState({ loading: false });
      setState({ loading: true });
      try {
        const boardAddress = initialBoardAddress ?? savedMarkeeBoard();
        if (!boardAddress) return live && setState({ loading: false });
        const board = await readMarkeeBoard(client, boardAddress);
        if (live) setState({ boardAddress, board, loading: false });
      } catch (cause) {
        if (live)
          setState({
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [client, initialBoardAddress]);
  return state;
}

export function MarkeeAdvertisement({ initialBoardAddress }: { initialBoardAddress?: Address }) {
  const read = useMarkeeCard(initialBoardAddress);
  // Once opened, the rent dialog's settled reads are the card's: they follow every change it
  // makes. While the dialog reads again, the card keeps the last answer instead of a loading line.
  const [fromDialog, setFromDialog] = useState<MarkeeCardState>();
  const markee = fromDialog ?? read;
  const [open, setOpen] = useState(false);
  const mounted = useOpenedOnce(open);
  const onCardState = useCallback((state: MarkeeCardState) => {
    if (!state.loading) setFromDialog(state);
  }, []);

  return (
    <section
      aria-label="Markee advertisement"
      {...(markee.boardAddress ? { "data-markee-address": markee.boardAddress } : {})}
      className="w-full min-w-0 border border-teal-200 bg-teal-50 text-left"
    >
      <div className="px-4 pb-1 pt-6 sm:px-5">
        <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
          {markee.loading
            ? "Loading advertisement…"
            : markee.error
              ? "Advertisement unavailable."
              : markee.board?.message || "Your message could be here."}
        </p>
      </div>
      <div className="flex justify-start px-4 pb-1 sm:px-5">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          onPointerEnter={() => void loadRentDialog()}
          onFocus={() => void loadRentDialog()}
          className="inline-flex min-h-11 items-center text-[10px] text-teal-700 underline-offset-4 hover:text-teal-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          Take over this advertisement
        </button>
      </div>
      {mounted ? (
        <MarkeeRentDialog
          initialBoardAddress={initialBoardAddress}
          open={open}
          onOpenChange={setOpen}
          onCardState={onCardState}
        />
      ) : null}
    </section>
  );
}
