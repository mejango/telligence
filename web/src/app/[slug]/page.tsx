import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LazyTokenPriceChart } from "./components/TokenPrice/LazyTokenPriceChart";
import { V6OverviewTab } from "./components/v6/overview/V6OverviewTab";
import { projectItemsWithFallback } from "./components/v6/shared";
import { getProjectWithFallback } from "./getProjectFallback";
import { getSuckerGroup } from "./getSuckerGroup";
import { resolveProjectRoute } from "./resolveProjectRoute.server";
import { getRulesets } from "./terms/getRulesets";

interface Props {
  params: Promise<{ slug: string }>;
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

  const suckerGroup = await getSuckerGroup(project.suckerGroupId, chainId);
  const projects = projectItemsWithFallback(
    suckerGroup?.projects?.items,
    project,
    chainId,
    projectId,
  );

  const rulesets = await getRulesets(projectId.toString(), chainId);
  const startDate = rulesets[0]?.start;
  const hasStarted = !startDate || startDate <= Math.floor(Date.now() / 1000);

  return (
    <div className="flex flex-col gap-6">
      {/* A missing accounting context means NOT YET INDEXED, never ETH/18 (tokenUtils.ts:44-48).
          Defaulting here rendered a USDC project's floor history divided by 1e18 and labelled
          ETH — off by twelve orders of magnitude under a wrong symbol. Wait for the real
          context instead. */}
      {hasStarted && suckerGroup && project.token && project.decimals != null && (
        <Suspense>
          <LazyTokenPriceChart
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
  );
}
