import "server-only";

import { ProjectTokenBalanceMomentsOperation } from "./operations";
import { queryBendystraw } from "./query.server";
import type { ProjectTokenBalanceMoment, ProjectTokenBalanceMomentsQueryVariables } from "./types";

/** Every per-token balance moment of one deployment, oldest first. */
export async function fetchProjectTokenBalanceMoments(
  routingChainId: number,
  { projectId, chainId, version }: Omit<ProjectTokenBalanceMomentsQueryVariables, "after">,
): Promise<ProjectTokenBalanceMoment[]> {
  const items: ProjectTokenBalanceMoment[] = [];
  let after: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    const result = await queryBendystraw(routingChainId, ProjectTokenBalanceMomentsOperation, {
      projectId,
      chainId,
      version,
      after,
    });
    items.push(...result.projectTokenBalanceMoments.items);
    const page = result.projectTokenBalanceMoments.pageInfo;
    after = page.hasNextPage ? (page.endCursor ?? undefined) : undefined;
    if (!after || cursors.has(after)) break;
    cursors.add(after);
  }
  return items;
}
