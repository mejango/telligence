import {
  IndexedProjectsOperation,
  IndexedSuckerGroupOperation,
  ProjectErc20TickersOperation,
} from "@/lib/bendystraw/operations";
import { projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedProjectSummary } from "@/lib/bendystraw/types";
import { NextRequest, NextResponse } from "next/server";

type SearchProject = IndexedProjectSummary & { ticker: string | null };

export async function GET(request: NextRequest) {
  const text = (request.nextUrl.searchParams.get("q")?.trim() ?? "").replace(/^\$/u, "");
  if (text.length < 1 || text.length > 64) {
    return NextResponse.json({ projects: [] });
  }

  const numericId = /^\d+$/u.test(text) ? Number(text) : null;
  const validNumericId =
    numericId !== null && Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;

  try {
    const [nameData, idData, tickerData] = await Promise.all([
      queryBendystraw(1, IndexedProjectsOperation, {
        where: {
          AND: [{ version: 6 }, { isRevnet: true }, { name_contains_nocase: text }],
        },
        orderBy: "volume",
        orderDirection: "desc",
        limit: 32,
        offset: 0,
      }),
      validNumericId === null
        ? null
        : queryBendystraw(1, IndexedProjectsOperation, {
            where: {
              AND: [{ version: 6 }, { isRevnet: true }, { projectId: validNumericId }],
            },
            orderBy: "volume",
            orderDirection: "desc",
            limit: 32,
            offset: 0,
          }),
      queryBendystraw(1, ProjectErc20TickersOperation, {
        where: { symbol_contains_nocase: text },
        limit: 100,
        offset: 0,
      }),
    ]);

    const tickerByDeployment = new Map<string, string>();
    for (const event of tickerData.deployErc20Events.items) {
      tickerByDeployment.set(`${event.chainId}:${event.projectId}`, event.symbol);
    }
    const tickerRefs = Array.from(tickerByDeployment.keys()).map((pair) => {
      const [chainId, projectId] = pair.split(":").map(Number);
      return { chainId, projectId, version: 6 };
    });
    const tickerProjects =
      tickerRefs.length > 0
        ? (
            await queryBendystraw(1, IndexedProjectsOperation, {
              where: {
                AND: [{ isRevnet: true }, projectRefsWhere(tickerRefs)!],
              },
              orderBy: "volume",
              orderDirection: "desc",
              limit: 32,
              offset: 0,
            })
          ).projects.items
        : [];
    const matchedDeployments = new Map<string, IndexedProjectSummary>();
    const exactTickerProjects = tickerProjects.filter((project) =>
      tickerByDeployment.has(`${project.chainId}:${project.projectId}`),
    );
    for (const project of [
      ...nameData.projects.items,
      ...(idData?.projects.items ?? []),
      ...exactTickerProjects,
    ]) {
      matchedDeployments.set(`${project.chainId}:${project.projectId}`, project);
    }
    const matches: SearchProject[] = Array.from(matchedDeployments.values()).map((project) => ({
      ...project,
      ticker: tickerByDeployment.get(`${project.chainId}:${project.projectId}`) ?? null,
    }));
    const groups = new Map<string, { representative: SearchProject; members: SearchProject[] }>();
    for (const project of matches) {
      const key = project.suckerGroupId ?? `${project.chainId}:${project.projectId}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          representative: project,
          members: [project],
        });
      } else {
        group.members.push(project);
        if (BigInt(project.volume || "0") > BigInt(group.representative.volume || "0")) {
          group.representative = project;
        }
      }
    }

    const completeGroups = await Promise.all(
      Array.from(groups.values()).map(async (group) => {
        const id = group.representative.suckerGroupId;
        if (!id) return group;
        try {
          const groupData = await queryBendystraw(1, IndexedSuckerGroupOperation, { id });
          return {
            ...group,
            members:
              groupData.suckerGroup?.projects?.items?.map((member) => ({
                ...member,
                ticker: null,
              })) ?? group.members,
          };
        } catch {
          return group;
        }
      }),
    );

    return NextResponse.json({
      projects: completeGroups.map(({ representative, members }) => ({
        ...representative,
        ticker: representative.ticker ?? members.find((member) => member.ticker)?.ticker ?? null,
        chainIds: Array.from(new Set(members.map((member) => member.chainId))),
      })),
    });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
