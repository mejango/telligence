"use client";

import { ChainLogo } from "@/components/ChainLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useJBContractContext } from "@/lib/nana/project";
import { wagmiConfig } from "@/lib/wagmiConfig";
import {
  formatUnits,
  JB_CHAINS,
  JB_TOKEN_DECIMALS,
  JBCoreContracts,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { OwnerDistributionBatchButton } from "../../../../owners/components/OwnerDistributionBatchButton";
import {
  distributionProjectKey,
  prepareCreditClaim,
} from "../../../../owners/components/ownerDistributionBatch";

export interface CreditRow {
  chainId: JBChainId;
  projectId: bigint;
  credit: bigint;
}

/** Each selected holder/project balance is freshly read and frozen before review. */
export function V6ClaimCreditsDialog({
  creditRows,
  tokenSymbol,
  batchScope,
  children,
}: PropsWithChildren<{ creditRows: CreditRow[]; tokenSymbol: string; batchScope: string }>) {
  const { address } = useAccount();
  const { contractAddress } = useJBContractContext();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const selected = creditRows.filter(
    (row) => row.credit > 0n && (selection[distributionProjectKey(row)] ?? true),
  );
  const scope = `claim-credits:${batchScope}`;

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Claim credits</DialogTitle>
          <DialogDescription>
            Claim selected balances into transferable {tokenSymbol} ERC-20 tokens in your wallet.
            Credits and ERC-20s have the same value.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          {creditRows.length === 0 ? (
            <p className="text-sm text-zinc-500">No new credits are available to claim.</p>
          ) : null}
          {creditRows.map((row) => {
            const key = distributionProjectKey(row);
            return (
              <label
                key={key}
                className="flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={row.credit > 0n && (selection[key] ?? true)}
                  disabled={row.credit <= 0n}
                  onChange={(event) =>
                    setSelection((previous) => ({ ...previous, [key]: event.target.checked }))
                  }
                  aria-label={`Claim on ${JB_CHAINS[row.chainId]?.name ?? row.chainId}, project ${row.projectId}`}
                />
                <ChainLogo chainId={row.chainId} width={16} height={16} />
                <span>
                  {JB_CHAINS[row.chainId]?.name ?? row.chainId} · project {String(row.projectId)}
                </span>
                <span className="tabular-nums">
                  {formatUnits(row.credit, JB_TOKEN_DECIMALS, { fractionDigits: 4 })} credits
                </span>
              </label>
            );
          })}
        </div>
        <OwnerDistributionBatchButton
          label="Claim selected credits"
          scope={scope}
          tokenSymbol={tokenSymbol}
          disabled={selected.length === 0}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
          }}
          prepare={async () => {
            if (!address) throw new Error("Connect your wallet to continue.");
            return Promise.all(
              selected.map(async (row) => {
                const client = getPublicClient(wagmiConfig, { chainId: row.chainId });
                if (!client) throw new Error(`No public client for chain ${row.chainId}.`);
                return prepareCreditClaim(
                  client,
                  {
                    chainId: row.chainId,
                    projectId: row.projectId,
                    directory: contractAddress(JBCoreContracts.JBDirectory, row.chainId),
                    projects: contractAddress(JBCoreContracts.JBProjects, row.chainId),
                  },
                  address,
                );
              }),
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
