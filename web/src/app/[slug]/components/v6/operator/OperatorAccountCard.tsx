"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/TxError";
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useGroupWriteGate } from "@/lib/nana/groupWriteGate";
import { isSafeProposalPendingError, reviewClosed } from "@/lib/reviewed-call";
import { addStepsToBatch, stepFromWrite } from "@/lib/safe-batch";
import { formatWalletError } from "@/lib/utils";
import { JB_CHAINS, RevnetCoreContracts, revOwnerAbi } from "@bananapus/nana-sdk-core";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Address, isAddress, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { invalidateProjectRouteProofs } from "../../../projectRouteQuery";
import { authorityIdentityQuery } from "./authorityIdentityQuery";
import { ChainProjectRow, ChainWrite, chainName, v6ContractAddress } from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import { useLiveRevnetOperators } from "./useLiveRevnetOperators";
import { useOperatorWrites } from "./useOperatorWrites";

type AccountRow = ChainProjectRow & {
  operator: Address | null;
  accountType:
    "Wallet" | "Safe multisig" | "Contract" | "Unknown" | "Checking…" | "Could not verify";
  safe: { owners: readonly Address[]; threshold: number } | null;
};

type AccountGroup = {
  key: string;
  operator: Address | null;
  accountType: AccountRow["accountType"];
  safe: AccountRow["safe"];
  rows: AccountRow[];
};

