"use client";

import { useJBContractContext } from "@/lib/nana/project";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { formatUnits, JB_CHAINS, JBCoreContracts } from "@bananapus/nana-sdk-core";
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
  tokenSymbol = "tokens",
  onSuccess,
}: {
  projects: Array<DistributionProject & { pending?: bigint }>;
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
    <div className="my-4 space-y-3 border border-zinc-200 p-3">
      <p className="text-sm text-zinc-600">
        Distribute pending reserved tokens to each selected chain’s current split recipients.
      </p>
      <div className="flex flex-wrap gap-3">
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
              {JB_CHAINS[project.chainId]?.name ?? project.chainId} · project{" "}
              {String(project.projectId)}
              {project.pending !== undefined
                ? ` (${formatUnits(project.pending, 18, { fractionDigits: 4 })} ${tokenSymbol})`
                : " (balance unavailable)"}
            </label>
          );
        })}
      </div>
      <OwnerDistributionBatchButton
        label="Distribute selected pending splits"
        scope={scope}
        tokenSymbol={tokenSymbol}
        disabled={selected.length === 0}
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
