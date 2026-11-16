"use client";

import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import EtherscanLink from "@/components/EtherscanLink";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/skeleton";
import { ErrorNote } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/hooks/useHydrated";
import {
  isSafeProposalPendingError,
  requireDone,
  reviewClosed,
  reviewedCall,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import {
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { submittedViaSafe } from "@/lib/held-rows";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import {
  useJBContractContext,
  useJBProjectMetadataContext,
  useJBTokenContext,
} from "@/lib/nana/project";
import type { ChainPayment, JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { PERSIST } from "@/lib/query-persist";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { useSafeConnection } from "@/lib/safe-connector";
import { preselectedRelayrPayment, relayrPaymentOptions } from "@/lib/transaction-review";
import { formatEthAddress, formatHexEther, formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import {
  JB_CHAINS,
  jbControllerAbi,
  JBCoreContracts,
  jbDirectoryAbi,
  jbProjectsAbi,
} from "@bananapus/nana-sdk-core";
import { gasWithHeadroom, intent, writeIntentKey } from "@bananapus/nana-sdk-core/review";
import { getTokenAddress, hasPermissions, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  PublicClient,
  zeroAddress,
} from "viem";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ProjectItem } from "../shared";

type TokenChainState = {
  chainId: JBChainId;
  projectId: bigint;
  controller: Address;
  owner: Address;
  token: Address | null;
  name: string | null;
  symbol: string | null;
};

const stateKey = (projects: ProjectItem[]) =>
  projects
    .map((project) => `${project.chainId}:${project.projectId}`)
    .sort()
    .join("|");

function clientFor(chainId: JBChainId) {
  const client = getPublicClient(wagmiConfig, { chainId }) as PublicClient | undefined;
  if (!client) throw new Error(`No public client is configured for chain ${chainId}.`);
  return client;
}

// Each field draws its pip in the gap to its left. The row is shifted left by one gap and
// clipped horizontally, so the pip of whichever field starts a line falls outside the clip.
function TokenField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative ml-8 inline-flex items-center gap-1.5 whitespace-nowrap before:absolute before:-left-5 before:text-melon-200 before:content-['|']">
      <span className="text-melon-700">{label}:</span>
      <span className="text-black">{children}</span>
    </span>
  );
}

/** Token identity and omnichain edit/deploy controls, ahead of the Owners subtabs. */
export function V6TokenPanel({ projects }: { projects: ProjectItem[] }) {
  // The persisted query can restore before this streamed panel hydrates.
  // Keep its first client snapshot identical to the server's loading state.
  const hydrated = useHydrated();
  const { contractAddress } = useJBContractContext();
  const { metadata } = useJBProjectMetadataContext();
  const { token: contextToken } = useJBTokenContext();
  const { address } = useViewedAccount();
  const key = useMemo(() => stateKey(projects), [projects]);

  const tokenState = useQuery({
    queryKey: ["v6-token-panel", key],
    meta: PERSIST,
    enabled: projects.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<TokenChainState[]> =>
      Promise.all(
        projects.map(async (project) => {
          const chainId = project.chainId as JBChainId;
          const projectId = BigInt(project.projectId);
          const client = clientFor(chainId);
          const [controller, owner, token] = await Promise.all([
            client.readContract({
              address: contractAddress(JBCoreContracts.JBDirectory, chainId),
              abi: jbDirectoryAbi,
              functionName: "controllerOf",
              args: [projectId],
            }),
            client.readContract({
              address: contractAddress(JBCoreContracts.JBProjects, chainId),
              abi: jbProjectsAbi,
              functionName: "ownerOf",
              args: [projectId],
            }),
            getTokenAddress(client, { chainId, projectId }),
          ]);

          if (!controller || controller === zeroAddress) {
            throw new Error(`No controller is configured on ${chainDisplayName(chainId)}.`);
          }

          let name: string | null = null;
          let symbol: string | null = null;
          if (token) {
            [name, symbol] = await Promise.all([
              client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
              client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
            ]);
          }

          return { chainId, projectId, controller, owner, token, name, symbol };
        }),
      ),
  });

  const states = tokenState.data ?? [];
  const primary = states.find((state) => state.token) ?? states[0];
  const isDeployed = states.some((state) => !!state.token);

  const permission = useQuery({
    queryKey: ["v6-token-panel-permission", key, address, isDeployed],
    enabled: !!address && states.length === projects.length && states.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      if (!address) return false;
      const allowed = await Promise.all(
        states.map(async (state) => {
          if (state.owner.toLowerCase() === address.toLowerCase()) return true;
          return hasPermissions(clientFor(state.chainId), {
            chainId: state.chainId,
            operator: address,
            account: state.owner,
            projectId: state.projectId,
            permissionIds: [
              state.token ? JBPermissionIdsV6.SET_TOKEN_METADATA : JBPermissionIdsV6.DEPLOY_ERC20,
            ],
          }).catch(() => false);
        }),
      );
      return allowed.every(Boolean);
    },
  });

  const fallbackName = contextToken.data?.name ?? metadata?.data?.name ?? "";
  const fallbackSymbol = contextToken.data?.symbol ?? "";

  return (
    <section className="mb-8 border border-melon-200 p-4 max-sm:-mx-4 max-sm:border-x-0">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-melon-700">Token</h2>

      {!hydrated || tokenState.isLoading ? (
        <SkeletonLines lines={2} />
      ) : tokenState.isError ? (
        <p className="text-sm text-red-600">Couldn&apos;t read this project&apos;s token.</p>
      ) : isDeployed && primary?.token ? (
        <div className="overflow-x-clip">
          <div
            className={`-ml-8 flex flex-wrap items-center gap-y-2 text-sm${
              tokenState.isFetching ? " revalidating" : ""
            }`}
            aria-busy={tokenState.isFetching || undefined}
          >
            <TokenField label="Name">{primary.name ?? primary.symbol ?? "Token"}</TokenField>
            <TokenField label="Symbol">{primary.symbol ?? "—"}</TokenField>
            <TokenField label="Type">ERC-20</TokenField>
            <TokenField label="Address">
              <EtherscanLink
                value={primary.token}
                chain={JB_CHAINS[primary.chainId].chain}
                className="font-medium"
              >
                {formatEthAddress(primary.token)}
              </EtherscanLink>
            </TokenField>
            <TokenField label="On">
              <span className="inline-flex items-center -space-x-0.5">
                {states
                  .filter((state) => state.token)
                  .map((state) => (
                    <EtherscanLink
                      key={state.chainId}
                      value={state.token!}
                      chain={JB_CHAINS[state.chainId].chain}
                      className="inline-flex rounded-full"
                    >
                      <ChainLogo chainId={state.chainId} width={18} height={18} standalone />
                    </EtherscanLink>
                  ))}
              </span>
            </TokenField>
          </div>
        </div>
      ) : (
        <div className="max-w-3xl">
          <p className="font-medium text-black">No ERC-20 yet</p>
          <p className="mt-1 text-sm text-melon-700">
            Juicebox records your token balance, and you can still cash it out. Creating an ERC-20
            lets owners claim tokens for use in wallets and markets.
          </p>
        </div>
      )}

      {hydrated && !tokenState.isLoading && !tokenState.isError && states.length > 0 ? (
        <div className="mt-4">
          <TokenEditDialog
            states={states}
            deployed={isDeployed}
            initialName={primary?.name ?? fallbackName}
            initialSymbol={primary?.symbol ?? fallbackSymbol}
            canManage={permission.data === true}
            permissionLoading={permission.isLoading}
            onSuccess={() => tokenState.refetch()}
          />
        </div>
      ) : null}
    </section>
  );
}

