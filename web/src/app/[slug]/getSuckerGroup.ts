import { SuckerGroupOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { SuckerGroupQuery } from "@/lib/bendystraw/types";
import { indexedGroupStatus, type IndexedReadResult } from "@/lib/projectIndexStatus";
import { cachedIndexedDisplay } from "@/lib/server/projectDisplayCache";
import { COMPUTE_CHAIN_ID } from "@/lib/telligence/transactions";
import { cache } from "react";

// Share successful display reads briefly; failed/incomplete reads remain retryable.
const getNormalizedIndexedSuckerGroup = cache(
  async (
    suckerGroupId: string,
    chainId: number,
    projectId: number | undefined,
  ): Promise<IndexedReadResult<NonNullable<SuckerGroupQuery["suckerGroup"]>>> => {
    if (!suckerGroupId) return { data: null, status: "not-checked" };
    try {
      return await cachedIndexedDisplay(["group", chainId, suckerGroupId, projectId], async () => {
        const result = await queryBendystraw(chainId, SuckerGroupOperation, { id: suckerGroupId });
        // These deployments feed chain selectors and transaction tabs. Indexer peers must not
        // expand Telligence's transaction network: a Base page sees Base deployments only, and a
        // group with none is missing. Routes resolve Base alone (resolveProjectRoute).
        const read = result.suckerGroup;
        if (chainId !== COMPUTE_CHAIN_ID || !read?.projects)
          return { data: read, status: indexedGroupStatus(read, projectId, chainId) };
        const items = read.projects.items.filter((project) => project.chainId === COMPUTE_CHAIN_ID);
        if (!items.length) return { data: null, status: "missing" };
        const group = { ...read, projects: { ...read.projects, items } };
        return { data: group, status: indexedGroupStatus(group, projectId, chainId) };
      });
    } catch {
      return { data: null, status: "unavailable" };
    }
  },
);

export function getIndexedSuckerGroup(
  suckerGroupId: string,
  chainId: number,
  projectId?: number | bigint,
) {
  return getNormalizedIndexedSuckerGroup(
    suckerGroupId,
    chainId,
    projectId === undefined ? undefined : Number(projectId),
  );
}

export const getSuckerGroup = cache(
  async (suckerGroupId: string, chainId: number, projectId?: number | bigint) =>
    (await getIndexedSuckerGroup(suckerGroupId, chainId, projectId)).data,
);
