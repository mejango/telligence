"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { CardSkeleton } from "@/components/loading/LoadingSkeletons";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { toast } from "@/components/ui/use-toast";
import { submittedViaSafe, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { PERSIST } from "@/lib/query-persist";
import { formatWalletError } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
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
  deployPoolSingleArgAbi,
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
  rows: React.ReactNode;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: state.chainId });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ButtonWithWallet
        targetChainId={state.chainId}
        size="sm"
        variant="outline"
        forceChildren
        loading={busy}
        title={title}
        onClick={() => {
          setError(null);
          setReview(true);
        }}
      >
        {label}
      </ButtonWithWallet>
      <TxConfirmDialog
        open={review}
        onOpenChange={(open) => {
          if (!open) setReview(false);
        }}
        title={confirmTitle}
        chainId={state.chainId}
        steps={[{ title: label, detail: title }]}
        activeIndex={busy ? 0 : -1}
        action={label}
        busy={busy}
        error={error}
        onConfirm={async () => {
          try {
            setBusy(true);
            setError(null);
            if (!publicClient) throw new Error("Public client unavailable.");
            // Two hook generations are live during the lp-split-hook rollout and their
            // `deployPool` selectors differ. Ask the deployed bytecode which one it has rather
            // than hard-coding one and reverting at simulate on the other.
            let callAbi: readonly unknown[] = lpSplitHookAbi;
            let callArgs = args;
            if (functionName === "deployPool") {
              const arity = await deployPoolArity(publicClient, state.hook);
              if (arity === 1) {
                callAbi = deployPoolSingleArgAbi;
                callArgs = [args[0]] as unknown as typeof args;
              }
            }
            const sim = await publicClient?.simulateContract({
              account: address,
              address: state.hook,
              abi: callAbi as never,
              functionName,
              args: callArgs as never,
            });
            if (!sim) throw new Error("Could not simulate the transaction.");
            const hash = await writeContractAsync(sim.request);
            if (submittedViaSafe(hash)) {
              toast({
                title: "Safe proposal submitted",
                description: `${label} is awaiting Safe approvals and execution on ${chainName(state.chainId)}.`,
              });
              setReview(false);
              return;
            }
            const receipt = await waitForReceiptWithRetry(publicClient, hash);
            if (receipt.status !== "success") {
              throw new Error(`${label} ${hash} reverted onchain.`);
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
      >
        <SummaryRow label="On">{chainName(state.chainId)}</SummaryRow>
        {rows}
      </TxConfirmDialog>
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
              rows={
                <>
                  <SummaryRow label="Seeds with">
                    {fmtUnits(state.accumulated, 18)} {tokenSymbol}
                    <span className="block text-xs text-zinc-500">
                      Part is cashed out for {state.pairSymbol} to mint a two-sided position
                    </span>
                  </SummaryRow>
                  <SummaryRow label="Minimum cash out return">None</SummaryRow>
                </>
              }
              onDone={onDone}
            />
            {state.deployGated && (
              <span className="text-xs text-zinc-400 max-w-md">
                Deploying currently requires the revnet operator (SET_BUYBACK_POOL permission). It
                becomes permissionless once the issuance rate decays to 10% of what it was when
                tokens started accumulating.
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
            title="Collect LP trading fees and route them into the project's terminal balance (anyone can call this)"
            rows={
              <>
                <SummaryRow label="Collects">
                  {fmtUnits(state.claimableFees, state.pairDecimals)} {state.pairSymbol}
                </SummaryRow>
                <SummaryRow label="Routes to">The project&apos;s terminal balance</SummaryRow>
              </>
            }
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
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["v6SplitHookStates", chainProjectsKey(chains)],
    meta: PERSIST,
    enabled: chains.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchSplitHookStates(chains),
  });

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
