"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { CardSkeleton } from "@/components/loading/CardSkeleton";
import { TxProgress } from "@/components/ui/TxProgress";
import { toast } from "@/components/ui/use-toast";
import { useHydrated } from "@/hooks/useHydrated";
import { failedLine, reviewedCall, useReviewedAction } from "@/hooks/useReviewedAction";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { PERSIST } from "@/lib/query-persist";
import { formatWalletError } from "@/lib/utils";
import type { ReviewContextRow } from "@bananapus/nana-sdk-core/review";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import {
  chainName,
  ChainProject,
  chainProjectsKey,
  explorerAddressUrl,
  fmtUnits,
} from "../settlement/lib";
import {
  deployPoolArity,
  deployPoolTwoArgAbi,
  fetchSplitHookStates,
  lpSplitHookAbi,
  SplitHookChainState,
} from "./lib";

/** Simulate-first write against the LP split hook on its chain. */
function HookActionButton({
  state,
  label,
  confirmTitle,
  functionName,
  args,
  title,
  rows,
  onDone,
}: {
  state: SplitHookChainState;
  label: string;
  confirmTitle: string;
  functionName: "deployPool" | "collectAndRouteLPFees";
  args: readonly [bigint, bigint] | readonly [bigint, `0x${string}`];
  title?: string;
  rows: readonly ReviewContextRow[];
  onDone: () => void;
}) {
  const context = [{ label: "On", value: chainName(state.chainId) }, ...rows];
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: state.chainId });
  const { run } = useReviewedAction();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The project comes from the server sucker-group list: act only on a registry-listed pair.
  const gate = useGroupWriteGate([state]);

  return (
    <>
      <ButtonWithWallet
        targetChainId={state.chainId}
        size="sm"
        variant="outline"
        forceChildren
        loading={busy || gate.pending}
        disabled={gate.blocked}
        title={title}
        onClick={() => {
          setError(null);
          setReview(true);
        }}
      >
        {label}
      </ButtonWithWallet>
      {gate.line ? <p className="mt-1 text-xs text-zinc-600">{gate.line}</p> : null}
      <TxProgress
        open={review}
        onClose={() => setReview(false)}
        title={confirmTitle}
        steps={[{ title: label, detail: title }]}
        activeIndex={busy ? 0 : -1}
        busy={busy}
        error={error}
        rows={context}
        start={async () => {
          try {
            gate.assertVerified([state]);
            setBusy(true);
            setError(null);
            if (!publicClient) throw new Error("Public client unavailable.");
            // Live hooks and 1.5.0 differ in their `deployPool` selector. Ask the deployed
            // bytecode which one it has rather than hard-coding one and reverting at simulate
            // on the other.
            let callAbi: readonly unknown[] = lpSplitHookAbi;
            let callArgs = args;
            if (functionName === "deployPool") {
              if ((await deployPoolArity(publicClient, state.hook)) === 2) {
                callAbi = deployPoolTwoArgAbi;
              } else {
                callArgs = [args[0]] as unknown as typeof args;
              }
            }
            const result = await run({
              account: address,
              context,
              calls: [
                reviewedCall({
                  chainId: state.chainId,
                  address: state.hook,
                  abi: callAbi,
                  functionName,
                  args: callArgs,
                }),
              ],
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
              toast({
                title: "Safe proposal submitted",
                description: `${label} is awaiting Safe approvals and execution on ${chainName(state.chainId)}.`,
              });
              setReview(false);
              return;
            }
            toast({
              title: `${label} confirmed`,
              description: `${label} on ${chainName(state.chainId)}.`,
            });
            setReview(false);
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

function SplitHookChainBlock({
  state,
  tokenSymbol,
  onDone,
}: {
  state: SplitHookChainState;
  tokenSymbol: string;
  onDone: () => void;
}) {
  const explorer = explorerAddressUrl(state.chainId, state.hook);
  const row =
    "flex justify-between text-sm text-zinc-700 py-1 border-b border-zinc-50 last:border-b-0";
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-900">
          <ChainLogo chainId={state.chainId} width={16} height={16} />
          {chainName(state.chainId)}
        </span>
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 font-mono"
          >
            {state.hook.slice(0, 6)}…{state.hook.slice(-4)} ↗
          </a>
        ) : (
          <span className="text-xs text-zinc-400 font-mono">{state.hook}</span>
        )}
      </div>
      <div className="mt-2">
        <div className={row}>
          <span className="text-zinc-400">Pool</span>
          <span>{state.hasPool ? "Deployed" : "Not deployed yet"}</span>
        </div>
        <div className={row}>
          <span className="text-zinc-400">Accumulated {tokenSymbol}</span>
          <span>{fmtUnits(state.accumulated, 18)}</span>
        </div>
        {state.hasPool && state.tokenId > 0n && (
          <div className={row}>
            <span className="text-zinc-400">LP position</span>
            <span>
              #{state.tokenId.toString()}
              {state.tickLower != null && state.tickUpper != null
                ? ` (ticks ${state.tickLower} → ${state.tickUpper})`
                : ""}
            </span>
          </div>
        )}
        <div className={row}>
          <span className="text-zinc-400">Claimable LP fees</span>
          <span>
            {fmtUnits(state.claimableFees, state.pairDecimals)} {state.pairSymbol}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {!state.hasPool ? (
          <>
            <HookActionButton
              state={state}
              label="Deploy pool"
              confirmTitle="Confirm pool deployment"
              functionName="deployPool"
              args={[state.projectId, 0n] as const}
              title="Seed the Uniswap V4 pool from accumulated tokens (accepts any cash out return)"
              rows={[
                {
                  label: "Seeds with",
                  value: `${fmtUnits(state.accumulated, 18)} ${tokenSymbol}`,
                  note: `Part is cashed out for ${state.pairSymbol}, so both tokens can be offered for trading`,
                },
                { label: "Minimum cash out return", value: "None" },
              ]}
              onDone={onDone}
            />
            {state.deployGated && (
              <span className="text-xs text-zinc-400 max-w-md">
                Only an account with the operator&apos;s SET_BUYBACK_POOL permission can create the
                pool now. Anyone can do so once the new-token rate falls to 10% of its rate when
                these tokens began collecting.
              </span>
            )}
          </>
        ) : (
          <HookActionButton
            state={state}
            label="Collect fees"
            confirmTitle="Confirm fee collection"
            functionName="collectAndRouteLPFees"
            args={[state.projectId, state.terminalToken] as const}
            title="Collect trading fees into the project balance (anyone can do this)"
            rows={[
              {
                label: "Collects",
                value: `${fmtUnits(state.claimableFees, state.pairDecimals)} ${state.pairSymbol}`,
              },
              { label: "Routes to", value: "The project's terminal balance" },
            ]}
            onDone={onDone}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Shown only when a reserved split routes to the LP split hook: reserved tokens
 * accumulate there until the pool is seeded (Deploy pool — operator-gated until
 * the issuance decay threshold), after which Collect fees is permissionless and
 * routes trading fees back into the project.
 */
export function SplitHookCard({
  chains,
  tokenSymbol,
}: {
  chains: ChainProject[];
  tokenSymbol: string;
}) {
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: ["v6SplitHookStates", chainProjectsKey(chains)],
    meta: PERSIST,
    enabled: chains.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchSplitHookStates(chains),
  });

  const data = hydrated ? query.data : undefined;
  const isLoading = hydrated ? query.isLoading : chains.length > 0;
  const { refetch } = query;

  if (isLoading) return <CardSkeleton rows={5} />;

  // Hidden entirely when no reserved split routes to the LP hook anywhere.
  if (!data || data.length === 0) return null;

  return (
    <div className="border border-zinc-200 bg-white p-4">
      <h3 className="font-medium text-zinc-900">
        Split hook <span className="text-xs uppercase tracking-wide text-zinc-400 ml-1">LP</span>
      </h3>
      <p className="text-sm text-zinc-500 mt-1">
        Reserved {tokenSymbol} routed here accumulates until the pool is seeded: Deploy pool cashes
        out part of the accumulated {tokenSymbol} for the terminal token and mints a two-sided
        Uniswap V4 position. Collect fees routes the position&apos;s trading fees into the
        project&apos;s terminal balance.
      </p>
      {data.map((state) => (
        <SplitHookChainBlock
          key={state.chainId}
          state={state}
          tokenSymbol={tokenSymbol}
          onDone={() => refetch()}
        />
      ))}
    </div>
  );
}
