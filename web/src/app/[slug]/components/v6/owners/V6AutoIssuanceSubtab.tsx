"use client";

import { chainDisplayName, chainSortIndex } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import EtherscanLink from "@/components/EtherscanLink";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { TokenAmount } from "@/components/TokenAmount";
import { Check } from "@/components/ui/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAllRulesetsByChain } from "@/hooks/useAllRulesetsByChain";
import {
  useCompleteAutoIssueEvents,
  useCompleteStoredAutoIssuances,
} from "@/hooks/useCompleteBendystrawLists";
import { matchesProjectRef, projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import { formatShortDateTime } from "@/lib/date";
import { useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import type { JBChainId } from "@/lib/nana/types";
import { formatTokenSymbol } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JB_CHAINS, JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import {
  autoIssuanceKey,
  prepareAutoIssuance,
} from "../../../owners/components/ownerDistributionBatch";
import { OwnerDistributionBatchButton } from "../../../owners/components/OwnerDistributionBatchButton";
import { ProjectItem } from "../shared";

/**
 * Auto issuance across every chain in the group: Chain | Stage | Account |
 * Amount | Unlock date | Distribute. Stage numbers and unlock dates come from
 * each CHAIN'S OWN ruleset ids (they differ per chain even when the stages are
 * economically aligned).
 */
export function V6AutoIssuanceSubtab({ projects }: { projects: ProjectItem[] }) {
  const { token } = useJBTokenContext();
  const { address } = useAccount();
  const { contractAddress } = useJBContractContext();
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const tokenSymbol = formatTokenSymbol(token);
  const now = Math.floor(Date.now() / 1000);

  const chains = projects
    .filter((p) => Boolean(JB_CHAINS[p.chainId as JBChainId]))
    .map((p) => ({ chainId: p.chainId as JBChainId, projectId: p.projectId }));

  // One project can have different ids per chain. Every OR branch must contain
  // an explicit AND group in Bendystraw's Ponder filter dialect.
  const projectRefs = chains.map((chain) => ({ ...chain, version: 6 }));
  const where = projectRefsWhere(projectRefs) ?? { OR: [] };
  const stored = useCompleteStoredAutoIssuances(where, chains.length > 0);
  const issued = useCompleteAutoIssueEvents(where, chains.length > 0);

  // Each chain's ruleset list, chronological, for stage numbers + unlock dates.
  const rulesetReads = useAllRulesetsByChain(chains);
  const rulesetsByChain = new Map<number, { id: number; start: number }[]>();
  chains.forEach((c) => {
    const result = rulesetReads.data?.[Number(c.chainId)];
    if (result) {
      rulesetsByChain.set(Number(c.chainId), result as unknown as { id: number; start: number }[]);
    }
  });

  const issuedRows = (issued.data ?? []).filter((row) => matchesProjectRef(row, projectRefs));
  // Repeated stored events for the same stage/beneficiary accumulate in the
  // contract. They form one allocation; distinct beneficiaries on one chain
  // remain separate selected calls and are carried into later execution rounds.
  const allocations = new Map<string, NonNullable<typeof stored.data>[number]>();
  for (const row of (stored.data ?? []).filter((entry) => matchesProjectRef(entry, projectRefs))) {
    const key = autoIssuanceKey({
      chainId: row.chainId as JBChainId,
      projectId: BigInt(row.projectId),
      stageId: BigInt(row.stageId),
      beneficiary: row.beneficiary as `0x${string}`,
    });
    const previous = allocations.get(key);
    allocations.set(key, {
      ...row,
      id: key,
      count: String(BigInt(previous?.count ?? "0") + BigInt(row.count)),
    });
  }
  const rows = [...allocations.values()]
    .map((row) => {
      const rulesets = rulesetsByChain.get(row.chainId) ?? [];
      const stageIdx = rulesets.findIndex((r) => String(r.id) === row.stageId);
      const distributed = issuedRows.find(
        (event) =>
          event.chainId === row.chainId &&
          event.projectId === row.projectId &&
          event.stageId === row.stageId &&
          event.beneficiary.toLowerCase() === row.beneficiary.toLowerCase() &&
          event.count === row.count,
      );
      return {
        ...row,
        stage: stageIdx >= 0 ? stageIdx + 1 : undefined,
        startsAt: stageIdx >= 0 ? Number(rulesets[stageIdx].start) : undefined,
        distributedTxn: distributed?.txHash,
      };
    })
    .sort(
      (a, b) =>
        (a.stage ?? 99) - (b.stage ?? 99) || chainSortIndex(a.chainId) - chainSortIndex(b.chainId),
    );

  const loading = stored.isLoading || issued.isLoading || rulesetReads.isLoading;
  const unavailable = stored.isError || issued.isError || rulesetReads.isError;
  const selectable = rows.filter(
    (row) => !row.distributedTxn && row.startsAt !== undefined && row.startsAt <= now,
  );
  const selected =
    loading || unavailable ? [] : selectable.filter((row) => selection[row.id] ?? true);
  const scope = `auto-issuance:${chains
    .map((project) => `${project.chainId}:${project.projectId}`)
    .sort()
    .join("|")}`;

  return (
    <div>
      <p className="text-md text-black font-light italic mb-2">
        These accounts can receive a fixed number of new tokens without paying. Anyone can send the
        tokens to them once the stage begins.
      </p>
      <div className="mb-4">
        <OwnerDistributionBatchButton
          label="Distribute selected auto issuances"
          scope={scope}
          tokenSymbol={tokenSymbol}
          disabled={selected.length === 0}
          group={chains}
          targets={selected.map((row) => ({
            chainId: row.chainId,
            projectId: BigInt(row.projectId),
          }))}
          onSuccess={() => {
            void issued.refetch();
            void stored.refetch();
          }}
          prepare={async () => {
            if (!address) throw new Error("Connect your wallet to continue.");
            return Promise.all(
              selected.map(async (row) => {
                const chainId = row.chainId as JBChainId;
                const client = getPublicClient(wagmiConfig, { chainId });
                if (!client) throw new Error(`No public client for chain ${chainId}.`);
                return prepareAutoIssuance(
                  client,
                  {
                    chainId,
                    projectId: BigInt(row.projectId),
                    stageId: BigInt(row.stageId),
                    beneficiary: row.beneficiary as `0x${string}`,
                    directory: contractAddress(JBCoreContracts.JBDirectory, chainId),
                    projects: contractAddress(JBCoreContracts.JBProjects, chainId),
                  },
                  address,
                );
              }),
            );
          }}
        />
      </div>
      {loading ? (
        <TableSkeleton rows={4} columns={6} />
      ) : unavailable ? (
        <p className="text-center text-red-600">Auto issuance data is unavailable.</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-zinc-400">No auto issuances</p>
      ) : null}
      <div className="mb-4">
        <div className="flex flex-col">
          <Table className="min-w-max max-sm:block max-sm:min-w-0">
            <TableHeader className="max-sm:hidden">
              <TableRow>
                <TableHead className="whitespace-nowrap">Chain</TableHead>
                <TableHead className="whitespace-nowrap">Stage</TableHead>
                <TableHead className="whitespace-nowrap">Account</TableHead>
                <TableHead className="whitespace-nowrap">Amount</TableHead>
                <TableHead className="whitespace-nowrap">Unlock date</TableHead>
                <TableHead className="whitespace-nowrap">Distribute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-sm:block">
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:py-2"
                >
                  <TableCell className="whitespace-nowrap max-sm:block max-sm:min-w-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal">
                    <span className="block text-xs text-zinc-500 sm:hidden">Chain</span>
                    <ChainLogo chainId={row.chainId as JBChainId} standalone />
                  </TableCell>
                  <TableCell className="whitespace-nowrap max-sm:block max-sm:min-w-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal">
                    <span className="block text-xs text-zinc-500 sm:hidden">Stage</span>
                    {row.stage ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap max-sm:block max-sm:min-w-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal">
                    <span className="block text-xs text-zinc-500 sm:hidden">Account</span>
                    <EthereumAddress
                      address={row.beneficiary as `0x${string}`}
                      chain={JB_CHAINS[row.chainId as JBChainId]?.chain}
                      short
                      withEnsAvatar
                      withEnsName
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums max-sm:block max-sm:min-w-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal">
                    <span className="block text-xs text-zinc-500 sm:hidden">Amount</span>
                    <TokenAmount value={BigInt(row.count)} decimals={18} symbol={tokenSymbol} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap max-sm:block max-sm:min-w-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal">
                    <span className="block text-xs text-zinc-500 sm:hidden">Unlock date</span>
                    {row.startsAt ? formatShortDateTime(row.startsAt * 1000) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap max-sm:block max-sm:min-w-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal">
                    <span className="block text-xs text-zinc-500 sm:hidden">Distribute</span>
                    {row.distributedTxn ? (
                      <div className="flex items-center gap-1 text-zinc-400">
                        <EtherscanLink
                          value={row.distributedTxn}
                          type="tx"
                          chain={JB_CHAINS[row.chainId as JBChainId]?.chain}
                          truncateTo={4}
                        />
                        <Check className="w-4 h-4 text-teal-500" />
                      </div>
                    ) : (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Distribute on ${chainDisplayName(row.chainId)}, project ${row.projectId}, stage ${row.stageId}, to ${row.beneficiary}`}
                          disabled={row.startsAt === undefined || row.startsAt > now}
                          checked={
                            row.startsAt !== undefined &&
                            row.startsAt <= now &&
                            (selection[row.id] ?? true)
                          }
                          onChange={(event) =>
                            setSelection((previous) => ({
                              ...previous,
                              [row.id]: event.target.checked,
                            }))
                          }
                        />
                        {row.startsAt === undefined
                          ? "Stage unavailable"
                          : row.startsAt > now
                            ? "Locked"
                            : "Select"}
                      </label>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
