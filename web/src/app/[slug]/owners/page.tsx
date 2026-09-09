import { notFound } from "next/navigation";
import { V6OwnersTab } from "../components/v6/owners/V6OwnersTab";
import { projectItemsWithFallback } from "../components/v6/shared";
import { getProjectWithFallback } from "../getProjectFallback";
import { getSuckerGroup } from "../getSuckerGroup";
import { resolveProjectRoute } from "../resolveProjectRoute.server";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function Owners(props: Props) {
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
  return (
    <V6OwnersTab
      projects={projectItemsWithFallback(suckerGroup?.projects?.items, project, chainId, projectId)}
    />
  );
}
