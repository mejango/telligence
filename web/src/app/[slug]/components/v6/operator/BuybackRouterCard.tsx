"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EnsAddressInput } from "@/components/EnsAddressInput";
import { EthereumAddress } from "@/components/EthereumAddress";
import { Button } from "@/components/ui/button";
import { ConceptTerm } from "@/components/ui/ConceptTerm";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/skeleton";
import { ErrorNote } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { PROTOCOL_CONCEPTS } from "@/lib/protocolConcepts";
import { isSafeProposalPendingError, reviewClosed } from "@/lib/reviewed-call";
import { addStepsToBatch, stepFromWrite } from "@/lib/safe-batch";
import { formatWalletError } from "@/lib/utils";
import {
  JBBuybackHookContracts,
  JBRouterTerminalContracts,
  JB_CHAINS,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
  jbBuybackHookAbi,
  jbBuybackHookRegistryAbi,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import {
  resolveProjectBuybackHook,
  resolveProjectRouterTerminal,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Address, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import {
  ChainProjectRow,
  ChainWrite,
  chainName,
  publicClientFor,
  v6ContractAddress,
} from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import { useLiveRevnetOperators } from "./useLiveRevnetOperators";
import { useOperatorWrites } from "./useOperatorWrites";

type BuybackChainState = ChainProjectRow & {
  buybackRegistry: Address | undefined;
  routerRegistry: Address | undefined;
  buybackAvailable: boolean;
  routerAvailable: boolean;
  /** The project's ACTUAL buyback hook (data-hook-resolved), or null. */
  hook: Address | null;
  /** The terminal the router registry forwards into, or null. */
  terminal: Address | null;
  defaultHook: Address | null;
  defaultTerminal: Address | null;
  /** A read threw: the values above are unknown, not unset. */
  readFailed: boolean;
  /** Pair tokens with an initialized pool on this chain, and their TWAP window. */
  pools: { label: string; token: Address; twap: number; fee: number; tickSpacing: number }[];
  poolSummary: string;
};

/** `JBBuybackHook._requireValidTwapWindow`: 5 minutes to 2 days. */
const MIN_TWAP_WINDOW = 300;
const MAX_TWAP_WINDOW = 172_800;

async function readChainState(row: ChainProjectRow): Promise<BuybackChainState> {
  const client = publicClientFor(row.chainId);
  const buybackRegistry = v6ContractAddress(
    JBBuybackHookContracts.JBBuybackHookRegistry,
    row.chainId,
  );
  const routerRegistry = v6ContractAddress(
    JBRouterTerminalContracts.JBRouterTerminalRegistry,
    row.chainId,
  );

  let readFailed = false;
  const unread = () => {
    readFailed = true;
    return null;
  };
  const [hook, terminal, defaultHook, defaultTerminal] = await Promise.all([
    // Both go through the SDK's rules: the hook the current ruleset calls when paid, and the
    // router terminal the project's own terminal list names. A registry default is neither.
    resolveProjectBuybackHook(client, { chainId: row.chainId, projectId: BigInt(row.projectId) })
      .then((resolved) => resolved.hook)
      .catch(unread),
    resolveProjectRouterTerminal(client, {
      chainId: row.chainId,
      projectId: BigInt(row.projectId),
    })
      .then((resolved) => resolved.terminal)
      .catch(unread),
    buybackRegistry
      ? client
          .readContract({
            address: buybackRegistry,
            abi: jbBuybackHookRegistryAbi,
            functionName: "defaultHook",
          })
          .catch(unread)
      : Promise.resolve(null),
    routerRegistry
      ? client
          .readContract({
            address: routerRegistry,
            abi: jbRouterTerminalRegistryAbi,
            functionName: "defaultTerminal",
          })
          .catch(unread)
      : Promise.resolve(null),
  ]);

  // Chains without a full Uniswap v4 AMM have a registry with no default hook
  // or allowlisted terminal — setHookFor/initializePoolFor would revert there.
  const buybackAvailable = !!buybackRegistry && !!defaultHook && defaultHook !== zeroAddress;
  const routerAvailable = !!routerRegistry && !!defaultTerminal && defaultTerminal !== zeroAddress;

  let poolSummary = hook ? "No initialized pool resolved" : "No hook resolved";
  let pools: BuybackChainState["pools"] = [];
  if (hook) {
    const projectId = BigInt(row.projectId);
    const probes: { label: string; token: Address }[] = [{ label: "Native", token: zeroAddress }];
    const usdc = USDC_ADDRESSES[row.chainId];
    if (usdc) probes.push({ label: "USDC", token: usdc });
    const windows = await Promise.all(
      probes.map(async (probe) => {
        const args = [projectId, probe.token] as const;
        const [twap, key] = await Promise.all([
          client
            .readContract({
              address: hook,
              abi: jbBuybackHookAbi,
              functionName: "twapWindowOf",
              args,
            })
            .catch(() => 0n),
          client
            .readContract({ address: hook, abi: jbBuybackHookAbi, functionName: "poolKeyOf", args })
            .catch(() => null),
        ]);
        return {
          ...probe,
          twap: Number(twap),
          fee: Number(key?.fee ?? 3000),
          tickSpacing: Number(key?.tickSpacing ?? 60),
        };
      }),
    );
    pools = windows.filter((w) => w.twap > 0);
    if (pools.length) {
      poolSummary = pools.map((w) => `${w.label} pool | TWAP ${w.twap}s`).join(", ");
    }
  }

  return {
    ...row,
    buybackRegistry,
    routerRegistry,
    buybackAvailable,
    routerAvailable,
    hook,
    terminal,
    defaultHook,
    defaultTerminal,
    readFailed,
    pools,
    poolSummary,
  };
}

/** Shown when a chain's registry reads failed, so unknown never reads as unset. Same line as juicebox.money. */
export const READ_FAILED_LINE =
  "Could not verify registry availability or the project’s current selection.";

type ActionKind = "hook" | "terminal" | "pool" | "setPool" | "twap";

const ACTIONS: Record<
  ActionKind,
  { title: string; description: string; danger: string; fieldLabel: string }
> = {
  hook: {
    title: "Set buyback hook",
    description:
      "Points the project at the hook that chooses, on every payment, whether to issue tokens or buy them on the AMM. Requires SET_BUYBACK_HOOK.",
    danger: "The buyback hook intercepts every payment. A wrong hook can misroute or strand funds.",
    fieldLabel: "Buyback hook",
  },
  terminal: {
    title: "Set router terminal",
    description:
      "Sets the project's entry in the router registry: the terminal router-swapped funds are deposited to. Requires SET_ROUTER_TERMINAL.",
    danger:
      "This changes where router-swapped funds are deposited. A wrong terminal can misdirect or strand funds.",
    fieldLabel: "Router terminal",
  },
  pool: {
    title: "Initialize buyback pool",
    description:
      "Creates and price-initializes the Uniswap v4 pool for a pair token through the project's configured hook (set the hook first). Requires SET_BUYBACK_POOL.",
    danger:
      "A wrong initial price lets arbitrageurs extract value. Verify the price, fee, tick spacing, pair token, and every selected chain.",
    fieldLabel: "Pair (terminal) token",
  },
  setPool: {
    title: "Set buyback pool",
    description:
      "Points the project's hook at an existing Uniswap v4 pool for a pair token, without creating or pricing one. Requires SET_BUYBACK_POOL.",
    danger:
      "Every payment can swap through this pool. A wrong or illiquid pool lets arbitrageurs extract value. Verify the fee, tick spacing, pair token, and every selected chain.",
    fieldLabel: "Pair (terminal) token",
  },
  twap: {
    title: "Set TWAP window",
    description:
      "Changes how far back the buyback hook averages the pool price to decide swap-vs-issue and to floor the swap. Requires SET_BUYBACK_TWAP.",
    danger:
      "A longer window reacts slowly to price changes. The current buyback hook falls back to minting when a swap cannot meet the TWAP floor; previous hooks can still revert. A very short window is cheaper to manipulate. 300–172800 seconds.",
    fieldLabel: "Pair (terminal) token",
  },
};

/**
 * website/-parity renderBuybackRouterCard: cross-chain reads of the project's
 * actual buyback hook + router terminal (resolved through the ruleset data
 * hook, never the defaulting registry getters) and the three operator writes
 * against the registries, run per selected chain as sequential simulate-first
 * transactions.
 */
export function BuybackRouterCard({
  rows,
  fallbackOperator,
  fallbackProject,
}: {
  rows: ChainProjectRow[];
  /** Server-resolved operator candidate for the page chain; always live-checked. */
  fallbackOperator?: string;
  fallbackProject?: ChainProjectRow;
}) {
  // Each chain's live operator is the account the writes must come from: an
  // EOA sends them itself, a Safe gets them proposed by the connected signer.
  const { operatorByChain } = useLiveRevnetOperators(
    rows,
    fallbackProject ? { ...fallbackProject, address: fallbackOperator } : undefined,
  );
  const stateQuery = useQuery({
    queryKey: [
      "v6-buyback-router-state",
      rows.map((row) => `${row.chainId}:${row.projectId}`).join(","),
    ],
    enabled: rows.length > 0,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => Promise.all(rows.map((row) => readChainState(row))),
  });
  const states = stateQuery.data ?? [];
  const body = (kinds: ActionKind[]) =>
    stateQuery.isLoading ? (
      <SkeletonLines lines={kinds.length} className="mt-3" />
    ) : stateQuery.isError ? (
      <p className="text-sm text-red-600 mt-3">Could not read the registries.</p>
    ) : (
      <div className="mt-3 divide-y divide-melon-200">
        {kinds.map((kind) => (
          <ActionRow
            key={kind}
            kind={kind}
            states={states}
            authorityByChain={operatorByChain}
            onDone={() => stateQuery.refetch()}
          />
        ))}
      </div>
    );

  return (
    <>
      <OperatorSection title="Buyback hook">
        <div>
          <p className="text-sm text-zinc-500">
            Choose the hook that decides, on every payment, whether to issue tokens or buy them on
            the AMM, then point it at a Uniswap pool. When the operator is a Safe, a connected
            signer proposes each call for the other signers to confirm.
          </p>
          {body(["hook", "pool", "setPool", "twap"])}
        </div>
      </OperatorSection>
      <OperatorSection title="Swap router">
        <div>
          <p className="text-sm text-zinc-500">
            Choose the terminal the router registry deposits router-swapped funds to.
          </p>
          {body(["terminal"])}
        </div>
      </OperatorSection>
    </>
  );
}

function isKindAvailable(kind: ActionKind, state: BuybackChainState): boolean {
  if (kind === "terminal") return state.routerAvailable;
  // The TWAP window lives on the hook itself, and only for an initialized pool.
  if (kind === "twap") return state.buybackAvailable && !!state.hook && state.pools.length > 0;
  // The registry forwards setPoolFor to the project's resolved hook.
  if (kind === "setPool") return state.buybackAvailable && !!state.hook;
  return state.buybackAvailable;
}

function unavailableNote(kind: ActionKind, everywhere: boolean): string {
  if (kind === "twap") return `No initialized buyback pool ${everywhere ? "on any chain" : "here"}`;
  if (kind === "setPool") return `No buyback hook set ${everywhere ? "on any chain" : "here"}`;
  return `No Uniswap v4 registry ${everywhere ? "on any chain" : "here"}`;
}

function ActionRow({
  kind,
  states,
  authorityByChain,
  onDone,
}: {
  kind: ActionKind;
  states: BuybackChainState[];
  authorityByChain: ReadonlyMap<number, Address>;
  onDone: () => void;
}) {
  const action = ACTIONS[kind];
  const [open, setOpen] = useState(false);
  const available = states.filter((state) => isKindAvailable(kind, state));

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{action.title}</p>
        <p className="text-xs text-zinc-500 mt-1">{action.description}</p>
      </div>

      {(() => {
        const showsPool = kind === "pool" || kind === "setPool" || kind === "twap";
        const cell = (state: BuybackChainState) => {
          const isAvailable = isKindAvailable(kind, state);
          const value = kind === "hook" ? state.hook : kind === "terminal" ? state.terminal : null;
          return { isAvailable, value };
        };
        // When every chain reads the same, one value + a note beats four cards.
        const cells = states.map(cell);
        const summaries = states.map((state, i) =>
          state.readFailed
            ? "unread"
            : !cells[i].isAvailable
              ? "unavailable"
              : showsPool
                ? state.poolSummary
                : (cells[i].value ?? "unset").toLowerCase(),
        );
        const allSame = states.length > 1 && summaries.every((s) => s === summaries[0]);

        if (allSame) {
          const first = states[0];
          const { isAvailable, value } = cells[0];
          return (
            <div className="mt-2 flex items-start gap-2 border border-melon-200 px-2.5 py-1.5">
              <div className="min-w-0">
                {first.readFailed ? (
                  <p className="text-xs text-zinc-500">{READ_FAILED_LINE}</p>
                ) : !isAvailable ? (
                  <p className="text-xs text-zinc-500">{unavailableNote(kind, true)}</p>
                ) : showsPool ? (
                  <p className="text-xs text-zinc-600">{first.poolSummary}</p>
                ) : value ? (
                  <EthereumAddress
                    address={value}
                    short
                    chain={JB_CHAINS[first.chainId]?.chain}
                    className="text-xs font-mono"
                  />
                ) : (
                  <p className="text-xs text-zinc-500">Not set</p>
                )}
                <p className="text-xs text-zinc-500 mt-0.5">Same on all chains</p>
              </div>
            </div>
          );
        }

        return (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {states.map((state) => {
              const { isAvailable, value } = cell(state);
              return (
                <div
                  key={state.chainId}
                  className="flex items-start gap-2 border border-melon-200 px-2.5 py-1.5"
                >
                  <ChainLogo chainId={state.chainId} width={14} height={14} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-700">{chainName(state.chainId)}</p>
                    {state.readFailed ? (
                      <p className="text-xs text-zinc-500">{READ_FAILED_LINE}</p>
                    ) : !isAvailable ? (
                      <p className="text-xs text-zinc-500">{unavailableNote(kind, false)}</p>
                    ) : showsPool ? (
                      <p className="text-xs text-zinc-600">{state.poolSummary}</p>
                    ) : value ? (
                      <EthereumAddress
                        address={value}
                        short
                        chain={JB_CHAINS[state.chainId]?.chain}
                        className="text-xs font-mono"
                      />
                    ) : (
                      <p className="text-xs text-zinc-500">Not set</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        disabled={!available.length}
        onClick={() => setOpen(true)}
      >
        {action.title}
      </Button>

      {open ? (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="max-w-xl">
            <DialogTitle className="text-base font-medium">{action.title}</DialogTitle>
            <p className="text-xs text-zinc-500">{action.description}</p>
            <BuybackActionForm
              kind={kind}
              available={available}
              authorityByChain={authorityByChain}
              onDone={() => {
                setOpen(false);
                onDone();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

const DIGITS = /^\d+$/;

/** What a signer should do next once the call sits in the Safe queue(s). */
function describeSafeOutcome(
  title: string,
  result: { chains: number; safeQueued: number; safeConfirmed: number },
): string {
  const parts: string[] = [];
  if (result.safeQueued) {
    parts.push(
      `${title} proposed to the operator Safe on ${result.safeQueued} chain${result.safeQueued === 1 ? "" : "s"}`,
    );
  }
  if (result.safeConfirmed) {
    parts.push(
      `your confirmation added to the identical proposal already queued on ${result.safeConfirmed} chain${result.safeConfirmed === 1 ? "" : "s"}`,
    );
  }
  if (result.chains) {
    parts.push(`executed directly on ${result.chains} chain${result.chains === 1 ? "" : "s"}`);
  }
  return `${parts.join("; ")}. Nothing changes until the Safe's signers confirm and execute it, in the Safe queue card above or the Safe app.`;
}

function BuybackActionForm({
  kind,
  available,
  authorityByChain,
  onDone,
}: {
  kind: ActionKind;
  available: BuybackChainState[];
  authorityByChain: ReadonlyMap<number, Address>;
  onDone: () => void;
}) {
  const action = ACTIONS[kind];
  const { address } = useAccount();
  const { runWrites } = useOperatorWrites();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(available.map((state) => state.chainId)),
  );
  // What each typed address or ENS name stands for; null while it stands for none.
  const [resolved, setResolved] = useState<Record<number, Address | null>>({});
  const [addresses, setAddresses] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      available.map((state) => [
        state.chainId,
        kind === "hook"
          ? state.defaultHook && state.defaultHook !== zeroAddress
            ? state.defaultHook
            : ""
          : kind === "terminal"
            ? state.defaultTerminal && state.defaultTerminal !== zeroAddress
              ? state.defaultTerminal
              : ""
            : // Pre-select the pool the chain already has, so a TWAP edit targets
              // an initialized pair instead of a native pool a USDC revnet never
              // had. Native pools read back as address(0); show the sentinel.
              (kind === "twap" || kind === "setPool") &&
                state.pools[0] &&
                state.pools[0].token !== zeroAddress
              ? state.pools[0].token
              : NATIVE_TOKEN,
      ]),
    ),
  );
  // Set pool and TWAP edits start from the pool the first chain already has.
  const livePool = kind === "twap" || kind === "setPool" ? available[0]?.pools[0] : undefined;
  const [fee, setFee] = useState(String(livePool?.fee ?? 3000));
  const [tickSpacing, setTickSpacing] = useState(String(livePool?.tickSpacing ?? 60));
  const [twapWindow, setTwapWindow] = useState(String(livePool?.twap ?? 1800));
  const [sqrtPriceX96, setSqrtPriceX96] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ChainWrite[] | null>(null);
  const [reviewShown, setReviewShown] = useState<Record<number, string>>({});
  // A send that went to the Safe as a proposal: nothing more to send from here.
  const [proposed, setProposed] = useState(false);

  const chosen = useMemo(
    () => available.filter((state) => selected.has(state.chainId)),
    [available, selected],
  );
  // Chain states come from the server sucker-group rows: only chain-verified pairs are written.
  const gate = useGroupWriteGate(chosen);

  const buildWrites = (): ChainWrite[] => {
    if (!chosen.length) throw new Error("Choose at least one available chain.");
    gate.assertVerified(chosen);
    let poolValues: {
      fee: number;
      tickSpacing: number;
      twapWindow: bigint;
      sqrtPriceX96: bigint;
    } | null = null;
    if (kind === "pool" || kind === "setPool") {
      const numbers =
        kind === "pool"
          ? [fee, tickSpacing, twapWindow, sqrtPriceX96]
          : [fee, tickSpacing, twapWindow];
      if (!numbers.every((v) => DIGITS.test(v))) {
        throw new Error("Fee, tick spacing, TWAP window, and price must be whole numbers.");
      }
      poolValues = {
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        twapWindow: BigInt(twapWindow),
        sqrtPriceX96: kind === "pool" ? BigInt(sqrtPriceX96) : 0n,
      };
      if (poolValues.fee < 0 || poolValues.fee > 0xffffff) {
        throw new Error("Fee must fit uint24.");
      }
      if (poolValues.tickSpacing < 1 || poolValues.tickSpacing > 0x7fffff) {
        throw new Error("Tick spacing must be a positive int24 value.");
      }
      // The hook's own bounds, not uint32's. The old range accepted windows the hook
      // rejects, so an operator could submit one that reverts at execution.
      if (
        poolValues.twapWindow < BigInt(MIN_TWAP_WINDOW) ||
        poolValues.twapWindow > BigInt(MAX_TWAP_WINDOW)
      ) {
        throw new Error(
          `The hook only accepts a TWAP window between ${MIN_TWAP_WINDOW} and ${MAX_TWAP_WINDOW} seconds.`,
        );
      }
      // Registering with EXACTLY MAX_TWAP_WINDOW stores the 30-minute default instead
      // (JBBuybackHook.sol:140-148) — immutable deployers bake MAX in as a sentinel meaning
      // "no preference". Asking for MAX here silently gets 30 minutes, so say so rather than
      // let the operator believe they set 2 days.
      if (poolValues.twapWindow === BigInt(MAX_TWAP_WINDOW)) {
        throw new Error(
          `A pool registered with exactly ${MAX_TWAP_WINDOW}s stores the hook's 30-minute default instead (it is the "no preference" sentinel). ` +
            `Use ${MAX_TWAP_WINDOW - 1} for the longest real window, or set 1800 deliberately.`,
        );
      }
      if (
        kind === "pool" &&
        (poolValues.sqrtPriceX96 <= 0n || poolValues.sqrtPriceX96 >= 2n ** 160n)
      ) {
        throw new Error("Initial price must be a positive uint160 value.");
      }
    }
    let newTwapWindow = 0;
    if (kind === "twap") {
      if (!DIGITS.test(twapWindow)) throw new Error("Enter the TWAP window in whole seconds.");
      newTwapWindow = Number(twapWindow);
      if (newTwapWindow < MIN_TWAP_WINDOW || newTwapWindow > MAX_TWAP_WINDOW) {
        throw new Error(
          `The hook only accepts a TWAP window between ${MIN_TWAP_WINDOW} and ${MAX_TWAP_WINDOW} seconds.`,
        );
      }
    }

    const writes: ChainWrite[] = chosen.map((state) => {
      const target = resolved[state.chainId];
      if (!target) {
        throw new Error(
          `${chainName(state.chainId)}: enter a valid ${action.fieldLabel.toLowerCase()} address.`,
        );
      }
      const projectId = BigInt(state.projectId);
      const authority = authorityByChain.get(state.chainId);
      if (kind === "hook") {
        if (!state.buybackRegistry)
          throw new Error(`${chainName(state.chainId)}: no buyback registry.`);
        return {
          chainId: state.chainId,
          address: state.buybackRegistry,
          abi: jbBuybackHookRegistryAbi,
          functionName: "setHookFor",
          args: [projectId, target],
          contractName: "JBBuybackHookRegistry",
          authority,
        };
      }
      if (kind === "terminal") {
        if (!state.routerRegistry)
          throw new Error(`${chainName(state.chainId)}: no router registry.`);
        return {
          chainId: state.chainId,
          address: state.routerRegistry,
          abi: jbRouterTerminalRegistryAbi,
          functionName: "setTerminalFor",
          args: [projectId, target],
          contractName: "JBRouterTerminalRegistry",
          authority,
        };
      }
      if (kind === "twap") {
        // The registry has no setTwapWindowOf forwarder — the write goes to
        // the project's resolved hook.
        if (!state.hook) throw new Error(`${chainName(state.chainId)}: no buyback hook set.`);
        return {
          chainId: state.chainId,
          address: state.hook,
          abi: jbBuybackHookAbi,
          functionName: "setTwapWindowOf",
          args: [projectId, target, BigInt(newTwapWindow)],
          contractName: "JBBuybackHook",
          authority,
        };
      }
      if (!state.buybackRegistry || !poolValues)
        throw new Error(`${chainName(state.chainId)}: no buyback registry.`);
      if (kind === "setPool") {
        return {
          chainId: state.chainId,
          address: state.buybackRegistry,
          abi: jbBuybackHookRegistryAbi,
          functionName: "setPoolFor",
          args: [projectId, poolValues.fee, poolValues.tickSpacing, poolValues.twapWindow, target],
          contractName: "JBBuybackHookRegistry",
          authority,
        };
      }
      return {
        chainId: state.chainId,
        address: state.buybackRegistry,
        abi: jbBuybackHookRegistryAbi,
        functionName: "initializePoolFor",
        args: [
          projectId,
          poolValues.fee,
          poolValues.tickSpacing,
          poolValues.twapWindow,
          target,
          poolValues.sqrtPriceX96,
        ],
        contractName: "JBBuybackHookRegistry",
        authority,
      };
    });
    return writes;
  };

  const prepare = () => {
    if (busy || !address || !ack) return;
    setError(null);
    setStatus(null);
    setProposed(false);
    try {
      const writes = buildWrites();
      // Frozen with the calls: a later ENS refresh must not rename what they carry.
      setReviewShown(
        Object.fromEntries(writes.map((write) => [write.chainId, shownAddress(write.chainId)])),
      );
      setReview(writes);
    } catch (e) {
      const message = formatWalletError(e) || "Could not complete this action.";
      setError(message);
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  // The same calls the submit would send, queued in each chain's tray instead.
  const addToBatch = () => {
    // A queued step is sent later with no second look at this warning.
    if (busy || !ack) return;
    setError(null);
    try {
      const chains = addStepsToBatch(buildWrites().map(stepFromWrite));
      toast({
        title: "Added to the batch",
        description: `Added to the batch for ${chains.map(chainName).join(", ")}.`,
      });
      onDone();
    } catch (e) {
      const message = formatWalletError(e) || "Could not add this action to the batch.";
      setError(message);
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  // The review names the address a call carries, with the ENS name it was typed as.
  const shownAddress = (chainId: number) => {
    const typed = (addresses[chainId] ?? "").trim();
    const address = resolved[chainId] ?? typed;
    return address.toLowerCase() === typed.toLowerCase() ? address : `${address} (${typed})`;
  };
  const context = review
    ? [
        { label: "On", value: review.map((write) => chainName(write.chainId)).join(", ") },
        new Set(review.map((write) => reviewShown[write.chainId])).size === 1
          ? {
              label: action.fieldLabel,
              value: reviewShown[review[0].chainId],
              mono: true,
            }
          : {
              label: action.fieldLabel,
              value: `${review.length} chains`,
              lines: review.map(
                (write) => `${chainName(write.chainId)}: ${reviewShown[write.chainId]}`,
              ),
            },
        ...(kind === "pool" || kind === "setPool"
          ? [
              { label: "Pool fee", value: `${Number(fee) / 10000}% (${fee})` },
              { label: "Tick spacing", value: String(tickSpacing) },
            ]
          : []),
        ...(kind === "pool"
          ? [{ label: "Initial price", value: String(sqrtPriceX96), mono: true }]
          : []),
        ...(kind === "pool" || kind === "setPool" || kind === "twap"
          ? [{ label: "TWAP window", value: `${twapWindow}s` }]
          : []),
      ]
    : [];

  const submit = async () => {
    if (busy || !address || !review) return;
    setError(null);
    try {
      gate.assertVerified(chosen);
      setBusy(true);
      const result = await runWrites({
        writes: review,
        account: address,
        label: action.title,
        context,
        onProgress: setStatus,
      });
      if (result.safeProposal) {
        setStatus("Payment proposed to the Safe. The bundle runs once it executes.");
        toast({
          title: "Safe payment proposal submitted",
          description: `${action.title} is not applied yet. Complete the payment in Safe.`,
        });
      } else if (result.safeQueued || result.safeConfirmed) {
        const message = describeSafeOutcome(action.title, result);
        setStatus(message);
        toast({ title: "Proposed to the operator Safe", description: message });
      } else {
        setStatus(
          `${action.title} completed on ${result.chains} chain${result.chains === 1 ? "" : "s"}.`,
        );
        toast({ title: action.title, description: "Transaction(s) confirmed." });
      }
      setReview(null);
      onDone();
    } catch (e) {
      const message = formatWalletError(e) || "Could not complete this action.";
      if (reviewClosed(e)) setReview(null);
      else if (isSafeProposalPendingError(e)) {
        setStatus(message);
        setProposed(true);
        toast({ title: "Safe proposal submitted", description: message });
      } else {
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2">
        <label className="block text-sm font-medium mb-1">Run on</label>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {available.map((state) => (
            <label key={state.chainId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(state.chainId)}
                disabled={busy}
                onChange={(e) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(state.chainId);
                    else next.delete(state.chainId);
                    return next;
                  })
                }
              />
              <ChainLogo chainId={state.chainId} width={14} height={14} />
              {chainName(state.chainId)}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-sm font-medium mb-1">{action.fieldLabel} per chain</label>
        <div className="space-y-2">
          {chosen.map((state) => (
            <div key={state.chainId} className="grid gap-1">
              <span className="flex items-center gap-1.5 text-xs">
                <ChainLogo chainId={state.chainId} width={14} height={14} />
                {chainName(state.chainId)}
              </span>
              <EnsAddressInput
                value={addresses[state.chainId] ?? ""}
                onChange={(value) =>
                  setAddresses((current) => ({ ...current, [state.chainId]: value }))
                }
                onResolved={(address) =>
                  setResolved((current) =>
                    current[state.chainId] === address
                      ? current
                      : { ...current, [state.chainId]: address },
                  )
                }
                disabled={busy}
                placeholder={`0x… or name.eth ${action.fieldLabel.toLowerCase()}`}
                ariaLabel={`${action.fieldLabel} on ${chainName(state.chainId)}`}
              />
            </div>
          ))}
        </div>
        {kind === "pool" || kind === "setPool" || kind === "twap" ? (
          <p className="text-xs text-zinc-500 mt-1">
            For native ETH pools, enter <span className="break-all">{NATIVE_TOKEN}</span>. USDC and
            other token addresses can differ by chain.
          </p>
        ) : null}
        {kind === "twap"
          ? chosen.map((state) => (
              <p key={state.chainId} className="text-xs text-zinc-500 mt-1">
                {chainName(state.chainId)} now: {state.poolSummary}
              </p>
            ))
          : null}
      </div>

      {kind === "pool" || kind === "setPool" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Pool fee (3000 = 0.3%)"
            value={fee}
            onChange={setFee}
            disabled={busy}
            placeholder="3000"
          />
          <NumberField
            label="Tick spacing"
            value={tickSpacing}
            onChange={setTickSpacing}
            disabled={busy}
            placeholder="60 for a 0.3% pool"
          />
          <NumberField
            label="TWAP window (seconds)"
            note={PROTOCOL_CONCEPTS.twapWindow}
            value={twapWindow}
            onChange={setTwapWindow}
            disabled={busy}
            placeholder="1800"
          />
          {kind === "pool" ? (
            <NumberField
              label="Initial price (sqrtPriceX96)"
              value={sqrtPriceX96}
              onChange={setSqrtPriceX96}
              disabled={busy}
              placeholder="positive uint160"
            />
          ) : null}
        </div>
      ) : null}

      {kind === "twap" ? (
        <div className="mt-3 sm:max-w-xs">
          <NumberField
            label="TWAP window (seconds)"
            note={PROTOCOL_CONCEPTS.twapWindow}
            value={twapWindow}
            onChange={setTwapWindow}
            disabled={busy}
            placeholder="1800 = 30 min"
          />
        </div>
      ) : null}

      <label className="mt-3 flex items-start gap-2 border border-red-300 p-3">
        <input
          type="checkbox"
          checked={ack}
          disabled={busy}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-xs text-red-700">
          I verified every selected chain and value. {action.danger}
        </span>
      </label>

      {gate.line ? <p className="text-xs text-zinc-600 mt-3">{gate.line}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-11"
          disabled={busy || gate.blocked || !ack || !chosen.length}
          onClick={addToBatch}
        >
          Add to batch
        </Button>
        <ButtonWithWallet
          targetChainId={chosen[0]?.chainId}
          connectWalletText="Connect wallet to continue"
          loading={busy || gate.pending}
          disabled={busy || gate.blocked || !ack || !chosen.length}
          onClick={prepare}
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          {action.title}
        </ButtonWithWallet>
      </div>
      {status && !review ? <p className="text-xs text-zinc-500 mt-2">{status}</p> : null}
      {error && !review ? <ErrorNote message={error} /> : null}
      {review ? (
        <TxProgress
          open
          onClose={() => {
            setReview(null);
            setProposed(false);
          }}
          title={action.title}
          steps={[
            {
              title: action.title,
              detail:
                review.length > 1
                  ? kind === "pool"
                    ? "Use an operator wallet across supported mainnets or across supported testnets. With Safe or other networks, initialize and confirm one chain at a time."
                    : "One bundle when the selected networks are all supported mainnets or all supported testnets; otherwise, one wallet transaction per chain. Safe signers propose to each chain's queue."
                  : "From the operator wallet, or proposed to the operator Safe from a signer.",
            },
          ]}
          activeIndex={busy ? 0 : -1}
          start={() => void submit()}
          busy={busy}
          status={status}
          complete={proposed}
          error={error}
          rows={context}
        />
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  /** What the field MEANS, for a term the operator may not know. */
  note?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">
        {note ? <ConceptTerm note={note}>{label}</ConceptTerm> : label}
      </span>
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        disabled={disabled}
        placeholder={placeholder}
        className="h-8 text-xs tabular-nums"
      />
    </label>
  );
}
