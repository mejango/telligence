import { notFound } from "next/navigation";
import { V6TermsTab } from "../components/v6/terms/V6TermsTab";
import { getProjectWithFallback } from "../getProjectFallback";
import { resolveProjectRoute } from "../resolveProjectRoute.server";
import { getRulesets } from "./getRulesets";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function Terms({ params }: Props) {
  const { slug } = await params;
  const route = await resolveProjectRoute(slug);
  if (!route) notFound();
  const { chainId, projectId } = route;

  // Resolve through the on-chain fallback, exactly as the layout does. Bendystraw being
  // down returns null from the indexed read, which is indistinguishable from a project that
  // doesn't exist — 404-ing on it tells the owner of a live project that it was deleted.
  const resolved = await getProjectWithFallback(projectId, chainId);
  if (!resolved) notFound();

  const rulesets = await getRulesets(projectId.toString(), chainId);

  return <V6TermsTab rulesets={rulesets} />;
}