function groupRows(rows: AccountRow[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const row of rows) {
    const safeKey = row.safe
      ? `${row.safe.threshold}/${[...row.safe.owners]
          .map((o) => o.toLowerCase())
          .sort()
          .join(",")}`
      : "";
    const key = `${row.operator?.toLowerCase() ?? "unknown"}:${row.accountType}:${safeKey}`;
    const group = groups.get(key) ?? {
      key,
      operator: row.operator,
      accountType: row.accountType,
      safe: row.safe,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * website/-parity renderAccountCard for revnets: the operator on every chain
 * (bendystraw's isRevnetOperator permission holder), its account type (EOA vs
 * Safe via an onchain bytecode + getOwners/getThreshold probe), and the
 * Transfer operator action — REVOwner.setOperatorOf per chain, which only the
 * current operator can call.
 */
export function OperatorAccountCard({
  rows,
  fallbackOperator,
  fallbackProject,
}: {
  rows: ChainProjectRow[];
  /** Server-resolved candidate for the page chain; always live-checked here. */
  fallbackOperator?: string;
  fallbackProject: ChainProjectRow;
}) {
  const operators = useLiveRevnetOperators(rows, {
    ...fallbackProject,
    address: fallbackOperator,
  });
  const operatorByChain = operators.discoveredOperatorByChain ?? operators.operatorByChain;
  const discovered = rows.flatMap((row) => {
    const operator = operatorByChain.get(row.chainId);
    return operator ? [{ ...row, operator }] : [];
  });
  const identities = useQueries({
    queries: discovered.map((row) => authorityIdentityQuery(row.chainId, row.operator)),
  });
  const accountRows: AccountRow[] = rows.map((row) => {
    const operator = operatorByChain.get(row.chainId) ?? null;
    const query = identities[discovered.findIndex((item) => item.chainId === row.chainId)];
    const identity = query?.isError ? undefined : query?.data;
    if (!identity) {
      return {
        ...row,
        operator,
        accountType:
          query?.isFetching || (!operator && operators.isLoading)
            ? "Checking…"
            : query?.isError
              ? "Could not verify"
              : "Unknown",
        safe: null,
      };
    }
    if (identity.kind === "safe") {
      return {
        ...row,
        operator,
        accountType: "Safe multisig",
        safe: {
          owners: identity.owners,
          threshold: identity.threshold,
        },
      };
    }
    return {
      ...row,
      operator,
      accountType:
        identity.kind === "eoa" || identity.kind === "delegated-eoa" ? "Wallet" : "Contract",
      safe: null,
    };
  });
  const groups = groupRows(accountRows);
  const refreshAccounts = () => Promise.all(identities.map((query) => query.refetch()));
  const known = accountRows.filter((row) => row.operator);
  const differs =
    known.length > 1 &&
    known.some((row) => row.operator!.toLowerCase() !== known[0].operator!.toLowerCase());

  return (
    <OperatorSection title="Account">
      <div>
        <p className="text-sm text-zinc-500">
          Revnets have no owner. The revnet operator holds only the permissions granted at launch,
          and can pass the role on.
        </p>
        <div className="mt-3 space-y-3">
          {differs ? (
            <div className="border border-amber-300 text-amber-800 text-xs p-3">
              The revnet operator differs by chain. The transfer action below is scoped to each
              matching group so a change cannot silently target the wrong account.
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className="border-t border-melon-200 pt-3">
              <div className="flex flex-wrap items-center gap-3">
                {group.rows.map((row) => (
                  <span
                    key={row.chainId}
                    className="inline-flex items-center gap-1.5 text-sm text-zinc-700"
                  >
                    <ChainLogo chainId={row.chainId} width={16} height={16} />
                    {chainName(row.chainId)}
                  </span>
                ))}
              </div>
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
                <dt className="text-zinc-500">Revnet operator</dt>
                <dd>
                  {group.operator ? (
                    <EthereumAddress
                      showSafe
                      address={group.operator}
                      short
                      withEnsName
                      chain={JB_CHAINS[group.rows[0].chainId]?.chain}
                    />
                  ) : (
                    <span className="text-zinc-500">Unknown</span>
                  )}
                </dd>
                <dt className="text-zinc-500">Type</dt>
                <dd>{group.accountType}</dd>
                {group.safe ? (
                  <>
                    <dt className="text-zinc-500">Policy</dt>
                    <dd>
                      Requires {group.safe.threshold} of {group.safe.owners.length} signatures
                    </dd>
                    <dt className="text-zinc-500">Signers</dt>
                    <dd className="flex flex-wrap gap-x-3 gap-y-1">
                      {group.safe.owners.map((owner) => (
                        <EthereumAddress
                          key={owner}
                          address={owner}
                          short
                          withEnsName
                          chain={JB_CHAINS[group.rows[0].chainId]?.chain}
                        />
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>
              {group.accountType === "Could not verify" || group.accountType === "Unknown" ? (
                <button
                  type="button"
                  className="mt-3 text-sm underline"
                  onClick={() => {
                    void operators.refetch();
                    for (const row of group.rows) {
                      const index = discovered.findIndex((item) => item.chainId === row.chainId);
                      if (index >= 0) void identities[index].refetch();
                    }
                  }}
                >
                  Retry account checks
                </button>
              ) : null}
              {group.operator &&
              group.accountType !== "Checking…" &&
              group.accountType !== "Could not verify" &&
              group.accountType !== "Unknown" ? (
                <TransferOperatorFlow
                  group={group}
                  onDone={() => {
                    operators.refetch();
                    void refreshAccounts();
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </OperatorSection>
  );
}

function TransferOperatorFlow({ group, onDone }: { group: AccountGroup; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { runWrites } = useOperatorWrites();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  // The rows come from the server sucker-group list: only chain-verified pairs are written.
  const gate = useGroupWriteGate(group.rows);
  const [review, setReview] = useState(false);
  // A send that went to the Safe as a proposal: nothing more to send from here.
  const [proposed, setProposed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCurrentOperator =
    !!address && !!group.operator && address.toLowerCase() === group.operator.toLowerCase();
  const relinquishing = destination.trim().toLowerCase() === zeroAddress;
  const chains = group.rows.map((row) => chainName(row.chainId)).join(", ");
  const context = [
    {
      label: "Operator becomes",
      value: relinquishing ? "No one (relinquished)" : destination.trim(),
      mono: !relinquishing,
      strong: true,
    },
    { label: "Replaces", value: group.operator ?? "Unknown", mono: !!group.operator },
    { label: "On", value: chains },
  ];

  const beginReview = () => {
    if (busy || !ack) return;
    if (!isAddress(destination.trim())) {
      setError("Enter a valid destination address.");
      return;
    }
    setError(null);
    setStatus(null);
    setProposed(false);
    setReview(true);
  };

  const buildWrites = (): ChainWrite[] => {
    const to = destination.trim();
    if (!isAddress(to)) throw new Error("Enter a valid destination address.");
    gate.assertVerified(group.rows);
    return group.rows.map((row) => {
      const target = v6ContractAddress(RevnetCoreContracts.REVOwner, row.chainId);
      if (!target) throw new Error(`REVOwner isn't deployed on ${chainName(row.chainId)}.`);
      return {
        chainId: row.chainId,
        address: target,
        abi: revOwnerAbi,
        functionName: "setOperatorOf",
        args: [BigInt(row.projectId), to as Address],
        contractName: "REVOwner",
        authority: (group.operator as Address | null) ?? undefined,
      };
    });
  };

  // The same calls the submit would send, queued in each chain's tray instead.
  const addToBatch = () => {
    if (busy) return;
    setError(null);
    try {
      const chainIds = addStepsToBatch(buildWrites().map(stepFromWrite));
      toast({
        title: "Added to the batch",
        description: `Added to the batch for ${chainIds.map(chainName).join(", ")}.`,
      });
      setOpen(false);
    } catch (e) {
      setError(formatWalletError(e) || "Could not add the transfer to the batch.");
    }
  };

  const submit = async () => {
    if (busy || !address) return;
    if (!isAddress(destination.trim())) {
      setError("Enter a valid destination address.");
      return;
    }
    if (!ack) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runWrites({
        writes: buildWrites(),
        account: address,
        label: "Transfer revnet operator",
        context,
        onProgress: setStatus,
      });
      if (result.safeQueued || result.safeConfirmed) {
        const queued = result.safeQueued + result.safeConfirmed;
        const message =
          `Transfer proposed to the operator Safe on ${queued} chain${queued === 1 ? "" : "s"}. ` +
          "Nothing changes until its signers confirm and execute it from the Safe queue card above or the Safe app.";
        setStatus(message);
        toast({ title: "Proposed to the operator Safe", description: message });
      } else {
        setStatus(
          `Revnet operator transferred on ${result.chains} chain${result.chains === 1 ? "" : "s"}.`,
        );
        toast({ title: "Revnet operator transferred" });
        setOpen(false);
      }
      await invalidateProjectRouteProofs(queryClient);
      setReview(false);
      onDone();
    } catch (e) {
      const message = formatWalletError(e) || "Could not transfer the revnet operator.";
      if (reviewClosed(e)) setReview(false);
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

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => {
          setOpen(true);
          setStatus(null);
          setError(null);
        }}
      >
        Transfer revnet operator
      </Button>
    );
  }

  return (
    <div className="mt-3 border-t border-melon-200 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Transfer revnet operator</p>
        <button
          type="button"
          className="text-xs text-zinc-500 hover:text-zinc-800"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      {!isCurrentOperator ? (
        <p className="text-xs text-amber-700 mt-2">
          Only the current revnet operator ({group.operator}) can transfer this role. Connect that
          account, or one of its signers if it is a Safe.
        </p>
      ) : null}
      <label className="mt-2 block text-xs text-zinc-600">
        New revnet operator
        <Input
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value);
            setError(null);
          }}
          disabled={busy}
          placeholder="0x…"
          aria-label="New revnet operator"
          className="mt-1"
        />
      </label>
      <p className="text-xs text-zinc-500 mt-1">
        Applies on {chains}. The zero address relinquishes the role.
      </p>
      {gate.line ? <p className="text-xs text-zinc-600 mt-1">{gate.line}</p> : null}
      <label className="mt-3 flex items-start gap-2 border border-red-300 p-3">
        <input
          type="checkbox"
          checked={ack}
          disabled={busy}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-xs text-red-700">
          {relinquishing
            ? "I understand that relinquishing the revnet operator role is permanent."
            : "I verified the new revnet operator. They receive every power attached to this role."}
        </span>
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-11"
          disabled={busy || gate.blocked || !destination.trim()}
          onClick={addToBatch}
        >
          Add to batch
        </Button>
        <ButtonWithWallet
          targetChainId={group.rows[0]?.chainId}
          connectWalletText="Connect wallet to transfer"
          loading={busy || gate.pending}
          disabled={busy || gate.blocked || !ack || !destination.trim()}
          onClick={beginReview}
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          Transfer revnet operator
        </ButtonWithWallet>
      </div>
      {status && !review ? <p className="text-xs text-zinc-500 mt-2">{status}</p> : null}
      {error && !review ? <ErrorNote message={error} /> : null}
      {review ? (
        <TxProgress
          open
          onClose={() => {
            setReview(false);
            setProposed(false);
          }}
          title="Confirm transfer"
          steps={[
            {
              title: "Transfer revnet operator",
              detail:
                group.rows.length > 1
                  ? "Use an operator wallet across supported mainnets or across supported testnets. With Safe or other networks, transfer and confirm one chain at a time."
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
