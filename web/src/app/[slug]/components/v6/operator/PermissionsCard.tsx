"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCompleteProjectPermissions } from "@/hooks/useCompleteBendystrawLists";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useMemo } from "react";
import { Address, isAddress } from "viem";
import {
  ChainProjectRow,
  PermissionHolderRow,
  permissionHoldersWhere,
  revnetOwnerAddress,
  wildcardPermissionHoldersWhere,
} from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import { permissionInfo } from "./permissionMeta";

type Grant = {
  operator: Address;
  /** The account that granted these powers — only effective while it still owns the project. */
  account: Address;
  isRevnetOperator: boolean;
  rows: PermissionHolderRow[];
  /** Union of granted permission ids across chains, ascending. */
  union: number[];
  /** True when a chain is missing the grant or the sets differ by chain. */
  differs: boolean;
  /** False when the grantor is no longer the project's owner — the grant confers nothing. */
  live: boolean;
  /** Scoped to project 0: applies to every project the grantor owns, not just this one. */
  wildcard: boolean;
};

function samePermissionSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort((x, y) => x - y);
  const bb = [...b].sort((x, y) => x - y);
  return aa.every((value, index) => value === bb[index]);
}

export function aggregateGrants(items: PermissionHolderRow[], rows: ChainProjectRow[]): Grant[] {
  const expectedProjects = new Set(rows.map((row) => `${row.chainId}:${row.projectId}`));
  const groups = new Map<string, Grant>();
  for (const item of items) {
    const wildcard = !!item.wildcard;
    if (!wildcard && !expectedProjects.has(`${item.chainId}:${item.projectId}`)) continue;
    const permissions = (item.permissions ?? []).map(Number).filter((id) => id > 0);
    if (!permissions.length) continue; // stale/cleared grant — holds nothing
    if (!isAddress(item.operator)) continue;
    // Wildcard (projectId 0) grants stay a SEPARATE entry from project-scoped ones: they're distinct
    // grants with a wider blast radius, not two halves of the same authorization.
    const key = `${item.operator.toLowerCase()}|${wildcard ? "w" : "p"}`;
    const owner = revnetOwnerAddress(item.chainId as JBChainId);
    const grant = groups.get(key) ?? {
      operator: item.operator as Address,
      account: item.account as Address,
      isRevnetOperator: false,
      rows: [],
      union: [],
      differs: false,
      live: false,
      wildcard,
    };
    // A grant is keyed by (operator, GRANTOR, project) and only bites while the grantor still owns the
    // project. A grant written by a former owner survives as an indexed row that confers nothing.
    grant.live ||= !owner || owner.toLowerCase() === String(item.account).toLowerCase();
    const existing = grant.rows.find(
      (row) => row.chainId === item.chainId && row.projectId === item.projectId,
    );
    if (existing) {
      existing.permissions = [
        ...new Set([
          ...(existing.permissions ?? []).map(Number),
          ...(item.permissions ?? []).map(Number),
        ]),
      ];
      existing.isRevnetOperator ||= Boolean(item.isRevnetOperator);
    } else {
      grant.rows.push({ ...item, permissions });
    }
    grant.isRevnetOperator ||= Boolean(item.isRevnetOperator);
    grant.union = [...new Set([...grant.union, ...permissions])].sort((a, b) => a - b);
    groups.set(key, grant);
  }
  for (const grant of groups.values()) {
    const first = (grant.rows[0]?.permissions ?? []).map(Number).filter((id) => id > 0);
    // Wildcard grants carry projectId 0, so coverage is only meaningful per chain for them.
    const covered = new Set(
      grant.rows.map((row) =>
        grant.wildcard ? String(row.chainId) : `${row.chainId}:${row.projectId}`,
      ),
    );
    grant.differs =
      rows.some(
        (row) =>
          !covered.has(grant.wildcard ? String(row.chainId) : `${row.chainId}:${row.projectId}`),
      ) ||
      grant.rows.some(
        (row) =>
          !samePermissionSet(
            first,
            (row.permissions ?? []).map(Number).filter((id) => id > 0),
          ),
      );
  }
  return [...groups.values()];
}

/**
 * website/-parity renderPermissionsCard, revnet branch: a READ-ONLY list of
 * every permission holder across the sucker group's chains and the human
 * meaning of each granted v6 permission id. The operator role is set on the
 * revnet itself (REVOwner), not via setPermissionsFor here.
 */
