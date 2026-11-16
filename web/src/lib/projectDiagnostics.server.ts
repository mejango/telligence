import "server-only";

import type { JBChainId } from "@bananapus/nana-sdk-core";
import { getProjectDeploymentDiagnostics } from "@bananapus/nana-sdk-core/v6";
import type { Address } from "viem";
import { ProjectOperation, SuckerGroupOperation } from "./bendystraw/operations";
import { queryBendystraw } from "./bendystraw/query.server";
import {
  indexedGroupStatus,
  indexedProjectStatus,
  type ProjectIndexStatus,
} from "./projectIndexStatus";
import { getViemPublicClient } from "./wagmiTransports";

async function readProjectIndexStatus(
  chainId: JBChainId,
  projectId: bigint,
): Promise<ProjectIndexStatus> {
  try {
    const { project } = await queryBendystraw(chainId, ProjectOperation, {
      chainId,
      projectId: Number(projectId),
      version: 6,
    });
    const status = indexedProjectStatus(project);
    if (!project?.suckerGroupId) return { project: status, group: "not-checked" };
    try {
      const { suckerGroup } = await queryBendystraw(chainId, SuckerGroupOperation, {
        id: project.suckerGroupId,
      });
      return {
        project: status,
        group: indexedGroupStatus(suckerGroup, Number(projectId), chainId),
      };
    } catch {
      return { project: status, group: "unavailable" };
    }
  } catch {
    return { project: "unavailable", group: "not-checked" };
  }
}

export async function readProjectDiagnostics(
  chainId: JBChainId,
  projectId: bigint,
  operator?: Address,
) {
  const [deployment, indexer] = await Promise.all([
    getProjectDeploymentDiagnostics(getViemPublicClient(chainId), {
      chainId,
      projectId,
      operator,
    }).catch(() => null),
    readProjectIndexStatus(chainId, projectId),
  ]);
  return { deployment, indexer };
}
