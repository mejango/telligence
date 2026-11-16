import "server-only";

import { getEnsPublicClient } from "@/lib/ensPublicClient.server";
import { readExactProjectHandle } from "@/lib/projectHandles";
import { unstable_cache } from "next/cache";
import { getIndexedProjectOperatorAddresses } from "./getProjectOperator";
import { getSuckerGroup } from "./getSuckerGroup";
import { resolveProjectRoute } from "./resolveProjectRoute.server";

/**
 * The verified handle names the revnet, so it is the canonical URL for every
 * route that reaches it — each chain's slug and the handle itself. The
 * registry keys handles by (chainId, projectId), so every deployment in the
 * group is checked. A handle an indexed operator published counts only when
 * its own route verifies it for that deployment: the live operator, its
 * authority on Ethereum (a Safe's with its creation proven) and both halves of
 * the ENS link, read on the same bounded and cached path as the route.
 */
export async function readCanonicalHandle(
  chainId: number,
  projectId: number,
  suckerGroupId: string | null,
): Promise<string | null> {
  const operators = await getIndexedProjectOperatorAddresses(projectId, chainId).catch(() => []);
  if (!operators.length) return null;
  const deployments: [number, number][] = [[chainId, projectId]];
  if (suckerGroupId) {
    const group = await getSuckerGroup(suckerGroupId, chainId, projectId);
    for (const sibling of group?.projects?.items ?? []) {
      const pair: [number, number] = [Number(sibling.chainId), Number(sibling.projectId)];
      if (!deployments.some(([chain, id]) => chain === pair[0] && id === pair[1])) {
        deployments.push(pair);
      }
    }
  }
  const client = getEnsPublicClient();
  const candidates = await Promise.all(
    deployments.flatMap(([chain, id]) =>
      operators.map(async (operator) => ({
        chain,
        id,
        handle: await readExactProjectHandle(client, chain, id, operator),
      })),
    ),
  );
  for (const { chain, id, handle } of candidates) {
    if (!handle) continue;
    const route = await resolveProjectRoute(`@${encodeURIComponent(handle)}`);
    if (route?.chainId === chain && route.projectId === BigInt(id)) return handle;
  }
  return null;
}

export const lookupCanonicalHandle = unstable_cache(
  readCanonicalHandle,
  ["telligence-project-canonical-handle-base"],
  { revalidate: 900 },
);