function TokenEditDialog({
  states,
  deployed,
  initialName,
  initialSymbol,
  canManage,
  permissionLoading,
  onSuccess,
}: {
  states: TokenChainState[];
  deployed: boolean;
  initialName: string;
  initialSymbol: string;
  canManage: boolean;
  permissionLoading: boolean;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [busy, setBusy] = useState(false);
  const [directWriteIndex, setDirectWriteIndex] = useState(-1);
  const [quote, setQuote] = useState<RelayrPostBundleResponse | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<ChainPayment | null>(null);
  const [confirming, setConfirming] = useState<"submit" | "pay" | null>(null);
  // A write that went to the Safe as a proposal: nothing more to send from here.
  const [proposed, setProposed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The chains come from the server sucker-group list: write only to pairs the registry lists.
  const gate = useGroupWriteGate(states);
  const { address, chainId: connectedChainId } = useAccount();
  const { run } = useReviewedAction();
  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const { toast } = useToast();
  const { projectId: homeProjectId } = useJBContractContext();
  const viaSafe = useSafeConnection(wagmiConfig);
  const relayed =
    states.length > 1 &&
    !viaSafe &&
    areRelayrChainsCompatible(states.map((state) => state.chainId));
  // A partial deployment cannot safely replay if a later direct transaction fails.
  const deploymentRouteError =
    !relayed && states.length > 1 && states.some((state) => !state.token)
      ? "Choose one chain at a time to deploy an ERC-20 with this connection. Multi-chain deployment requires supported networks that are all mainnets or all testnets and a wallet that can sign authorizations."
      : null;

  const resetQuote = () => {
    setQuote(null);
    setSelectedPayment(null);
    resetRelayr();
  };

  // The delayed catch-up refetch must not fire after unmount.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const finish = (description: string) => {
    toast({ title: deployed ? "Token updated" : "Token deployment submitted", description });
    setOpen(false);
    resetQuote();
    // Refresh after execution, then once more for indexers to catch up.
    onSuccess();
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(onSuccess, deployed ? 2_000 : 10_000);
  };

  const callFor = (state: TokenChainState, nextName: string, nextSymbol: string) => {
    if (state.token) {
      const args = [state.projectId, nextName, nextSymbol] as const;
      return {
        functionName: "setTokenMetadataOf" as const,
        args,
        data: encodeFunctionData({
          abi: jbControllerAbi,
          functionName: "setTokenMetadataOf",
          args,
        }),
      };
    }
    const salt = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "string" }],
        [BigInt(homeProjectId), nextSymbol],
      ),
    );
    const args = [state.projectId, nextName, nextSymbol, salt] as const;
    return {
      functionName: "deployERC20For" as const,
      args,
      data: encodeFunctionData({ abi: jbControllerAbi, functionName: "deployERC20For", args }),
    };
  };

  const submit = async () => {
    const nextName = name.trim();
    const nextSymbol = symbol.trim();
    if (!nextName || !nextSymbol) {
      setError("Enter a token name and symbol.");
      return false;
    }
    if (nextSymbol.length > 11) {
      setError("The symbol can be at most 11 characters.");
      return false;
    }
    if (!address || !canManage) return false;
    if (deploymentRouteError) {
      setError(deploymentRouteError);
      return false;
    }
    try {
      gate.assertVerified(states);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      if (!relayed) {
        // One review for every chain, sent in order; a later chain resumes without resending.
        const result = await run({
          account: address,
          context: tokenContext,
          beforeWallet: (_call, index) => setDirectWriteIndex(index),
          ...(states.length > 1
            ? {
                title: deployed ? "Update token metadata" : "Deploy project ERC-20",
                scope: writeIntentKey("token-panel", {
                  account: intent.address(address),
                  calls: states.map((state) => [
                    state.chainId,
                    intent.address(state.controller),
                    callFor(state, nextName, nextSymbol).data,
                  ]),
                }),
              }
            : {}),
          calls: states.map((state) =>
            reviewedCall({
              chainId: state.chainId,
              address: state.controller,
              abi: jbControllerAbi,
              functionName: callFor(state, nextName, nextSymbol).functionName,
              args: callFor(state, nextName, nextSymbol).args,
            }),
          ),
        });
        // One chain's Safe proposal is the whole action; a batch's waits for its Safe.
        if (states.length === 1 && result?.status === "proposed") {
          toast({
            title: "Safe proposal submitted",
            description: `The ${deployed ? "token update" : "token deployment"} is awaiting Safe approvals and execution.`,
          });
          return true;
        }
        requireDone(result);
        finish(deployed ? "The name and symbol are now updated." : "The ERC-20 is now deployed.");
        return true;
      }

      const transactions = await Promise.all(
        states.map(async (state) => {
          const call = callFor(state, nextName, nextSymbol);
          const client = clientFor(state.chainId);
          const gas = state.token
            ? await client.estimateContractGas({
                account: address,
                address: state.controller,
                abi: jbControllerAbi,
                functionName: "setTokenMetadataOf",
                args: call.args as readonly [bigint, string, string],
              })
            : await client.estimateContractGas({
                account: address,
                address: state.controller,
                abi: jbControllerAbi,
                functionName: "deployERC20For",
                args: call.args as readonly [bigint, string, string, `0x${string}`],
              });
          return {
            chainId: state.chainId,
            data: {
              from: address,
              to: state.controller,
              value: 0n,
              gas: gasWithHeadroom(gas),
              data: call.data,
            },
            version: 6 as const,
            review: {
              abi: jbControllerAbi,
              functionName: call.functionName,
              args: call.args,
              label: deployed ? "Update token metadata" : "Deploy project ERC-20",
              contractName: "JBController",
            },
          };
        }),
      );
      const relayrQuote = await getRelayrTxQuote(transactions);
      if (!relayrQuote) throw new Error("No payment options are available.");
      setQuote(relayrQuote);
      // Signing may switch the wallet; prefer the chain captured before this submission.
      setSelectedPayment(preselectedRelayrPayment(relayrQuote.payment_info, connectedChainId));
      return true;
    } catch (cause) {
      if (reviewClosed(cause)) {
        setConfirming(null);
        return false;
      }
      if (isSafeProposalPendingError(cause)) {
        setProposed(formatWalletError(cause));
        return false;
      }
      setError(formatWalletError(cause));
      return false;
    } finally {
      setBusy(false);
      setDirectWriteIndex(-1);
    }
  };

  const payAndSubmit = async () => {
    if (!quote || !selectedPayment || !sendRelayrTx) return false;
    setBusy(true);
    setError(null);
    try {
      gate.assertVerified(states);
      const hash = await sendRelayrTx(selectedPayment);
      if (submittedViaSafe(hash)) {
        toast({
          title: "Safe payment proposal submitted",
          description:
            "The bundle is not paid yet. Complete the payment proposal in Safe; do not submit another payment.",
        });
        return true;
      }
      await waitForRelayrBundle(quote.bundle_uuid);
      finish(`Confirmed the ${deployed ? "update" : "deployment"} on ${states.length} chains.`);
      return true;
    } catch (cause) {
      setError(formatWalletError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Compatible network bundles prepare their authorization before payment review.
  // Direct writes wait for confirmation before submitting the chain sequence.
  const start = async () => {
    setError(deploymentRouteError);
    if (deploymentRouteError) return;
    if (quote) {
      setConfirming("pay");
      return;
    }
    setConfirming("submit");
    if (!relayed) return;
    setConfirming((await submit()) ? "pay" : null);
  };

  const confirm = async () => {
    const ok = confirming === "pay" ? await payAndSubmit() : await submit();
    if (ok) setConfirming(null);
  };

  const permissionName = deployed ? "SET_TOKEN_METADATA" : "DEPLOY_ERC20";
  const chainNames = states.map((state) => chainDisplayName(state.chainId)).join(", ");
  const formAction = deployed ? "Save token" : "Deploy token";
  const tokenContext = [
    { label: "Name", value: name.trim(), strong: true },
    { label: "Symbol", value: symbol.trim() },
    { label: "On", value: chainNames },
    {
      label: "Address",
      value: deployed ? "Unchanged" : "Same address on every chain",
    },
    ...(confirming === "pay" && selectedPayment
      ? [
          {
            label: "Relay fee",
            value: `${formatHexEther(selectedPayment.amount)} ETH on ${chainDisplayName(selectedPayment.chain)}`,
          },
        ]
      : []),
  ];
  const confirmSteps = relayed
    ? [
        {
          title: "Sign the authorizations",
          detail: `Sign one authorization for each of the ${states.length} chains.`,
        },
        {
          title: selectedPayment
            ? `Pay ${formatHexEther(selectedPayment.amount)} ETH to relay`
            : "Pay the relay fee",
          detail: "The transaction is then submitted on each chain.",
        },
      ]
    : states.map((state) => ({
        title: state.token ? "Update the name and symbol" : "Deploy the ERC-20",
        detail: chainDisplayName(state.chainId),
      }));

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setName(initialName);
          setSymbol(initialSymbol);
        }
        resetQuote();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-melon-700 underline decoration-melon-300 underline-offset-4 transition-colors hover:text-black"
        >
          {deployed ? "Edit" : "Deploy ERC-20"}
        </button>
      </DialogTrigger>
      {confirming ? (
        <TxProgress
          open
          onClose={() => {
            setConfirming(null);
            setProposed(null);
          }}
          title={deployed ? "Confirm token update" : "Confirm token deployment"}
          preparing={relayed && confirming === "submit"}
          steps={confirmSteps}
          activeIndex={confirming === "pay" ? 1 : relayed && busy ? 0 : directWriteIndex}
          start={confirming === "submit" && !relayed ? () => void confirm() : undefined}
          busy={busy}
          complete={proposed !== null}
          status={
            proposed ??
            (relayed && confirming === "submit"
              ? "Getting a relay quote… Your wallet will ask for a signature."
              : null)
          }
          error={error}
          rows={tokenContext}
          footerContent={
            quote ? (
              <>
                <RelayrPaymentSelect
                  options={relayrPaymentOptions(quote.payment_info)}
                  value={selectedPayment?.chain ?? null}
                  onValueChange={(chainId) =>
                    setSelectedPayment(
                      quote.payment_info.find((payment) => payment.chain === chainId) ?? null,
                    )
                  }
                  disabled={busy}
                />
                <Button
                  className="mt-3 w-full"
                  disabled={busy || confirming !== "pay" || !selectedPayment}
                  onClick={() => void confirm()}
                >
                  Pay and submit
                </Button>
              </>
            ) : undefined
          }
        />
      ) : null}
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {deployed ? "Edit token name & symbol" : "Set token name & symbol"}
          </DialogTitle>
          <DialogDescription>
            {deployed
              ? `Renames the ERC-20 on ${states.length} chain${states.length === 1 ? "" : "s"}: ${chainNames}. The contract address stays the same.`
              : `Deploys one ERC-20 at the same address on ${states.length} chain${states.length === 1 ? "" : "s"}: ${chainNames}.`}
          </DialogDescription>
        </DialogHeader>

        <div
          className={`border px-3 py-2 text-sm ${
            canManage ? "border-melon-200 text-melon-700" : "border-zinc-200 text-zinc-600"
          }`}
        >
          {!address
            ? `Connect the project authority or an operator with ${permissionName} permission.`
            : permissionLoading
              ? "Checking authority across every project chain…"
              : canManage
                ? `Connected wallet is authorized to ${deployed ? "edit this token" : "deploy this ERC-20"}.`
                : `This wallet needs ${permissionName} permission on every project chain.`}
        </div>

        <div className="space-y-4 py-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-black">Token name</span>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                resetQuote();
              }}
              placeholder="e.g. My Project Token"
              disabled={busy}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-black">Symbol</span>
            <Input
              value={symbol}
              maxLength={11}
              onChange={(event) => {
                setSymbol(event.target.value);
                resetQuote();
              }}
              placeholder="e.g. TOKEN"
              disabled={busy}
            />
          </label>
        </div>

        {error && !confirming ? <ErrorNote message={error} /> : null}

        {gate.line ? <p className="text-xs text-zinc-600">{gate.line}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <ButtonWithWallet
            targetChainId={
              relayed || deploymentRouteError ? (connectedChainId as JBChainId) : states[0].chainId
            }
            onClick={() => void start()}
            loading={busy || gate.pending}
            disabled={!address || !canManage || busy || gate.blocked}
            connectWalletText="Connect Wallet"
            className="bg-teal-500 text-melon-950 hover:bg-teal-600"
          >
            {formAction}
          </ButtonWithWallet>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
