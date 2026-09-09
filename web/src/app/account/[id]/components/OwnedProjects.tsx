"use client";

import { publicClientFor } from "@/app/[slug]/components/v6/operator/operatorLib";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { ProjectLink } from "@/components/ProjectLink";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCompleteProjectsByOwner } from "@/hooks/useCompleteBendystrawLists";
import type { OwnedProjectRow } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { readAuthorityIdentity } from "@/lib/cross-chain-authority";
import type { JBChainId } from "@/lib/nana/types";
import { fetchSafesOwnedBy, type OwnedSafe } from "@/lib/safeOwners";
import { slugFor } from "@/lib/slug";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";

type SafePolicy = { threshold: number; ownerCount: number };

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-2)}`;
}

function ProjectCard({
  project,
  viaSafe,
  safePolicy,
}: {
  project: OwnedProjectRow;
  viaSafe?: Address;
  safePolicy?: SafePolicy;
}) {
  const slug = slugFor(project.chainId, project.projectId);
  const chain = JB_CHAINS[project.chainId as JBChainId]?.chain;
  const body = (
    <div className="flex items-center gap-3 py-3">
      <ChainLogo chainId={project.chainId as JBChainId} width={16} height={16} standalone />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-zinc-800">
          {project.name ?? project.handle ?? `Project #${project.projectId}`}
        </span>
        {project.isRevnet ? (
          <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
            Revnet
          </span>
        ) : null}
        {viaSafe ? (
          <span
            className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
            title={viaSafe}
          >
            via Safe {shortAddress(viaSafe)}
            {safePolicy ? ` (${safePolicy.threshold}/${safePolicy.ownerCount})` : ""}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-zinc-500">{chain?.name ?? `Chain ${project.chainId}`}</span>
    </div>
  );
  if (!slug) return body;
  const name = project.name ?? project.handle ?? `Project #${project.projectId}`;
  return (
    <ProjectLink
      href={`/${slug}`}
      projectHint={{ name, logoUri: project.logoUri }}
      className="block hover:bg-melon-100"
    >
      {body}
    </ProjectLink>
  );
}

export function OwnedProjects({ address }: { address: Address }) {
  const directQuery = useCompleteProjectsByOwner({
    owner: address.toLowerCase(),
    version: 6,
  });

  const safesQuery = useQuery({
    queryKey: ["safes-owned-by", address.toLowerCase()],
    queryFn: () => fetchSafesOwnedBy(address),
    staleTime: 60_000,
  });
  const safes = useMemo(() => safesQuery.data ?? [], [safesQuery.data]);

  const safeAddresses = useMemo(
    () => [...new Set(safes.map((safe) => safe.safe.toLowerCase()))],
    [safes],
  );
  const safeProjectsQuery = useCompleteProjectsByOwner(
    { owner_in: safeAddresses, version: 6 },
    safeAddresses.length > 0,
  );

  // Safe-service addresses are untrusted input. Authenticate the proxy and
  // bound every dynamic policy response before showing threshold metadata.
  const safePoliciesQuery = useQuery({
    queryKey: ["safe-policies", safeAddresses],
    enabled: safes.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, SafePolicy>> => {
      const entries = await Promise.all(
        safes.map(async (safe: OwnedSafe): Promise<[string, SafePolicy] | null> => {
          if (!JB_CHAINS[safe.chainId as JBChainId]) return null;
          try {
            const client = publicClientFor(safe.chainId as JBChainId);
            const identity = await readAuthorityIdentity(client, safe.safe);
            if (identity?.kind !== "safe") return null;
            return [
              `${safe.chainId}:${safe.safe.toLowerCase()}`,
              { threshold: identity.threshold, ownerCount: identity.owners.length },
            ];
          } catch {
            return null;
          }
        }),
      );
      return Object.fromEntries(entries.filter((entry) => entry !== null));
    },
  });

  const direct = directQuery.data ?? [];
  const viaSafe = safeProjectsQuery.data ?? [];
  const isLoading =
    directQuery.isLoading ||
    safesQuery.isLoading ||
    (safeAddresses.length > 0 && safeProjectsQuery.isLoading);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Owned projects</h2>
      {isLoading ? (
        <SkeletonLines lines={3} className="mt-3" />
      ) : directQuery.isError || (safeAddresses.length > 0 && safeProjectsQuery.isError) ? (
        <p className="text-sm text-zinc-500">Could not load the complete owned-project list.</p>
      ) : direct.length === 0 && viaSafe.length === 0 ? (
        <p className="text-sm text-zinc-500">No projects owned by this account.</p>
      ) : (
        <div className="divide-y divide-melon-200 bg-melon-50 px-4">
          {direct.map((project) => (
            <ProjectCard key={`${project.chainId}:${project.projectId}`} project={project} />
          ))}
          {viaSafe.map((project) => {
            const owner = project.owner.toLowerCase() as Address;
            const policy = safePoliciesQuery.data?.[`${project.chainId}:${owner}`];
            return (
              <ProjectCard
                key={`safe:${project.chainId}:${project.projectId}`}
                project={project}
                viaSafe={project.owner as Address}
                safePolicy={policy}
              />
            );
          })}
        </div>
      )}
      {!isLoading && safesQuery.isError ? (
        <p className="mt-2 text-xs text-zinc-500">
          Safe-owned projects could not be checked right now.
        </p>
      ) : null}
      {safes.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          Includes projects owned by Safes this account signs for:{" "}
          {safeAddresses.map((safe, index) => (
            <span key={safe}>
              {index > 0 ? ", " : ""}
              <EthereumAddress address={safe as Address} short chain={mainnet} />
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
