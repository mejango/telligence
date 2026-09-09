"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/skeleton";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { isSafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { readAuthorityIdentity } from "@/lib/cross-chain-authority";
import { formatWalletError } from "@/lib/utils";
import { JB_CHAINS, RevnetCoreContracts, revOwnerAbi } from "@bananapus/nana-sdk-core";
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

type AccountRow = ChainProjectRow & {
  operator: Address | null;
  accountType: "EOA" | "Safe multisig" | "Contract" | "Unknown";
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
  const { operatorByChain } = operators;

  const operatorKey = rows
    .map((row) => `${row.chainId}:${operatorByChain.get(row.chainId) ?? ""}`)
    .join(",");

  const accountQuery = useQuery({
    queryKey: ["v6-operator-account-types", operatorKey],
    enabled: !operators.isLoading,
    staleTime: 30_000,
    queryFn: async (): Promise<AccountRow[]> =>
      Promise.all(
        rows.map(async (row): Promise<AccountRow> => {
          const operator = operatorByChain.get(row.chainId) ?? null;
          if (!operator) return { ...row, operator, accountType: "Unknown", safe: null };
          try {
            const client = publicClientFor(row.chainId);
            // The shared identity probe uses raw, gas-capped, return-bounded
            // calls for every proxy policy read. Never decode getOwners from an
            // arbitrary live operator contract in this display surface.
            const identity = await readAuthorityIdentity(client, operator);
            if (!identity) {
              return { ...row, operator, accountType: "Unknown", safe: null };
            }
            if (identity.kind === "eoa") {
              return { ...row, operator, accountType: "EOA", safe: null };
            }
            if (identity.kind === "safe") {
              return {
                ...row,
                operator,
                accountType: "Safe multisig",
                safe: { owners: identity.owners, threshold: identity.threshold },
              };
            }
            return { ...row, operator, accountType: "Contract", safe: null };
          } catch {
            return { ...row, operator, accountType: "Unknown", safe: null };
          }
        }),
      ),
  });

  const accountRows = useMemo(() => accountQuery.data ?? [], [accountQuery.data]);
  const groups = useMemo(() => groupRows(accountRows), [accountRows]);
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
        {operators.isLoading || accountQuery.isLoading ? (
          <SkeletonLines lines={4} className="mt-3" />
        ) : (
          <div className="mt-3 space-y-3">
            {differs ? (
              <div className="border border-amber-300 bg-amber-50 text-amber-800 text-xs p-3 rounded">
                The revnet operator differs by chain. The transfer action below is scoped to each
                matching group so a change cannot silently target the wrong account.
              </div>
            ) : null}
            {groups.map((group) => (
              <div key={group.key} className="bg-melon-50 p-4">
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
                {group.operator ? (
                  <TransferOperatorFlow
                    group={group}
                    onDone={() => {
                      operators.refetch();
                      accountQuery.refetch();
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </OperatorSection>
  );
}

function TransferOperatorFlow({ group, onDone }: { group: AccountGroup; onDone: () => void }) {
  const { address } = useAccount();
  const { runWrites } = useOperatorWrites();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCurrentOperator =
    !!address && !!group.operator && address.toLowerCase() === group.operator.toLowerCase();
  const relinquishing = destination.trim().toLowerCase() === zeroAddress;
  const chains = group.rows.map((row) => chainName(row.chainId)).join(", ");

  const beginReview = () => {
    if (busy || !ack) return;
    if (!isAddress(destination.trim())) {
      setError("Enter a valid destination address.");
      return;
    }
    setError(null);
    setStatus(null);
    setReview(true);
  };

  const submit = async () => {
    if (busy || !address) return;
    const to = destination.trim();
    if (!isAddress(to)) {
      setError("Enter a valid destination address.");
      return;
    }
    if (!ack) return;
    setBusy(true);
    setError(null);
    try {
      const writes: ChainWrite[] = group.rows.map((row) => {
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
      const result = await runWrites({
        writes,
        account: address,
        label: "Transfer revnet operator",
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
      setReview(false);
      onDone();
    } catch (e) {
      const message = formatWalletError(e) || "Could not transfer the revnet operator.";
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
    <div className="mt-3 bg-melon-100 p-3">
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
          Only the current revnet operator ({group.operator}) can transfer this role — connect that
          account, or one of its signers if it is a Safe, and the change is proposed to the Safe.
          The transaction is simulated first and will not send otherwise.
        </p>
      ) : null}
      <div className="mt-2">
        <Input
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value);
            setError(null);
          }}
          disabled={busy}
          placeholder="0x… new revnet operator (zero address relinquishes)"
          aria-label="New revnet operator"
        />
      </div>
      <p className="text-xs text-zinc-500 mt-1">Applies on {chains}.</p>
      <label className="mt-3 flex items-start gap-2 border border-red-300 bg-red-50 rounded p-3">
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
      <div className="mt-3 flex justify-end">
        <ButtonWithWallet
          targetChainId={group.rows[0]?.chainId}
          connectWalletText="Connect wallet to transfer"
          loading={busy}
          disabled={busy || !ack || !destination.trim()}
          onClick={beginReview}
          className="bg-teal-500 text-melon-950 hover:bg-teal-600"
        >
          Transfer revnet operator
        </ButtonWithWallet>
      </div>
      {status && !review ? <p className="text-xs text-zinc-500 mt-2">{status}</p> : null}
      {error && !review ? <p className="text-xs text-red-600 mt-2">{error}</p> : null}
      {review ? (
        <TxConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setReview(false);
          }}
          title="Confirm transfer"
          chainId={group.rows[0].chainId}
          steps={[
            {
              title: "Transfer revnet operator",
              detail:
                group.rows.length > 1
                  ? "Use an operator wallet with Relayr across supported mainnets or across supported testnets. With Safe or other networks, transfer and confirm one chain at a time."
                  : "From the operator wallet, or proposed to the operator Safe from a signer.",
            },
          ]}
          activeIndex={busy ? 0 : -1}
          action="Transfer revnet operator"
          onConfirm={() => void submit()}
          busy={busy}
          status={status}
          error={error}
        >
          <SummaryRow label="Operator becomes">
            {relinquishing ? (
              "No one (relinquished)"
            ) : (
              <span className="break-all font-mono text-xs">{destination.trim()}</span>
            )}
          </SummaryRow>
          <SummaryRow label="Replaces">
            <span className="break-all font-mono text-xs">{group.operator}</span>
          </SummaryRow>
          <SummaryRow label="On">{chains}</SummaryRow>
        </TxConfirmDialog>
      ) : null}
    </div>
  );
}
