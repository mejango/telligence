import { ProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { cache } from "react";

export const getProject = cache(async (projectId: number | bigint, chainId: number) => {
  try {
    const result = await queryBendystraw(chainId, ProjectOperation, {
      projectId: Number(projectId),
      chainId,
      version: 6,
    });
    return result.project;
  } catch (err) {
    console.error((err as Error).message);
    return null;
  }
});
