import type { ProjectDataStatus } from "@bananapus/nana-sdk-core/v6";
import { matchesProjectRef } from "./bendystraw/projectRefs";
import type { ProjectQuery, SuckerGroupQuery } from "./bendystraw/types";

/** Availability describes what a read observed; it does not infer indexer progress. */
export type IndexedReadStatus = ProjectDataStatus;
export type IndexedReadResult<T> = { data: T | null; status: IndexedReadStatus };
export type ProjectIndexStatus = {
  project: IndexedReadStatus;
  group: IndexedReadStatus;
};

export function indexedProjectStatus(project: ProjectQuery["project"]): IndexedReadStatus {
  if (!project) return "missing";
  return project.token && project.decimals != null && project.currency != null
    ? "available"
    : "incomplete";
}

export function indexedGroupStatus(
  group: SuckerGroupQuery["suckerGroup"],
  projectId?: number,
  chainId?: number,
): IndexedReadStatus {
  if (!group) return "missing";
  const projects = group.projects?.items;
  if (!projects?.length) return "incomplete";
  if (
    projectId !== undefined &&
    (chainId === undefined ||
      !projects.some((project) => matchesProjectRef(project, [{ projectId, chainId, version: 6 }])))
  ) {
    return "incomplete";
  }
  return "available";
}

export function projectIndexMessage(status: ProjectIndexStatus): string {
  if (status.project === "unavailable" || status.group === "unavailable") {
    return "The project data request failed. Some details are unavailable.";
  }
  if (status.project === "available" && status.group === "available") {
    return "The project data service returned this project's records. Freshness has not been verified.";
  }
  return "Some project records are missing or incomplete. Some details are unavailable.";
}
