"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { TxProgress } from "@/components/ui/TxProgress";
import { toast } from "@/components/ui/use-toast";
import { useHydrated } from "@/hooks/useHydrated";
import { failedLine, reviewedCall, useReviewedAction } from "@/hooks/useReviewedAction";
import { legacyIntents } from "@/lib/legacy-intents";
import { type GroupWriteTarget, useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { PERSIST } from "@/lib/query-persist";
import { formatWalletError } from "@/lib/utils";
import {
  buildV6ClaimTxFromRow,
  fetchV6BridgeRows,
  prepareQueuedExecute,
  V6BridgeRow,
} from "@/lib/v6/suckerProofs";
import { bridgeIntent } from "@bananapus/nana-sdk-core/review";
import { jbSuckerV6Abi } from "@bananapus/nana-sdk-core/v6";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import {
  bridgeEtaHint,
  bridgeTrackUrl,
  chainName,
  ChainProject,
  chainProjectsKey,
  fmtUnits,
  timeAgo,
  tokenSymbolOf,
  viemChainOf,
} from "./lib";

type Filter = "all" | "pending" | "claimable";

function StatusBadge({ status }: { status: V6BridgeRow["status"] }) {
  const styles =
    status === "claimable"
      ? "bg-teal-50 text-teal-700 border-teal-200"
      : status === "pending"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-zinc-100 text-zinc-500 border-zinc-200";
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-xs uppercase tracking-wide ${styles}`}>
      {status}
    </span>
  );
}

/**
 * Claim runs on the DESTINATION chain against the peer sucker, with the locally
 * reconstructed + verified merkle proof. Simulate-first so a revert surfaces as
 * a readable error before the wallet prompt.
 */
function ClaimButton({
  row,
  targets,
  tokenSymbol,
  onDone,
}: {
  row: V6BridgeRow & { tokenSymbol: string };
  targets: GroupWriteTarget[];
  tokenSymbol: string;
  onDone: () => void;
}) {
  const gate = useGroupWriteGate(targets);
  const { address } = useAccount();
  const { run } = useReviewedAction();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = [
    {
      label: "Claims",
      value: `${fmtUnits(row.projectTokenCount, 18)} ${tokenSymbol}`,
      note: `${fmtUnits(row.terminalTokenAmount, row.tokenDecimals)} ${row.tokenSymbol} backing`,
      strong: true,
    },
    { label: "On", value: chainName(row.peerChainId) },
    { label: "To", value: row.beneficiary, mono: true },
  ];

  return (
    <>
      <ButtonWithWallet
        targetChainId={row.peerChainId}
        size="sm"
        variant="outline"
        forceChildren
        loading={busy || gate.pending}
        disabled={gate.blocked}
        onClick={() => {
          setError(null);
          setReview(true);
        }}
      >
        Claim
      </ButtonWithWallet>
      {gate.line ? <p className="mt-1 text-xs text-zinc-600">{gate.line}</p> : null}
      <TxProgress
        open={review}
        onClose={() => setReview(false)}
        title="Confirm claim"
        steps={[{ title: "Claim", detail: "Proves the bridged leaf on the destination sucker." }]}
        activeIndex={busy ? 0 : -1}
        busy={busy}
        error={error}
        rows={context}
        start={async () => {
          try {
            gate.assertVerified(targets);
            setBusy(true);
            setError(null);
            const result = await run({
              account: address,
              context,
              calls: [reviewedCall(buildV6ClaimTxFromRow(row))],
            });
            if (!result) {
              setReview(false);
              return;
            }
            if (result.status === "failed") {
              setError(failedLine(result));
              return;
            }
            if (result.status === "proposed") {
              setReview(false);
              toast({
                title: "Safe proposal submitted",
                description: `The claim is awaiting Safe approvals and execution on ${chainName(row.peerChainId)}.`,
              });
              return;
            }
            setReview(false);
            toast({
              title: "Claimed",
              description: `Tokens claimed on ${chainName(row.peerChainId)}.`,
            });
            onDone();
          } catch (cause) {
            console.error(cause);
            setError(formatWalletError(cause));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * Execute ships the source sucker's queued outbox to the destination in one
 * bridge message (permissionless; it delivers every queued move for that token,
 * not just this row). It goes to the source chain's sucker as the registry lists it, and the
 * exact msg.value comes from findToRemoteValue — when no budget can be verified the button
 * explains instead of prompting a reverting tx.
 */
function ExecuteButton({
  row,
  targets,
  onDone,
}: {
  row: V6BridgeRow;
  targets: GroupWriteTarget[];
  onDone: () => void;
}) {
  const gate = useGroupWriteGate(targets);
  const { address } = useAccount();
  const { run } = useReviewedAction();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ sucker: Address; value: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feeUnavailable, setFeeUnavailable] = useState(false);
  const nativeSymbol = viemChainOf(row.chainId)?.nativeCurrency.symbol ?? "ETH";
  const context = [
    { label: "On", value: chainName(row.chainId) },
    { label: "Delivers to", value: chainName(row.peerChainId) },
    ...(review
      ? [
          {
            label: "Bridge fee",
            value: `${fmtUnits(review.value, 18)} ${nativeSymbol}`,
            note: "Found by simulation",
          },
        ]
      : []),
  ];

  if (feeUnavailable) {
    return (
      <span
        className="text-xs text-zinc-400"
        title="Couldn't find the bridge fee. Try again shortly."
      >
        Fee unavailable
      </span>
    );
  }

  return (
    <>
      <ButtonWithWallet
        targetChainId={row.chainId}
        size="sm"
        variant="outline"
        forceChildren
        loading={busy || gate.pending}
        disabled={gate.blocked}
        onClick={async () => {
          try {
            gate.assertVerified(targets);
            setBusy(true);
            setError(null);
            const { sucker, value } = await prepareQueuedExecute(row, address);
            if (value == null) {
              setFeeUnavailable(true);
              throw new Error("Couldn't find the bridge fee. Try again shortly.");
            }
            setReview({ sucker, value });
          } catch (cause) {
            console.error(cause);
            toast({
              variant: "destructive",
              title: "Execute failed",
              description: formatWalletError(cause),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Execute
      </ButtonWithWallet>
      {gate.line ? <p className="mt-1 text-xs text-zinc-600">{gate.line}</p> : null}
      {review || busy ? (
        <TxProgress
          open
          onClose={() => setReview(null)}
          title="Confirm execution"
          preparing={!review}
          status={review ? null : "Simulating the bridge messaging fee…"}
          steps={[
            {
              title: "Send the bridge message",
              detail: "Delivers every queued move for this token, not just this row.",
            },
          ]}
          activeIndex={busy ? 0 : -1}
          busy={busy}
          error={error}
          rows={context}
          start={async () => {
            if (!review) return;
            try {
              gate.assertVerified(targets);
              setBusy(true);
              setError(null);
              const { sucker, value } = review;
              // Held by the sucker, token and account: its fee is quoted again on a retry.
              const result = await run({
                account: address,
                context,
                calls: [
                  reviewedCall(
                    {
                      chainId: row.chainId,
                      address: sucker,
                      abi: jbSuckerV6Abi,
                      functionName: "toRemote",
                      args: [row.token],
                      value,
                    },
                    {
                      intent: bridgeIntent({
                        chainId: row.chainId,
                        sucker,
                        token: row.token,
                        account: address!,
                      }),
                      legacyIntents: legacyIntents.toRemote(sucker, row.token),
                    },
                  ),
                ],
              });
              if (!result) {
                setReview(null);
                return;
              }
              if (result.status === "failed") {
                setError(failedLine(result));
                return;
              }
              if (result.status === "proposed") {
                setReview(null);
                toast({
                  title: "Safe proposal submitted",
                  description: `The bridge message is awaiting Safe approvals and execution on ${chainName(row.chainId)}.`,
                });
                return;
              }
              setReview(null);
              toast({
                title: "Bridge message confirmed",
                description: `The queued outbox is on its way to ${chainName(row.peerChainId)}. Rows turn claimable once it lands.`,
              });
              onDone();
            } catch (cause) {
              console.error(cause);
              setError(formatWalletError(cause));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function BridgingLink({ row }: { row: V6BridgeRow }) {
  const url = bridgeTrackUrl(row);
  const eta = bridgeEtaHint(row);
  return (
    <span className="text-xs text-zinc-400 whitespace-nowrap">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-600 underline decoration-dotted"
          title={
            row.infra === "ccip"
              ? "Track this message on the CCIP explorer"
              : "Track on the source chain explorer"
          }
        >
          Bridging… ↗
        </a>
      ) : (
        "Bridging…"
      )}
      {eta && <span className="ml-1">~{eta}</span>}
    </span>
  );
}

/**
 * "Queued movements" — every cross-chain token movement still in flight, from
 * locally reconstructed sucker outboxes (verified proofs; no external prover).
 * Claimed leaves drop out — a cleared move lives in the activity feed.
 */
export function QueuedMovementsCard({
  chains,
  tokenSymbol,
}: {
  chains: ChainProject[];
  tokenSymbol: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: ["v6BridgeRows", chainProjectsKey(chains)],
    meta: PERSIST,
    enabled: chains.length > 1,
    // In-flight movements flip to claimable on their own once the destination
    // inbox receives the root — keep re-reading so no manual reload is needed.
    refetchInterval: 45_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const rows = await fetchV6BridgeRows(
        chains.map((c) => ({ chainId: c.chainId, projectId: c.projectId })),
      );
      const live = rows.filter((r) => r.status !== "claimed");
      // Resolve terminal-token symbols once per (chain, token) for the Value column.
      const symbols = new Map<string, string>();
      await Promise.all(
        live.map(async (r) => {
          const key = `${r.chainId}:${r.token.toLowerCase()}`;
          if (!symbols.has(key)) symbols.set(key, await tokenSymbolOf(r.chainId, r.token));
        }),
      );
      return live.map((r) => ({
        ...r,
        tokenSymbol: symbols.get(`${r.chainId}:${r.token.toLowerCase()}`) ?? "tokens",
      }));
    },
  });

  const data = hydrated ? query.data : undefined;
  // Both ends of a movement come from the server sucker-group list: act only on registry-listed pairs.
  const rowTargets = (row: V6BridgeRow) =>
    chains.filter((chain) => chain.chainId === row.chainId || chain.chainId === row.peerChainId);
  const isLoading = hydrated ? query.isLoading : chains.length > 1;
  const isError = hydrated && query.isError;
  const { refetch } = query;

  const rows = data ?? [];
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const counts = {
    all: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    claimable: rows.filter((r) => r.status === "claimable").length,
  };

  const cellHead = "h-12 px-4 text-left align-middle text-sm font-bold text-zinc-500";
  const cell = "whitespace-nowrap p-4 align-middle text-sm text-zinc-700";

  return (
    <div className="border border-zinc-200 bg-melon-50 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-medium text-zinc-900">Queued movements</h3>
        <div className="flex gap-1">
          {(["all", "pending", "claimable"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-xs border ${
                filter === f
                  ? "border-teal-500 bg-teal-50 text-teal-700"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
              }`}
            >
              {f === "all" ? "All" : f === "pending" ? "Pending" : "Claimable"}
              {counts[f] > 0 ? ` (${counts[f]})` : ""}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-zinc-500 mt-1">
        Anything moving between chains shows here until it clears.
      </p>
      <div
        className={
          visible.length > 0 && !isLoading ? "table-scroll -mx-4 mt-3 overflow-x-auto" : "mt-3"
        }
      >
        {isLoading ? (
          <TableSkeleton rows={4} columns={7} />
        ) : isError && rows.length === 0 ? (
          <div className="text-sm text-zinc-500 py-4">Could not load bridge transactions.</div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-zinc-400 py-4">No queued movements.</div>
        ) : (
          <table className="w-full min-w-[1040px]">
            <thead className="bg-melon-100">
              <tr className="border-b border-zinc-100">
                <th className={cellHead}>Initiated</th>
                <th className={cellHead}>Chains</th>
                <th className={cellHead}>Beneficiary</th>
                <th className={cellHead}>Tokens</th>
                <th className={cellHead}>Value</th>
                <th className={cellHead}>Status</th>
                <th className={cellHead}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={`${row.chainId}:${row.sourceSucker}:${row.token}:${row.index}`}
                  className="border-b border-zinc-50 last:border-b-0"
                >
                  <td className={cell}>{timeAgo(row.createdAt)}</td>
                  <td className={cell}>
                    <span className="inline-flex items-center gap-1">
                      <ChainLogo chainId={row.chainId} width={16} height={16} standalone />
                      <span className="text-zinc-300">→</span>
                      <ChainLogo chainId={row.peerChainId} width={16} height={16} standalone />
                    </span>
                  </td>
                  <td className={cell}>
                    <EthereumAddress
                      address={row.beneficiary}
                      short
                      withEnsName
                      chain={viemChainOf(row.peerChainId)}
                    />
                  </td>
                  <td className={cell}>
                    {fmtUnits(row.projectTokenCount, 18)} {tokenSymbol}
                  </td>
                  <td className={cell}>
                    {fmtUnits(row.terminalTokenAmount, row.tokenDecimals)} {row.tokenSymbol}
                  </td>
                  <td className={cell}>
                    <StatusBadge status={row.status} />
                  </td>
                  <td className={cell}>
                    {row.status === "claimable" ? (
                      <ClaimButton
                        row={row}
                        targets={rowTargets(row)}
                        tokenSymbol={tokenSymbol}
                        onDone={() => refetch()}
                      />
                    ) : row.status === "pending" && row.canExecute ? (
                      <ExecuteButton row={row} targets={rowTargets(row)} onDone={() => refetch()} />
                    ) : row.status === "pending" ? (
                      <BridgingLink row={row} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
