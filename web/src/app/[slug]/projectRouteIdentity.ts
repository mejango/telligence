import type { ResolvedProjectRoute } from "./resolveProjectRoute.server";

/** Alias proof is reusable for five seconds from verification, never from cache access. */
export const PROJECT_ROUTE_TTL_MS = 5_000;

export type ProjectRouteSnapshot = {
  chainId: number;
  projectId: string;
  authority: string | null;
  checkedAt: number | null;
  /** Conservative browser-clock lease; absent from server snapshots. */
  localCheckedAt?: number;
};

export function projectRouteSnapshot(route: ResolvedProjectRoute): ProjectRouteSnapshot {
  return {
    chainId: route.chainId,
    projectId: route.projectId.toString(),
    authority: route.verifiedOperator?.toLowerCase() ?? null,
    checkedAt: route.checkedAt ?? null,
  };
}

export function projectRouteIdentity(route: ProjectRouteSnapshot) {
  return `${route.chainId}:${route.projectId}:${route.authority ?? ""}`;
}

export function isProjectRouteFresh(route: ProjectRouteSnapshot, now = Date.now()) {
  return (
    route.localCheckedAt !== undefined &&
    now >= route.localCheckedAt &&
    now - route.localCheckedAt < PROJECT_ROUTE_TTL_MS
  );
}
