"use client";

import {
  AccountActivityEventsOperation,
  AccountPermissionHoldersOperation,
  AccountTokenBalancesOperation,
  ActivityEventsOperation,
  AllLoansOperation,
  LoansByAccountOperation,
  OwnedNftsOperation,
  ParticipantsOperation,
  PermissionHoldersOperation,
  ProjectErc20TickersOperation,
  ProjectPayersOperation,
  ProjectsByOwnerOperation,
  V6AutoIssueEventsOperation,
  V6StoredAutoIssuancesOperation,
} from "@/lib/bendystraw";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import {
  matchesProjectRef,
  projectRefsWheres,
  type VersionedProjectRef,
} from "@/lib/bendystraw/projectRefs";
import type {
  AccountActivityEventsQuery,
  AccountPermissionHolderRow,
  AccountTokenBalanceRow,
  ActivityEventsQuery,
  ActivityEventsQueryVariables,
  AllLoansQuery,
  BendystrawFilter,
  LoansByAccountQuery,
  OwnedNftsQuery,
  OwnedProjectRow,
  ParticipantsQuery,
  PermissionHolder,
  PermissionHolderFilter,
  ProjectErc20TickerRow,
  ProjectPayerFilter,
  ProjectPayersQuery,
  V6AutoIssueEventsQuery,
  V6StoredAutoIssuancesQuery,
} from "@/lib/bendystraw/types";
import { PERSIST } from "@/lib/query-persist";
import { useQuery } from "@tanstack/react-query";

const PAGE_SIZE = 250;

