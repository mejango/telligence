import { IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedProjectSummary } from "@/lib/bendystraw/types";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const projects: IndexedProjectSummary[] = [];
    let totalCount = 0;
    do {
      const data = await queryBendystraw(1, IndexedProjectsOperation, {
        where: { AND: [{ version: 6 }, { isRevnet: true }] },
        orderBy: "createdAt",
        orderDirection: "desc",
        limit: 250,
        offset: projects.length,
      });
      const page = data.projects.items;
      totalCount = data.projects.totalCount;
      projects.push(...page);
      if (!page.length) break;
    } while (projects.length < totalCount);
    const groups = new Map<
      string,
      { representative: IndexedProjectSummary; members: IndexedProjectSummary[] }
    >();

    for (const project of projects) {
      const key = project.suckerGroupId ?? `${project.chainId}:${project.projectId}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { representative: project, members: [project] });
        continue;
      }
      group.members.push(project);
      if (BigInt(project.volume || "0") > BigInt(group.representative.volume || "0")) {
        group.representative = project;
      }
    }

    return NextResponse.json(
      {
        projects: Array.from(groups.values())
          .map(({ representative, members }) => ({
            ...representative,
            chainIds: Array.from(new Set(members.map((member) => member.chainId))),
          }))
          .filter((project) => project.name || project.projectTagline),
      },
      {
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return NextResponse.json({ projects: [] }, { status: 503 });
  }
}
