import {
  BENDYSTRAW_PROJECT_REF_BATCH_SIZE,
  bendystrawProjectRefFilter,
  bendystrawProjectRefsFilters,
  matchesBendystrawProjectRef,
  type BendystrawFilter,
  type BendystrawProjectRef,
} from "@bananapus/nana-sdk-core";

export type VersionedProjectRef = Required<BendystrawProjectRef>;

/** Keep exact-ref OR filters small enough for the indexer's input parser. */
export const REF_LOOKUP_BATCH_SIZE = BENDYSTRAW_PROJECT_REF_BATCH_SIZE;

export function projectRefKey(ref: VersionedProjectRef): string {
  bendystrawProjectRefFilter(ref);
  return `${ref.chainId}:${ref.projectId}:${ref.version}`;
}

/** A filter matching every unique ref exactly, or null for an empty input. */
export function projectRefsWhere(refs: readonly VersionedProjectRef[]): BendystrawFilter | null {
  if (refs.length === 0) return null;
  const batches = projectRefsWheres(refs);
  if (batches.length > 1) {
    throw new Error("Use projectRefsWheres for more than 200 project references.");
  }
  return batches[0] ?? null;
}

/** Exact project-ref filters in complete, independently queryable batches. */
export function projectRefsWheres(refs: readonly VersionedProjectRef[]): BendystrawFilter[] {
  return bendystrawProjectRefsFilters(refs);
}

/** Raw GraphQL equivalent for the one dynamic query which cannot use variables. */
export function projectRefGraphqlInput(ref: VersionedProjectRef): string {
  bendystrawProjectRefFilter(ref);
  return `{ AND: [{ chainId: ${ref.chainId} }, { projectId: ${ref.projectId} }, { version: ${ref.version} }] }`;
}

export function matchesProjectRef(
  row: VersionedProjectRef,
  refs: readonly VersionedProjectRef[],
): boolean {
  return matchesBendystrawProjectRef(row, refs);
}
