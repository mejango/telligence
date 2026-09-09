"use client";

import { permissionInfo } from "@/app/[slug]/components/v6/operator/permissionMeta";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { ProjectLink } from "@/components/ProjectLink";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCompleteAccountPermissions } from "@/hooks/useCompleteBendystrawLists";
import type { AccountPermissionHolderRow } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { slugFor } from "@/lib/slug";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import { useMemo } from "react";
import { isAddress, type Address } from "viem";

type OperatedProject = {
  chainId: JBChainId;
  projectId: number;
  name: string | null;
  /** Union of permission ids granted to the operator on this project, ascending. */
  permissions: number[];
  isRevnetOperator: boolean;
  /** Accounts that granted permissions to this operator. */
  grantedBy: Address[];
};

/**
 * Groups permission-holder rows by (chainId, projectId), following the
 * PermissionsCard aggregation: union the granted ids, surface the revnet
 * operator role, and keep every granting account.
 */
function aggregateOperatedProjects(items: AccountPermissionHolderRow[]): OperatedProject[] {
  const groups = new Map<string, OperatedProject>();
  for (const item of items) {
    const permissions = (item.permissions ?? []).map(Number).filter((id) => id > 0);
    if (!permissions.length) continue; // stale/cleared grant — holds nothing
    if (!JB_CHAINS[item.chainId as JBChainId]) continue;
    const key = `${item.chainId}:${item.projectId}`;
    const group = groups.get(key) ?? {
      chainId: item.chainId as JBChainId,
      projectId: item.projectId,
      name: item.project?.name ?? item.project?.handle ?? null,
      permissions: [],
      isRevnetOperator: false,
      grantedBy: [],
    };
    group.permissions = [...new Set([...group.permissions, ...permissions])].sort((a, b) => a - b);
    group.isRevnetOperator ||= Boolean(item.isRevnetOperator);
    if (
      isAddress(item.account) &&
      !group.grantedBy.some((account) => account.toLowerCase() === item.account.toLowerCase())
    ) {
      group.grantedBy.push(item.account as Address);
    }
    group.name ??= item.project?.name ?? item.project?.handle ?? null;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function OperatedProjects({ address }: { address: Address }) {
  const query = useCompleteAccountPermissions({
    operator: address.toLowerCase(),
    version: 6,
  });

  const projects = useMemo(() => aggregateOperatedProjects(query.data ?? []), [query.data]);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Operated projects</h2>
      {query.isLoading ? (
        <SkeletonLines lines={3} className="mt-3" />
      ) : query.isError ? (
        <p className="text-sm text-zinc-500">Could not read permissions.</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-zinc-500">This account operates no projects.</p>
      ) : (
        <div className="divide-y divide-melon-200 bg-melon-50 px-4">
          {projects.map((project) => {
            const slug = slugFor(project.chainId, project.projectId);
            const label = project.name ?? `Project #${project.projectId}`;
            return (
              <div key={`${project.chainId}:${project.projectId}`} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ChainLogo chainId={project.chainId} width={16} height={16} standalone />
                  {slug ? (
                    <ProjectLink
                      href={`/${slug}`}
                      projectHint={{ name: label, logoUri: null }}
                      className="text-sm font-medium hover:underline"
                    >
                      {label}
                    </ProjectLink>
                  ) : (
                    <span className="text-sm font-medium">{label}</span>
                  )}
                  {project.isRevnetOperator ? (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                      Revnet operator
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.permissions.map((id) => {
                    const info = permissionInfo(id);
                    return (
                      <span
                        key={id}
                        title={info.description}
                        className="rounded-full bg-melon-100 px-2 py-0.5 text-[11px] text-zinc-700"
                      >
                        {info.label}
                        <span className="ml-1 font-mono text-[10px] text-zinc-500">#{id}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  Granted by{" "}
                  {project.grantedBy.map((account, index) => (
                    <span key={account}>
                      {index > 0 ? ", " : ""}
                      <EthereumAddress
                        address={account}
                        short
                        withEnsName
                        chain={JB_CHAINS[project.chainId]?.chain}
                      />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
