"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { Button } from "@/components/ui/button";
import { ConceptTerm } from "@/components/ui/ConceptTerm";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/skeleton";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { isSafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { PROTOCOL_CONCEPTS } from "@/lib/protocolConcepts";
import { formatWalletError } from "@/lib/utils";
import {
  JBBuybackHookContracts,
  JBCoreContracts,
  JBRouterTerminalContracts,
  JB_CHAINS,
  NATIVE_TOKEN,
  RevnetCoreContracts,
  USDC_ADDRESSES,
  jbBuybackHookAbi,
  jbBuybackHookRegistryAbi,
  jbControllerAbi,
  jbDirectoryAbi,
  jbOmnichainDeployerAbi,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Address, isAddress, zeroAddress } from "viem";
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
  /** Pair tokens with an initialized pool on this chain, and their TWAP window. */
  pools: { label: string; token: Address; twap: number }[];
  poolSummary: string;
};

/** `JBBuybackHook._requireValidTwapWindow`: 5 minutes to 2 days. */
const MIN_TWAP_WINDOW = 300;
const MAX_TWAP_WINDOW = 172_800;

const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Resolve the project's real buyback hook on a chain. hookOf/defaultHook must
 * NOT be trusted alone (the registry resolves a default even for projects that
 * don't route through it) — recognition goes through the ruleset DATA HOOK:
 * JBDirectory.controllerOf → currentRulesetOf → metadata.dataHook, unwrapping
 * the known singleton wrappers (REVOwner, the registry itself, and
 * JBOmnichainDeployer's extraDataHookOf indirection).
 */
async function resolveBuybackHook(row: ChainProjectRow): Promise<Address | null> {
  const client = publicClientFor(row.chainId);
  const directory = v6ContractAddress(JBCoreContracts.JBDirectory, row.chainId);
  const registry = v6ContractAddress(JBBuybackHookContracts.JBBuybackHookRegistry, row.chainId);
  const revOwner = v6ContractAddress(RevnetCoreContracts.REVOwner, row.chainId);
  const omni = v6ContractAddress("JBOmnichainDeployer", row.chainId);
  const concrete = v6ContractAddress(JBBuybackHookContracts.JBBuybackHook, row.chainId);
  if (!directory) return null;
  const projectId = BigInt(row.projectId);

  const controller = await client.readContract({
    address: directory,
    abi: jbDirectoryAbi,
    functionName: "controllerOf",
    args: [projectId],
  });
  if (!controller || controller === zeroAddress) return null;

  const [ruleset, metadata] = await client.readContract({
    address: controller,
    abi: jbControllerAbi,
    functionName: "currentRulesetOf",
    args: [projectId],
  });
  let dataHook: Address = metadata.dataHook;
  if (omni && sameAddress(dataHook, omni)) {
    const config = await client
      .readContract({
        address: omni,
        abi: jbOmnichainDeployerAbi,
        functionName: "extraDataHookOf",
        args: [projectId, BigInt(ruleset.id)],
      })
      .catch(() => null);
    if (!config) return null;
    dataHook = config.dataHook;
  }
  if (!dataHook || dataHook === zeroAddress) return null;
  if (sameAddress(dataHook, registry) || sameAddress(dataHook, revOwner)) {
    if (!registry) return null;
    const hook = await client
      .readContract({
        address: registry,
        abi: jbBuybackHookRegistryAbi,
        functionName: "hookOf",
        args: [projectId],
      })
      .catch(() => null);
    return hook && hook !== zeroAddress ? hook : null;
  }
  if (concrete && sameAddress(dataHook, concrete)) return dataHook;
  return null; // 721 tiers, croptop, defifa, unknown — no buyback pool.
}

/**
 * The project's router terminal: terminals are a LIST, so gate on
 * JBDirectory.isTerminalOf before trusting the registry's terminalOf (which
 * also resolves a default for non-users).
 */
async function resolveRouterTerminal(row: ChainProjectRow): Promise<Address | null> {
  const client = publicClientFor(row.chainId);
  const directory = v6ContractAddress(JBCoreContracts.JBDirectory, row.chainId);
  const registry = v6ContractAddress(
    JBRouterTerminalContracts.JBRouterTerminalRegistry,
    row.chainId,
  );
  const direct = v6ContractAddress(JBRouterTerminalContracts.JBRouterTerminal, row.chainId);
  if (!directory) return null;
  const projectId = BigInt(row.projectId);
  const isTerminal = (address?: Address) =>
    address
      ? client
          .readContract({
            address: directory,
            abi: jbDirectoryAbi,
            functionName: "isTerminalOf",
            args: [projectId, address],
          })
          .catch(() => false)
      : Promise.resolve(false);

  if (await isTerminal(registry)) {
    const terminal = await client
      .readContract({
        address: registry!,
        abi: jbRouterTerminalRegistryAbi,
        functionName: "terminalOf",
        args: [projectId],
      })
      .catch(() => null);
    return terminal && terminal !== zeroAddress ? terminal : null;
  }
  if (await isTerminal(direct)) return direct!;
  return null;
}

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

  const [hook, terminal, defaultHook, defaultTerminal] = await Promise.all([
    resolveBuybackHook(row).catch(() => null),
    resolveRouterTerminal(row).catch(() => null),
    buybackRegistry
      ? client
          .readContract({
            address: buybackRegistry,
            abi: jbBuybackHookRegistryAbi,
            functionName: "defaultHook",
          })
          .catch(() => null)
      : Promise.resolve(null),
    routerRegistry
      ? client
          .readContract({
            address: routerRegistry,
            abi: jbRouterTerminalRegistryAbi,
            functionName: "defaultTerminal",
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // Chains without a full Uniswap v4 AMM have a registry with no default hook
  // or allowlisted terminal — setHookFor/initializePoolFor would revert there.
  const buybackAvailable = !!buybackRegistry && !!defaultHook && defaultHook !== zeroAddress;
  const routerAvailable = !!routerRegistry && !!defaultTerminal && defaultTerminal !== zeroAddress;

  let poolSummary = hook ? "Not initialized" : "Set the hook first";
  let pools: BuybackChainState["pools"] = [];
  if (hook) {
    const projectId = BigInt(row.projectId);
    const probes: { label: string; token: Address }[] = [{ label: "Native", token: zeroAddress }];
    const usdc = USDC_ADDRESSES[row.chainId];
    if (usdc) probes.push({ label: "USDC", token: usdc });
    const windows = await Promise.all(
      probes.map(async (probe) => ({
        ...probe,
        twap: Number(
          await client
            .readContract({
              address: hook,
              abi: jbBuybackHookAbi,
              functionName: "twapWindowOf",
              args: [projectId, probe.token],
            })
            .catch(() => 0n),
        ),
      })),
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
    pools,
    poolSummary,
  };
}

type ActionKind = "hook" | "terminal" | "pool" | "twap";

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
      "Sets the terminal the swap router forwards into after swapping USDC or another payment token. Requires SET_ROUTER_TERMINAL.",
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
  twap: {
    title: "Set TWAP window",
    description:
      "Changes how far back the buyback hook averages the pool price to decide swap-vs-issue and to floor the swap. Written straight to the project's hook. Requires SET_BUYBACK_TWAP.",
    danger:
      "A window longer than the pool's price actually trends floors swaps above what the pool can fill, and every payment routed to a swap reverts. A very short window is cheaper to manipulate. 300–172800 seconds.",
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

  return (
    <OperatorSection title="Buyback &amp; swap router">
      <div>
        <p className="text-sm text-zinc-500">
          Wire up the project&apos;s buyback hook and swap router, initialize its Uniswap pool, and
          tune the pool&apos;s TWAP window. An operator wallet signs one chain directly and runs
          several supported mainnets or several supported testnets as one Relayr bundle. Other
          routes use a wallet transaction on each chain. When the operator is a Safe, a connected
          signer proposes the call to each chain&apos;s Safe queue for the other signers to confirm.
          Initialize pools one chain at a time with Safe or other networks.
        </p>
        {stateQuery.isLoading ? (
          <SkeletonLines lines={4} className="mt-3" />
        ) : stateQuery.isError ? (
          <p className="text-sm text-red-600 mt-3">Could not read the buyback registries.</p>
        ) : (
          <div className="mt-3 divide-y divide-melon-200 bg-melon-50 px-4">
            {(["hook", "terminal", "pool", "twap"] as const).map((kind) => (
              <ActionRow
                key={kind}
                kind={kind}
                states={states}
                authorityByChain={operatorByChain}
                onDone={() => stateQuery.refetch()}
              />
            ))}
          </div>
        )}
      </div>
    </OperatorSection>
  );
}

/** A chain can run the action only where its target contract resolves. */
function isKindAvailable(kind: ActionKind, state: BuybackChainState): boolean {
  if (kind === "terminal") return state.routerAvailable;
  // The TWAP window lives on the hook itself, and only for an initialized pool.
  if (kind === "twap") return state.buybackAvailable && !!state.hook && state.pools.length > 0;
  return state.buybackAvailable;
}

function unavailableNote(kind: ActionKind, everywhere: boolean): string {
  if (kind === "twap") return `No initialized buyback pool ${everywhere ? "on any chain" : "here"}`;
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
  // A running write owns the dialog: dismissing it would hide the only progress
  // report for a transaction that keeps going regardless.
  const [busy, setBusy] = useState(false);
  const available = states.filter((state) => isKindAvailable(kind, state));

  return (
    <div className="py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{action.title}</p>
        <p className="text-xs text-zinc-500 mt-1">{action.description}</p>
      </div>

      {(() => {
        const showsPool = kind === "pool" || kind === "twap";
        const cell = (state: BuybackChainState) => {
          const isAvailable = isKindAvailable(kind, state);
          const value = kind === "hook" ? state.hook : kind === "terminal" ? state.terminal : null;
          return { isAvailable, value };
        };
        // When every chain reads the same, one value + a note beats four cards.
        const cells = states.map(cell);
        const summaries = states.map((state, i) =>
          !cells[i].isAvailable
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
            <div className="mt-2 flex items-start gap-2 bg-melon-100 px-2.5 py-1.5">
              <div className="min-w-0">
                {!isAvailable ? (
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
                  className="flex items-start gap-2 bg-melon-100 px-2.5 py-1.5"
                >
                  <ChainLogo chainId={state.chainId} width={14} height={14} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-700">{chainName(state.chainId)}</p>
                    {!isAvailable ? (
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
        <Dialog open onOpenChange={(next) => !next && !busy && setOpen(false)}>
          <DialogContent className="max-w-xl">
            <DialogTitle className="text-base font-medium">{action.title}</DialogTitle>
            <p className="text-xs text-zinc-500">{action.description}</p>
            <BuybackActionForm
              kind={kind}
              available={available}
              authorityByChain={authorityByChain}
              onBusyChange={setBusy}
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
  return `${parts.join("; ")}. Nothing changes until the Safe's signers confirm and execute it — from the Safe queue card above or the Safe app.`;
}

function BuybackActionForm({
  kind,
  available,
  authorityByChain,
  onBusyChange,
  onDone,
}: {
  kind: ActionKind;
  available: BuybackChainState[];
  authorityByChain: ReadonlyMap<number, Address>;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}) {
  const action = ACTIONS[kind];
  const { address } = useAccount();
  const { runWrites } = useOperatorWrites();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(available.map((state) => state.chainId)),
  );
  const [addresses, setAddresses] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      available.map((state) => [
        state.chainId,
        kind === "hook"
          ? (state.hook ?? "")
          : kind === "terminal"
            ? (state.terminal ?? "")
            : // Pre-select the pool the chain already has, so a TWAP edit targets
              // an initialized pair instead of a native pool a USDC revnet never
              // had. Native pools read back as address(0); show the sentinel.
              kind === "twap" && state.pools[0] && state.pools[0].token !== zeroAddress
              ? state.pools[0].token
              : NATIVE_TOKEN,
      ]),
    ),
  );
  const [fee, setFee] = useState("3000");
  const [tickSpacing, setTickSpacing] = useState("60");
  const [twapWindow, setTwapWindow] = useState(() =>
    kind === "twap" ? String(available[0]?.pools[0]?.twap ?? 1800) : "1800",
  );
  const [sqrtPriceX96, setSqrtPriceX96] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusyState] = useState(false);
  const setBusy = (next: boolean) => {
    setBusyState(next);
    onBusyChange(next);
  };
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ChainWrite[] | null>(null);

  const chosen = useMemo(
    () => available.filter((state) => selected.has(state.chainId)),
    [available, selected],
  );

  const buildWrites = (): ChainWrite[] => {
    if (!chosen.length) throw new Error("Choose at least one available chain.");
    let poolValues: {
      fee: number;
      tickSpacing: number;
      twapWindow: bigint;
      sqrtPriceX96: bigint;
    } | null = null;
    if (kind === "pool") {
      if (![fee, tickSpacing, twapWindow, sqrtPriceX96].every((v) => DIGITS.test(v))) {
        throw new Error("Fee, tick spacing, TWAP window, and price must be whole numbers.");
      }
      poolValues = {
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        twapWindow: BigInt(twapWindow),
        sqrtPriceX96: BigInt(sqrtPriceX96),
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
      if (poolValues.sqrtPriceX96 <= 0n || poolValues.sqrtPriceX96 >= 2n ** 160n) {
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
      const input = (addresses[state.chainId] ?? "").trim();
      if (!isAddress(input)) {
        throw new Error(
          `${chainName(state.chainId)}: enter a valid ${action.fieldLabel.toLowerCase()} address.`,
        );
      }
      const target = input as Address;
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
    try {
      setReview(buildWrites());
    } catch (e) {
      const message = formatWalletError(e) || "Could not complete this action.";
      setError(message);
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const submit = async () => {
    if (busy || !address || !review) return;
    setError(null);
    try {
      setBusy(true);
      const result = await runWrites({
        writes: review,
        account: address,
        label: action.title,
        onProgress: setStatus,
      });
      if (result.safeProposal) {
        setStatus("Relayr payment proposed to the Safe. The bundle runs once it executes.");
        toast({
          title: "Safe payment proposal submitted",
          description: `${action.title} is not applied yet — complete the Relayr payment in Safe.`,
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
      setError(message);
      toast(
        isSafeProposalPendingError(e)
          ? { title: "Safe proposal submitted", description: message }
          : { variant: "destructive", title: "Error", description: message },
      );
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
            <div key={state.chainId} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs w-36 shrink-0">
                <ChainLogo chainId={state.chainId} width={14} height={14} />
                {chainName(state.chainId)}
              </span>
              <Input
                value={addresses[state.chainId] ?? ""}
                onChange={(e) =>
                  setAddresses((current) => ({
                    ...current,
                    [state.chainId]: e.target.value,
                  }))
                }
                disabled={busy}
                placeholder={`0x… ${action.fieldLabel.toLowerCase()}`}
                className="h-8 text-xs font-mono"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
        {kind === "pool" || kind === "twap" ? (
          <p className="text-xs text-zinc-500 mt-1">
            Use the native-token sentinel ({NATIVE_TOKEN}) for native ETH pools; the hook stores
            that pool key under address(0). USDC and other pair-token addresses can differ by chain.
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

      {kind === "pool" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Fee (hundredths of a bip)"
            value={fee}
            onChange={setFee}
            disabled={busy}
            placeholder="3000 = 0.3%"
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
          <NumberField
            label="Initial price (sqrtPriceX96)"
            value={sqrtPriceX96}
            onChange={setSqrtPriceX96}
            disabled={busy}
            placeholder="positive uint160"
          />
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

      <label className="mt-3 flex items-start gap-2 border border-red-300 bg-red-50 rounded p-3">
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

      <div className="mt-3 flex justify-end">
        <ButtonWithWallet
          targetChainId={chosen[0]?.chainId}
          connectWalletText="Connect wallet to continue"
          loading={busy}
          disabled={busy || !ack || !chosen.length}
          onClick={prepare}
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          {action.title}
        </ButtonWithWallet>
      </div>
      {status && !review ? <p className="text-xs text-zinc-500 mt-2">{status}</p> : null}
      {error && !review ? <p className="text-xs text-red-600 mt-2">{error}</p> : null}
      {review ? (
        <TxConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setReview(null);
          }}
          title={action.title}
          chainId={review[0].chainId}
          steps={[
            {
              title: action.title,
              detail:
                review.length > 1
                  ? kind === "pool"
                    ? "Use an operator wallet with Relayr across supported mainnets or across supported testnets. With Safe or other networks, initialize and confirm one chain at a time."
                    : "One Relayr bundle when the selected networks are all supported mainnets or all supported testnets; otherwise, one wallet transaction per chain. Safe signers propose to each chain's queue."
                  : "From the operator wallet, or proposed to the operator Safe from a signer.",
            },
          ]}
          activeIndex={busy ? 0 : -1}
          action={action.title}
          onConfirm={() => void submit()}
          busy={busy}
          status={status}
          error={error}
        >
          <SummaryRow label="On">
            {review.map((write) => chainName(write.chainId)).join(", ")}
          </SummaryRow>
          <SummaryRow label={action.fieldLabel}>
            {new Set(review.map((write) => (addresses[write.chainId] ?? "").trim())).size === 1 ? (
              <span className="break-all font-mono text-xs">
                {(addresses[review[0].chainId] ?? "").trim()}
              </span>
            ) : (
              review.map((write) => (
                <span key={write.chainId} className="block break-all font-mono text-xs">
                  {chainName(write.chainId)}: {(addresses[write.chainId] ?? "").trim()}
                </span>
              ))
            )}
          </SummaryRow>
          {kind === "pool" ? (
            <>
              <SummaryRow label="Fee">{fee} hundredths of a bip</SummaryRow>
              <SummaryRow label="Tick spacing">{tickSpacing}</SummaryRow>
              <SummaryRow label="Initial price">
                <span className="break-all font-mono text-xs">{sqrtPriceX96}</span>
              </SummaryRow>
            </>
          ) : null}
          {kind === "pool" || kind === "twap" ? (
            <SummaryRow label="TWAP window">{twapWindow}s</SummaryRow>
          ) : null}
        </TxConfirmDialog>
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
