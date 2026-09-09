"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { toast } from "@/components/ui/use-toast";
import { submittedViaSafe, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { PERSIST } from "@/lib/query-persist";
import { formatWalletError } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { buildSyncAccountingDataTx } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import {
  chainName,
  ChainProject,
  chainProjectsKey,
  fetchGossip,
  findSyncValue,
  fmtUnits,
  GossipLevel,
  GossipPeerRow,
  timeAgo,
  viemChainOf,
} from "./lib";

function StatusBadge({ level, label }: { level: GossipLevel; label: string }) {
  const styles: Record<GossipLevel, string> = {
    synced: "bg-teal-50 text-teal-700 border-teal-200",
    slight: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    never: "bg-zinc-100 text-zinc-500 border-zinc-200",
    unknown: "bg-zinc-100 text-zinc-500 border-zinc-200",
  };
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 text-xs whitespace-nowrap ${styles[level]}`}
    >
      {label}
    </span>
  );
}

/**
 * Sync button: runs syncAccountingData() on the PEER chain's sucker so the peer
 * re-pushes its accounting snapshot to the viewing chain. Payable — the exact
 * msg.value is discovered by simulating the call itself (0 works on OP-family
 * native bridges; CCIP needs a positive native budget or it flips into LINK-fee
 * mode). No verified budget → error toast, never a blind-guessed fee.
 */
function SyncButton({
  peerChainId,
  toChainId,
  syncSucker,
  onSynced,
}: {
  peerChainId: JBChainId;
  toChainId: JBChainId;
  syncSucker: Address;
  onSynced: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: peerChainId });
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<"idle" | "finding" | "working" | "sent">("idle");
  const [review, setReview] = useState<{ value: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nativeSymbol = viemChainOf(peerChainId)?.nativeCurrency.symbol ?? "ETH";

  return (
    <>
      <ButtonWithWallet
        targetChainId={peerChainId}
        size="sm"
        variant="outline"
        forceChildren
        loading={state === "finding" || state === "working"}
        disabled={state === "sent"}
        onClick={async () => {
          try {
            setState("finding");
            setError(null);
            const value = await findSyncValue(peerChainId, syncSucker, address);
            if (value == null) {
              throw new Error(
                "Could not determine the bridge messaging fee — the sync simulation did not succeed at any budget. Try again shortly.",
              );
            }
            setReview({ value });
            setState("idle");
          } catch (cause) {
            console.error(cause);
            setState("idle");
            toast({
              variant: "destructive",
              title: "Sync failed",
              description: formatWalletError(cause),
            });
          }
        }}
      >
        {state === "sent" ? "Sent" : "Sync"}
      </ButtonWithWallet>
      {review || state === "finding" ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReview(null);
          }}
          title="Confirm sync"
          chainId={peerChainId}
          preparing={!review}
          status={review ? null : "Simulating the bridge messaging fee…"}
          steps={[
            {
              title: "Sync accounting",
              detail: "Re-pushes this chain's accounting snapshot over the bridge.",
            },
          ]}
          activeIndex={state === "working" ? 0 : -1}
          action="Sync"
          busy={state !== "idle"}
          error={error}
          onConfirm={async () => {
            if (!review) return;
            try {
              setState("working");
              setError(null);
              const request = buildSyncAccountingDataTx({
                chainId: peerChainId,
                sucker: syncSucker,
                value: review.value,
              });
              // Simulate the exact tx (account + value) before prompting the wallet.
              await publicClient?.simulateContract({
                account: address,
                ...request,
              });
              const hash = await writeContractAsync(request);
              if (submittedViaSafe(hash)) {
                setState("sent");
                setReview(null);
                toast({
                  title: "Safe proposal submitted",
                  description: `The sync is awaiting Safe approvals and execution on ${chainName(peerChainId)}.`,
                });
                return;
              }
              if (!publicClient) throw new Error("Public client unavailable.");
              const receipt = await waitForReceiptWithRetry(publicClient, hash);
              if (receipt.status !== "success") {
                throw new Error(`Accounting sync ${hash} reverted onchain.`);
              }
              setState("sent");
              setReview(null);
              toast({
                title: "Sync confirmed",
                description: `${chainName(peerChainId)} is pushing its accounting snapshot over the bridge — it lands in a few minutes.`,
              });
              onSynced();
            } catch (cause) {
              console.error(cause);
              setState("idle");
              setError(formatWalletError(cause));
            }
          }}
        >
          <SummaryRow label="On">{chainName(peerChainId)}</SummaryRow>
          <SummaryRow label="Pushes to">{chainName(toChainId)}</SummaryRow>
          {review ? (
            <SummaryRow label="Bridge fee">
              {fmtUnits(review.value, 18)} {nativeSymbol}
              <span className="block text-xs text-zinc-500">Found by simulation</span>
            </SummaryRow>
          ) : null}
        </TxConfirmDialog>
      ) : null}
    </>
  );
}

function PeerRow({
  peer,
  toChainId,
  onSynced,
}: {
  peer: GossipPeerRow;
  toChainId: JBChainId;
  onSynced: () => void;
}) {
  const cell = "p-4 align-middle text-sm text-zinc-700";
  const showSync = peer.syncSucker != null && peer.level !== "synced" && peer.level !== "unknown";
  return (
    <tr className="border-b border-zinc-50 last:border-b-0">
      <td className={cell}>
        <span className="inline-flex items-center gap-2">
          <ChainLogo chainId={peer.peerChainId} width={16} height={16} />
          {chainName(peer.peerChainId)}
        </span>
      </td>
      <td className={cell}>
        <StatusBadge level={peer.level} label={peer.label} />
      </td>
      <td className={cell}>{peer.snapshot ? fmtUnits(peer.supply, 18) : "—"}</td>
      <td className={cell}>
        {peer.balances.length
          ? peer.balances.map((b, i) => (
              <span key={i} className="block whitespace-nowrap">
                {fmtUnits(b.balance, b.decimals)} {b.symbol}
              </span>
            ))
          : peer.snapshot
            ? "0"
            : "—"}
      </td>
      <td className={cell}>{peer.snapshot ? timeAgo(peer.snapshot) : "never"}</td>
      <td className={`${cell} text-right`}>
        {showSync && peer.syncSucker && (
          <SyncButton
            peerChainId={peer.peerChainId}
            toChainId={toChainId}
            syncSucker={peer.syncSucker}
            onSynced={onSynced}
          />
        )}
      </td>
    </tr>
  );
}

/**
 * What each chain knows about its peers' accounting records — freshness vs the
 * peers' actual current values, plus a Sync action to re-push a stale snapshot
 * (website/ renderGossipSection parity).
 */
export function GossipCard({ chains }: { chains: ChainProject[] }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["v6Gossip", chainProjectsKey(chains)],
    meta: PERSIST,
    enabled: chains.length > 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => fetchGossip(chains),
  });

  if (chains.length < 2) return null;

  const cellHead = "h-12 px-4 text-left align-middle text-sm font-bold text-zinc-500";

  return (
    <div className="border border-zinc-200 bg-melon-50 p-4">
      <h3 className="font-medium text-zinc-900">Gossip</h3>
      <p className="text-sm text-zinc-500 mt-1">
        Each chain&apos;s cash out and loan availability depends on knowledge of the project&apos;s
        composition on other chains.
      </p>
      {isLoading ? (
        <TableSkeleton rows={Math.max(chains.length, 2)} columns={6} />
      ) : isError || !data ? (
        <div className="text-sm text-zinc-500 py-4">Could not verify cross-chain gossip state.</div>
      ) : (
        data.map((view) => (
          <div key={view.chainId} className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
              <ChainLogo chainId={view.chainId} width={16} height={16} />
              {chainName(view.chainId)} knows
            </div>
            <div className="-mx-4 mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="bg-melon-100">
                  <tr className="border-b border-zinc-100">
                    <th className={cellHead}>Chain</th>
                    <th className={cellHead}>Status</th>
                    <th className={cellHead}>Supply</th>
                    <th className={cellHead}>Balance</th>
                    <th className={cellHead}>Snapshot</th>
                    <th className={cellHead} />
                  </tr>
                </thead>
                <tbody>
                  {view.peers.map((peer) => (
                    <PeerRow
                      key={peer.peerChainId}
                      peer={peer}
                      toChainId={view.chainId}
                      onSynced={() => {
                        // The push rides the bridge for minutes — re-read a few times so
                        // the row clears on its own once the snapshot lands.
                        [30_000, 90_000, 180_000].forEach((ms) => setTimeout(() => refetch(), ms));
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
