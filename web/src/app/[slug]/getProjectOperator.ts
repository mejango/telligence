import "server-only";

import { PermissionHoldersOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { fetchProfile } from "@/lib/profile";
import { revnetOperatorCandidates } from "@/lib/revnetOperator";
import {
  getJBContractAddress,
  RevnetCoreContracts,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";

// Bendystraw is only a fast-path hint. Do not paginate an attacker-inflatable
// operator history without bound; canonical JBPermissions history is the
// fail-closed recovery path when these recent candidates are stale.
const MAX_INDEXED_OPERATOR_ROWS = 64;

export const getProjectOperator = unstable_cache(
  async (projectId: number, chainId: number) => {
    const address = await getCurrentProjectOperatorAddress(projectId, chainId);
    return address ? await fetchProfile(address) : null;
  },
  ["project-operator"],
  {
    revalidate: 24 * 60 * 60, // 24 hours in seconds
  },
);

/**
 * The revnet's operator address, or null when the indexer answered and nobody
 * holds the role. A read failure throws: an outage is a different claim than
 * "no operator", and callers render it as unavailable rather than as absent.
 */
async function getIndexedOperatorRows(projectId: number, chainId: number) {
  const result = await queryBendystraw(chainId, PermissionHoldersOperation, {
    where: {
      chainId,
      projectId,
      version: 6,
      account: getJBContractAddress(RevnetCoreContracts.REVOwner, 6, chainId as JBChainId),
    },
    limit: MAX_INDEXED_OPERATOR_ROWS,
    offset: 0,
  });
  return (result.permissionHolders?.items ?? []).slice(0, MAX_INDEXED_OPERATOR_ROWS);
}

/** Every indexed address is only a candidate until REVOwner confirms it. */
export async function getIndexedProjectOperatorAddresses(projectId: number, chainId: number) {
  return revnetOperatorCandidates(await getIndexedOperatorRows(projectId, chainId));
}

/** @deprecated Prefer all candidates plus a live REVOwner check. */
async function getCurrentProjectOperatorAddress(projectId: number, chainId: number) {
  return (await getIndexedProjectOperatorAddresses(projectId, chainId))[0] ?? null;
}