async function completeProjects(where: BendystrawFilter) {
  const items: OwnedProjectRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(ProjectsByOwnerOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.projects.items ?? [];
    totalCount = data.projects.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeAccountPermissions(where: BendystrawFilter) {
  const items: AccountPermissionHolderRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(AccountPermissionHoldersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.permissionHolders?.items ?? [];
    totalCount = data.permissionHolders?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

type ProjectPermissionRow = Pick<
  PermissionHolder,
  "chainId" | "projectId" | "account" | "operator" | "permissions" | "isRevnetOperator"
>;

async function completeProjectPermissions(where: PermissionHolderFilter) {
  const items: ProjectPermissionRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(PermissionHoldersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.permissionHolders?.items ?? [];
    totalCount = data.permissionHolders?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeActivityEvents(
  variables: Omit<ActivityEventsQueryVariables, "limit" | "offset">,
  chainId: number,
) {
  const items: ActivityEventsQuery["activityEvents"]["items"] = [];
  let offset = 0;
  let totalCount: number | undefined;
  do {
    const data = await queryBendystrawFromBrowser(
      ActivityEventsOperation,
      {
        ...variables,
        limit: PAGE_SIZE,
        offset,
      },
      chainId,
    );
    const page = data.activityEvents.items ?? [];
    totalCount = data.activityEvents.totalCount;
    items.push(...page);
    offset += PAGE_SIZE;
    if (!page.length || (totalCount === undefined && page.length < PAGE_SIZE)) break;
  } while (totalCount === undefined || items.length < totalCount);
  return items;
}

const ACCOUNT_ACTIVITY_ROOTS = [
  "activityEvents",
  "beneficiaryPayEvents",
  "beneficiaryCashOutEvents",
  "beneficiaryMintTokensEvents",
  "beneficiaryManualMintTokensEvents",
  "beneficiaryAutoIssueEvents",
] as const;

async function completeAccountActivity(address: string): Promise<AccountActivityEventsQuery> {
  const result: AccountActivityEventsQuery = { activityEvents: { items: [] } };
  let offset = 0;
  while (true) {
    const data = await queryBendystrawFromBrowser(AccountActivityEventsOperation, {
      address,
      limit: PAGE_SIZE,
      offset,
    });
    let needsAnotherPage = false;
    for (const rootName of ACCOUNT_ACTIVITY_ROOTS) {
      const pageRoot = data[rootName];
      if (!pageRoot) continue;
      const resultRoot = result[rootName] as { totalCount?: number; items: unknown[] } | undefined;
      const mergedRoot = resultRoot ?? { items: [] };
      mergedRoot.items.push(...pageRoot.items);
      mergedRoot.totalCount = pageRoot.totalCount;
      (result as Record<string, unknown>)[rootName] = mergedRoot;
      needsAnotherPage ||=
        pageRoot.totalCount !== undefined
          ? mergedRoot.items.length < pageRoot.totalCount
          : pageRoot.items.length === PAGE_SIZE;
    }
    if (!needsAnotherPage) break;
    offset += PAGE_SIZE;
  }
  return result;
}

async function completeProjectPayers(where: ProjectPayerFilter) {
  const items: NonNullable<ProjectPayersQuery["projectPayers"]>["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(ProjectPayersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.projectPayers?.items ?? [];
    totalCount = data.projectPayers?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeStoredAutoIssuances(where: BendystrawFilter) {
  const items: V6StoredAutoIssuancesQuery["storeAutoIssuanceAmountEvents"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(V6StoredAutoIssuancesOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.storeAutoIssuanceAmountEvents.items ?? [];
    totalCount = data.storeAutoIssuanceAmountEvents.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeAutoIssueEvents(where: BendystrawFilter) {
  const items: V6AutoIssueEventsQuery["autoIssueEvents"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(V6AutoIssueEventsOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.autoIssueEvents.items ?? [];
    totalCount = data.autoIssueEvents.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

export async function fetchCompleteLoans(refs: readonly VersionedProjectRef[]) {
  const batches = projectRefsWheres(refs);
  const pages = await Promise.all(
    batches.map(async (where) => {
      const items: NonNullable<AllLoansQuery["loans"]>["items"] = [];
      let totalCount = 0;
      do {
        const data = await queryBendystrawFromBrowser(AllLoansOperation, {
          where,
          limit: PAGE_SIZE,
          offset: items.length,
        });
        const page = data.loans?.items ?? [];
        totalCount = data.loans?.totalCount ?? page.length;
        for (const row of page) {
          if (!matchesProjectRef(row, refs)) {
            throw new Error("Bendystraw returned a loan for the wrong deployment.");
          }
        }
        items.push(...page);
        if (!page.length && items.length < totalCount) {
          throw new Error("Indexed loan data ended before its reported total.");
        }
      } while (items.length < totalCount);
      return items;
    }),
  );
  return pages.flat().sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Every loan an account owns, paged to completion.
 *
 * The unpaginated form silently returned only the indexer's default page, so an account
 * past that many loans lost rows with no signal — and which rows survived depended on the
 * server's default ordering.
 */
export async function fetchLoansByAccount(owner: string, version: number, chainId?: number) {
  const items: LoansByAccountQuery["loans"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(
      LoansByAccountOperation,
      { owner, version, limit: PAGE_SIZE, offset: items.length },
      chainId,
    );
    const page = data.loans?.items ?? [];
    totalCount = data.loans?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length && items.length < totalCount) {
      throw new Error("Indexed loan data ended before its reported total.");
    }
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeParticipants(where: BendystrawFilter, chainId: number) {
  const items: ParticipantsQuery["participants"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(
      ParticipantsOperation,
      {
        where,
        orderBy: "balance",
        orderDirection: "desc",
        limit: PAGE_SIZE,
        offset: items.length,
      },
      chainId,
    );
    const page = data.participants.items ?? [];
    totalCount = data.participants.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeAccountTokenBalances(account: string) {
  const items: AccountTokenBalanceRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(AccountTokenBalancesOperation, {
      account,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.participants.items ?? [];
    totalCount = data.participants.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeOwnedNfts(where: BendystrawFilter) {
  const items: OwnedNftsQuery["nfts"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(OwnedNftsOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.nfts.items ?? [];
    totalCount = data.nfts.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeProjectTickers(where: BendystrawFilter) {
  const items: ProjectErc20TickerRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(ProjectErc20TickersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.deployErc20Events.items ?? [];
    totalCount = data.deployErc20Events.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

export function useCompleteProjectsByOwner(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-projects-by-owner", where],
    queryFn: () => completeProjects(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteAccountPermissions(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-account-permissions", where],
    queryFn: () => completeAccountPermissions(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteProjectPermissions(where: PermissionHolderFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-project-permissions", where],
    queryFn: () => completeProjectPermissions(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteActivityEvents(
  variables: Omit<ActivityEventsQueryVariables, "limit" | "offset">,
  chainId: number,
) {
  return useQuery({
    queryKey: ["complete-activity-events", variables, chainId],
    queryFn: () => completeActivityEvents(variables, chainId),
    refetchInterval: 15_000,
  });
}

export function useCompleteAccountActivity(address: string, enabled = true) {
  return useQuery({
    queryKey: ["complete-account-activity", address],
    queryFn: () => completeAccountActivity(address),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useCompleteProjectPayers(where: ProjectPayerFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-project-payers", where],
    queryFn: () => completeProjectPayers(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteStoredAutoIssuances(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-stored-auto-issuances", where],
    queryFn: () => completeStoredAutoIssuances(where),
    enabled,
  });
}

export function useCompleteAutoIssueEvents(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-auto-issue-events", where],
    queryFn: () => completeAutoIssueEvents(where),
    enabled,
  });
}

export function useCompleteLoans(refs: readonly VersionedProjectRef[], enabled = true) {
  return useQuery({
    queryKey: ["complete-loans", refs],
    queryFn: () => fetchCompleteLoans(refs),
    enabled: enabled && refs.length > 0,
  });
}

export function useCompleteLoansByAccount(
  owner: string | undefined,
  version: number,
  chainId?: number,
  pollInterval = 3_000,
) {
  return useQuery({
    queryKey: ["complete-loans-by-account", owner ?? null, version, chainId ?? null],
    queryFn: () => fetchLoansByAccount(owner!, version, chainId),
    enabled: !!owner,
    refetchInterval: pollInterval,
  });
}

export function useCompleteParticipants(where: BendystrawFilter, chainId: number, enabled = true) {
  return useQuery({
    queryKey: ["complete-participants", where, chainId],
    meta: PERSIST,
    queryFn: () => completeParticipants(where, chainId),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useCompleteAccountTokenBalances(account: string, enabled = true) {
  return useQuery({
    queryKey: ["complete-account-token-balances", account],
    queryFn: () => completeAccountTokenBalances(account),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteOwnedNfts(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-owned-nfts", where],
    queryFn: () => completeOwnedNfts(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteProjectsByRefs(wheres: BendystrawFilter[], enabled = true) {
  return useQuery({
    queryKey: ["complete-projects-by-refs", wheres],
    queryFn: async () => (await Promise.all(wheres.map(completeProjects))).flat(),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteProjectTickersByRefs(wheres: BendystrawFilter[], enabled = true) {
  return useQuery({
    queryKey: ["complete-project-tickers-by-refs", wheres],
    queryFn: async () => (await Promise.all(wheres.map(completeProjectTickers))).flat(),
    enabled,
    staleTime: 60_000,
  });
}