export function PermissionsCard({ rows }: { rows: ChainProjectRow[] }) {
  const query = useCompleteProjectPermissions(permissionHoldersWhere(rows), rows.length > 0);
  const wildcardWhere = useMemo(() => wildcardPermissionHoldersWhere(rows), [rows]);
  const wildcardQuery = useCompleteProjectPermissions(
    wildcardWhere ?? { OR: [] },
    rows.length > 0 && !!wildcardWhere,
  );
  const grants = useMemo(
    () =>
      aggregateGrants(
        [
          ...(query.data ?? []),
          ...(wildcardQuery.data ?? []).map((item) => ({ ...item, wildcard: true })),
        ],
        rows,
      ),
    [query.data, wildcardQuery.data, rows],
  );
  // The owner never appears in the indexed grants: JBPermissioned._requirePermissionFrom passes on
  // `sender == account` before consulting JBPermissions at all. For a revnet that owner is REVOwner,
  // the contract whose fixed permission set the operator role is expressed through — so listing only
  // the operator hides where its powers come from.
  const owners = useMemo(() => {
    const seen = new Map<string, JBChainId[]>();
    for (const row of rows) {
      const owner = revnetOwnerAddress(row.chainId);
      if (!owner) continue;
      const key = owner.toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), row.chainId]);
    }
    return [...seen.entries()].map(([address, chains]) => ({
      address: address as Address,
      chains,
    }));
  }, [rows]);

  return (
    <OperatorSection title="Permissions">
      <div>
        <p className="text-sm text-zinc-500">
          Every account that can act on this revnet, and what each one can do. The revnet
          operator&apos;s powers come with the role, including any NFT powers granted at launch.
        </p>
        {owners.length ? (
          <div className="mt-3 border-b border-melon-200 pb-3">
            {owners.map((owner) => (
              <div key={owner.address} className="flex flex-wrap items-center gap-2">
                <EthereumAddress
                  address={owner.address}
                  short
                  chain={JB_CHAINS[owner.chains[0]]?.chain}
                />
                <span className="rounded-full bg-teal-50 text-teal-700 px-2 py-0.5 text-[11px] font-medium">
                  Project owner (REVOwner)
                </span>
                <span className="flex items-center gap-1" title="On">
                  {owner.chains.map((chainId) => (
                    <ChainLogo key={chainId} chainId={chainId} width={14} height={14} standalone />
                  ))}
                </span>
              </div>
            ))}
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Every power. The revnet is owned by the REVOwner contract, which acts directly and
              never needs a grant — it is what delegates the powers below to the revnet operator.
            </p>
          </div>
        ) : null}
        {query.isLoading ? (
          <SkeletonLines lines={4} className="mt-3" />
        ) : query.isError ? (
          <p className="text-sm text-zinc-500 mt-3">Could not read permissions.</p>
        ) : grants.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No other accounts have been granted permissions, according to the indexer. Grants are
            read from the index, so one made very recently may not appear yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-melon-200 bg-melon-50 px-4">
            {grants.map((grant) => (
              <div
                key={`${grant.operator}:${grant.wildcard ? "wildcard" : "project"}`}
                className="py-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <EthereumAddress
                    address={grant.operator}
                    short
                    withEnsName
                    chain={JB_CHAINS[grant.rows[0]?.chainId as JBChainId]?.chain}
                  />
                  {grant.isRevnetOperator ? (
                    <span className="rounded-full bg-teal-50 text-teal-700 px-2 py-0.5 text-[11px] font-medium">
                      Revnet operator
                    </span>
                  ) : null}
                  {grant.wildcard ? (
                    <span
                      className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-medium"
                      title={`Granted on project 0 — the wildcard scope. This applies to EVERY project ${grant.account} owns, not just this one.`}
                    >
                      All projects
                    </span>
                  ) : null}
                  {grant.differs ? (
                    <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-medium">
                      Differs by chain
                    </span>
                  ) : null}
                  {!grant.live ? (
                    <span
                      className="rounded-full bg-zinc-100 text-zinc-700 px-2 py-0.5 text-[11px] font-medium"
                      title={`Granted by ${grant.account}, which no longer owns this revnet — these powers confer nothing.`}
                    >
                      Inactive
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  {grant.union.map((id) => {
                    const info = permissionInfo(id);
                    const onChains = grant.rows
                      .filter((row) => (row.permissions ?? []).map(Number).includes(id))
                      .map((row) => row.chainId);
                    return (
                      <div
                        key={id}
                        className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[12rem_1fr_auto]"
                      >
                        <span className="text-sm font-medium">
                          {info.label}
                          <span className="ml-1 font-mono text-[10px] text-zinc-500">#{id}</span>
                        </span>
                        <span className="text-xs text-zinc-500">{info.description}</span>
                        <span
                          className="flex flex-wrap items-center gap-1 sm:justify-end"
                          title="Granted on"
                        >
                          {onChains.map((chainId) => (
                            <ChainLogo
                              key={chainId}
                              chainId={chainId as JBChainId}
                              width={14}
                              height={14}
                              standalone
                            />
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </OperatorSection>
  );
}
