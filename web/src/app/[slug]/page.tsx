import { CardSkeleton } from "@/components/loading/CardSkeleton";
import { notFound } from "next/navigation";
import { Suspense, type ComponentProps } from "react";
import { LazyTokenPriceChart } from "./components/TokenPrice/LazyTokenPriceChart";
import { V6OverviewTab } from "./components/v6/overview/V6OverviewTab";
import { projectItemsWithFallback } from "./components/v6/shared";
import { getProjectWithFallback } from "./getProjectFallback";
import { getSuckerGroup } from "./getSuckerGroup";
import { ProjectPageBoundary } from "./ProjectRouteContext";
import { projectRouteSnapshot } from "./projectRouteIdentity";
import { resolveProjectRoute } from "./resolveProjectRoute.server";
import { getRulesets } from "./terms/getRulesets";

interface Props {
  params: Promise<{ slug: string }>;
}

async function StartedProjectChart(props: ComponentProps<typeof LazyTokenPriceChart>) {
  const rulesets = await getRulesets(props.projectId, props.chainId).catch(() => null);
  if (!rulesets) return <p role="status">Price history is unavailable.</p>;
  const startDate = rulesets[0]?.start;
  return !startDate || startDate <= Math.floor(Date.now() / 1000) ? (
    <LazyTokenPriceChart {...props} />
  ) : null;
}

export default async function AboutPage(props: Props) {
  const { slug } = await props.params;
  const route = await resolveProjectRoute(slug);
  if (!route) notFound();
  const { chainId, projectId } = route;

  // Resolve through the on-chain fallback, exactly as the layout does. Bendystraw being
  // down returns null from the indexed read, which is indistinguishable from a project that
  // doesn't exist — 404-ing on it tells the owner of a live project that it was deleted.
  const resolved = await getProjectWithFallback(projectId, chainId);
  if (!resolved) notFound();
  const { project } = resolved;

  const suckerGroup = await getSuckerGroup(project.suckerGroupId, chainId, projectId);
  const projects = projectItemsWithFallback(
    suckerGroup?.projects?.items,
    project,
    chainId,
    projectId,
  );

  return (
    <ProjectPageBoundary snapshot={projectRouteSnapshot(route)}>
      <div className="flex flex-col gap-6">
        {/* A missing accounting context means NOT YET INDEXED, never ETH/18 (tokenUtils.ts:44-48).
          Defaulting here rendered a USDC project's floor history divided by 1e18 and labelled
          ETH — off by twelve orders of magnitude under a wrong symbol. Wait for the real
          context instead. */}
        {suckerGroup && project.token && project.decimals != null && (
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <StartedProjectChart
              projectId={projectId.toString()}
              chainId={chainId}
              suckerGroupId={suckerGroup.id}
              token={project.token}
              tokenSymbol={project.tokenSymbol ?? ""}
              tokenDecimals={project.decimals}
            />
          </Suspense>
        )}
        <V6OverviewTab projects={projects} />
      </div>
    </ProjectPageBoundary>
  );
}
