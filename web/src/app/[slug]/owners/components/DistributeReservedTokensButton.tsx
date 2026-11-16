"use client";

import { chainDisplayName } from "@/app/constants";
import { TokenAmount } from "@/components/TokenAmount";
import { Skeleton } from "@/components/ui/skeleton";
import { useJBContractContext } from "@/lib/nana/project";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { OwnerDistributionBatchButton } from "./OwnerDistributionBatchButton";
import {
  distributionProjectKey,
  prepareReservedDistribution,
  type DistributionProject,
} from "./ownerDistributionBatch";

export function DistributeReservedTokensButton({
  projects,
  pendingLoading = false,
  tokenSymbol = "tokens",
  onSuccess,
}: {
  projects: Array<DistributionProject & { pending?: bigint }>;
  /** A missing `pending` is a failed read unless the reads are still in flight. */
  pendingLoading?: boolean;
  tokenSymbol?: string;
  onSuccess?: () => void;
}) {
  const { address } = useAccount();
  const { contractAddress } = useJBContractContext();
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const selected = projects.filter(
    (project) =>
      selection[distributionProjectKey(project)] ??
      (project.pending !== undefined && project.pending > 0n),
  );
  const scope = `reserved-distribution:${projects.map(distributionProjectKey).sort().join("|")}`;

  return (
    <div className="my-4 space-y-3">
      <p className="text-sm text-zinc-600">
        Send pending split tokens to each selected chain’s current recipients.
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {projects.map((project) => {
          const key = distributionProjectKey(project);
          return (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selection[key] ?? (project.pending !== undefined && project.pending > 0n)}
                disabled={project.pending === 0n}
                onChange={(event) =>
                  setSelection((previous) => ({ ...previous, [key]: event.target.checked }))
                }
              />
              {chainDisplayName(project.chainId)}
              {project.pending !== undefined ? (
                <span>
                  (<TokenAmount value={project.pending} decimals={18} symbol={tokenSymbol} />)
                </span>
              ) : pendingLoading ? (
                <Skeleton className="h-3 w-16" />
              ) : (
                <span>(balance unavailable)</span>
              )}
            </label>
          );
        })}
      </div>
      <OwnerDistributionBatchButton
        label="Distribute selected pending splits"
        scope={scope}
        tokenSymbol={tokenSymbol}
        disabled={selected.length === 0}
        targets={selected}
        group={projects}
        onSuccess={onSuccess}
        prepare={async () => {
          if (!address) throw new Error("Connect your wallet to continue.");
          return Promise.all(
            selected.map(async (project) => {
              const client = getPublicClient(wagmiConfig, { chainId: project.chainId });
              if (!client) throw new Error(`No public client for chain ${project.chainId}.`);
              return prepareReservedDistribution(
                client,
                {
                  ...project,
                  directory: contractAddress(JBCoreContracts.JBDirectory, project.chainId),
                  projects: contractAddress(JBCoreContracts.JBProjects, project.chainId),
                },
                address,
              );
            }),
          );
        }}
      />
    </div>
  );
}
