import { notFound } from "next/navigation";
import { V6OperatorTab } from "../components/v6/operator/V6OperatorTab";
import { projectItemsWithFallback } from "../components/v6/shared";
import { getProjectWithFallback } from "../getProjectFallback";
import { getProjectOperator } from "../getProjectOperator";
import { getSuckerGroup } from "../getSuckerGroup";
import { resolveProjectRoute } from "../resolveProjectRoute.server";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function OperatorPage(props: Props) {
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

  // Only a fallback for the client-side permission-holder query below, which
  // carries its own error state — a failed read must not take the page down.
  const operator =
    route.verifiedOperator ??
    (await getProjectOperator(Number(projectId), chainId).catch(() => undefined))?.address;

  return (
    <V6OperatorTab
      projects={projects}
      operator={operator}
      handleProject={{ chainId, projectId: Number(projectId) }}
    />
  );
}
