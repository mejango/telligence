import { decodeProjectRouteSlug } from "@/lib/slug";
import type { QueryClient } from "@tanstack/react-query";
import { isProjectRouteFresh, type ProjectRouteSnapshot } from "./projectRouteIdentity";

const QUERY_KEY = "verified-project-route";

export async function invalidateProjectRouteProofs(client: QueryClient) {
  // A pre-mutation response cannot renew proof after the confirmed write.
  // Retain invalidation so the caller's initial snapshot cannot bypass it.
  await client.cancelQueries({ queryKey: [QUERY_KEY] });
  await client.invalidateQueries({ queryKey: [QUERY_KEY], refetchType: "none" });
}

export function projectRouteQueryKey(slug: string) {
  return [QUERY_KEY, decodeProjectRouteSlug(slug) ?? slug] as const;
}

/** Memory only. Errors do not renew proof; concurrent transitions share one live read. */
export async function verifyProjectRoute(
  client: QueryClient,
  slug: string,
  initial: ProjectRouteSnapshot,
  force = false,
): Promise<ProjectRouteSnapshot> {
  const queryKey = projectRouteQueryKey(slug);
  const cached = client.getQueryData<ProjectRouteSnapshot>(queryKey);
  const candidate =
    cached && (cached.localCheckedAt ?? 0) >= (initial.localCheckedAt ?? 0) ? cached : initial;
  if (
    !force &&
    client.getQueryState(queryKey)?.status !== "error" &&
    !client.getQueryState(queryKey)?.isInvalidated &&
    isProjectRouteFresh(candidate)
  )
    return candidate;

  return client.fetchQuery({
    queryKey,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const startedAt = Date.now();
      const response = await fetch(`/api/project-route?slug=${encodeURIComponent(slug)}`, {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error("Unable to verify this handle");
      const value = (await response.json()) as ProjectRouteSnapshot & { serverNow: number };
      if (
        !Number.isSafeInteger(value.chainId) ||
        value.chainId <= 0 ||
        typeof value.projectId !== "string" ||
        !/^\d+$/.test(value.projectId) ||
        typeof value.authority !== "string" ||
        !/^0x[\da-f]{40}$/i.test(value.authority) ||
        typeof value.checkedAt !== "number" ||
        !Number.isFinite(value.serverNow) ||
        value.serverNow < value.checkedAt
      )
        throw new Error("The handle verification expired. Try again.");
      // Subtract server-side age from request START, conservatively charging the
      // entire round trip. Server/client clock skew cannot extend this lease.
      const proof = {
        ...value,
        authority: value.authority.toLowerCase(),
        localCheckedAt: startedAt - (value.serverNow - value.checkedAt!),
      };
      if (!isProjectRouteFresh(proof))
        throw new Error("The handle verification expired. Try again.");
      return proof;
    },
  });
}
