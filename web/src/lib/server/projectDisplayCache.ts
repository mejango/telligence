import "server-only";

import type { IndexedReadResult } from "@/lib/projectIndexStatus";
import { QueryClient } from "@tanstack/query-core";

// Public indexed display data only. A stale fetch waits for its replacement;
// Next's stale-while-revalidate cache could keep an old success through an outage.
const displayCache = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: false },
  },
});

type DisplayKey =
  readonly ["project", number, number] | readonly ["group", number, string, number | undefined];

class IncompleteIndexedRead extends Error {
  constructor(readonly result: IndexedReadResult<unknown>) {
    super("Indexed display data is incomplete");
  }
}

/** Missing, incomplete and failed reads must remain retryable on the next request. */
export async function cachedIndexedDisplay<T>(
  key: DisplayKey,
  read: () => Promise<IndexedReadResult<T>>,
): Promise<IndexedReadResult<T>> {
  try {
    return await displayCache.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const result = await read();
        if (result.status !== "available") throw new IncompleteIndexedRead(result);
        return result;
      },
    });
  } catch (error) {
    if (error instanceof IncompleteIndexedRead) return error.result as IndexedReadResult<T>;
    throw error;
  }
}

export type ProjectDisplayRef = { chainId: number; projectId: number; groupId?: string };

/**
 * Cancel known affected fills as well as evicting successes. Callers supply a
 * group ID when available so even unresolved peer groups can be identified.
 * Unknown peer groups and other server processes retain the 30s expiry bound.
 */
export function invalidateProjectDisplay(refs: readonly ProjectDisplayRef[]): void {
  const groupIds = new Set(refs.flatMap((ref) => (ref.groupId ? [ref.groupId] : [])));
  for (const ref of refs) {
    const cached = displayCache.getQueryData<IndexedReadResult<{ suckerGroupId: string }>>([
      "project",
      ref.chainId,
      ref.projectId,
    ]);
    if (cached?.data?.suckerGroupId) groupIds.add(cached.data.suckerGroupId);
  }

  displayCache.removeQueries({
    predicate: (query) => {
      const [family, chainId, id, requestedProjectId] = query.queryKey;
      if (family === "project") {
        return refs.some((ref) => ref.chainId === chainId && ref.projectId === id);
      }
      if (family !== "group") return false;
      // The requested tuple scopes pending groups before membership is known.
      // Never cancel unrelated visitors' in-flight reads to refresh one project.
      if (
        groupIds.has(String(id)) ||
        refs.some((ref) => ref.chainId === chainId && ref.projectId === requestedProjectId)
      )
        return true;
      const result = query.state.data as
        IndexedReadResult<{ projects?: { items?: ProjectDisplayRef[] } }> | undefined;
      return Boolean(
        result?.data?.projects?.items?.some((project) =>
          refs.some(
            (ref) => ref.chainId === project.chainId && ref.projectId === project.projectId,
          ),
        ),
      );
    },
  });
}
