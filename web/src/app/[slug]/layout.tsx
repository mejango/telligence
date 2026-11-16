import { Nav } from "@/components/layout/Nav";
import { ProjectHeaderSkeleton, ProjectPageSkeleton } from "@/components/loading/LoadingSkeletons";
import { ipfsUriToGatewayUrl } from "@/lib/ipfs";
import { REVNET_ONE_LINER } from "@/lib/one-liner";
import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { indexedGroupStatus } from "@/lib/projectIndexStatus";
import { decodeProjectRouteSlug, slugFor } from "@/lib/slug";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PropsWithChildren, Suspense } from "react";
import { lookupCanonicalHandle } from "./canonicalHandle.server";
import { ActivityFeed } from "./components/ActivityFeed/ActivityFeed";
import { Header } from "./components/Header/Header";
import { NewProjectNotice } from "./components/NewProjectNotice";
import { PayCard } from "./components/PayCard/PayCard";
import { ProjectContractWarning } from "./components/ProjectContractWarning";
import { ProjectDataNotice, ProjectDiagnosticsProvider } from "./components/ProjectDiagnostics";
import { PROJECT_SECTIONS_ID } from "./components/projectSections";
import { ResponsiveProjectLayout } from "./components/ResponsiveProjectLayout";
import { ShopCartProvider } from "./components/v6/ShopCartContext";
import { getProject } from "./getProject";
import { getProjectWithFallback } from "./getProjectFallback";
import { getProjectOperator } from "./getProjectOperator";
import { getIndexedSuckerGroup, getSuckerGroup } from "./getSuckerGroup";
import { ProjectProviders } from "./ProjectProviders";
import { ProjectRouteBoundary } from "./ProjectRouteBoundary";
import { projectRouteSnapshot } from "./projectRouteIdentity";
import { resolveProjectRoute } from "./resolveProjectRoute.server";
import { getRulesets, type Ruleset } from "./terms/getRulesets";

export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Machine-readable identity for search engines and agents, which otherwise have to
 * infer a revnet from rendered markup.
 */
function ProjectJsonLd({
  name,
  description,
  logoUri,
  path,
  identifier,
}: {
  name: string;
  description: string | null | undefined;
  logoUri: string | null | undefined;
  path: string;
  identifier: string;
}) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
  const logo = ipfsUriToGatewayUrl(String(logoUri ?? ""));
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: new URL(path, origin).href,
    identifier,
    ...(description ? { description } : {}),
    ...(logo ? { logo } : {}),
  };
  return (
    <script
      type="application/ld+json"
      // The name and tagline are untrusted project metadata: escaping `<` keeps a
      // crafted value from closing this script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</gu, "\\u003c") }}
    />
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
  // The custom domain is the public name; the Railway host is only the fallback for a
  // preview deployment that has no canonical domain of its own.
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const assetOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (railwayDomain && /^[a-z0-9.-]+$/iu.test(railwayDomain) ? `https://${railwayDomain}` : origin);
  const { slug: encodedSlug } = await params;
  const slug = decodeProjectRouteSlug(encodedSlug ?? "") ?? "";

  const url = new URL(`/${slug}`, origin);

  const route = await resolveProjectRoute(encodedSlug ?? "");
  if (!route) {
    const title = "Revnet";
    const description = REVNET_ONE_LINER;
    const imageUrl = new URL("/assets/img/revnet-social.png", assetOrigin).href;
    return buildMetadata({
      title,
      description,
      imageUrl,
      url: url.href,
    });
  }

  const { projectId, chainId } = route;
  const project = projectId ? await getProject(projectId, chainId) : null;
  // Scrapers cache og:image by URL, so bake the numbers into it: the card refreshes
  // whenever the balance or payment count moves.
  const suckerGroup = project?.suckerGroupId
    ? await getSuckerGroup(project.suckerGroupId, chainId, projectId)
    : null;
  const version = `${suckerGroup?.paymentsCount ?? 0}-${formatProjectPreviewBalance(
    suckerGroup?.projects?.items ?? [],
  ).replace(/\D/gu, "")}`;
  const imageUrl =
    project && projectId
      ? new URL(`/api/project-og/${chainId}/${projectId}?v=${version}`, assetOrigin).href
      : new URL("/assets/img/revnet-social.png", assetOrigin).href;

  // The handle is always canonical when present, no matter which of the
  // revnet's URLs — /@handle or any chain's slug — served this render.
  let canonicalUrl = url;
  if (!slug.startsWith("@") && projectId) {
    const handle = await lookupCanonicalHandle(
      chainId,
      Number(projectId),
      project?.suckerGroupId ?? null,
    ).catch(() => null);
    if (handle) canonicalUrl = new URL(`/@${encodeURIComponent(handle)}`, origin);
  }

  return buildMetadata({
    title: project?.name ? `${project.name} | REVNET` : "Revnet",
    description:
      projectPreviewSlogan(project?.projectTagline, project?.description) || REVNET_ONE_LINER,
    imageUrl,
    url: canonicalUrl.href,
  });
}

export default async function SlugLayout({ children, params }: PropsWithChildren<Props>) {
  // The bounded display cache owns reuse; never turn a cache hit into a
  // longer-lived Full Route Cache entry on a request that makes no new fetches.
  await connection();
  const { slug } = await params;
  const route = await resolveProjectRoute(slug);
  if (!route) notFound();
  const { chainId, projectId } = route;

  const resolved = await getProjectWithFallback(projectId, chainId);
  if (!resolved) notFound();

  // Existence and alias checks must finish before the first streamed byte so
  // missing projects retain their HTTP 404. Secondary display reads can stream.
  return (
    <Suspense
      fallback={
        <ProjectPageSkeleton
          hint={{
            name: resolved.project.name || `Revnet ${projectId}`,
            logoUri: resolved.project.logoUri,
          }}
        />
      }
    >
      <ProjectLayoutContent slug={slug} route={route} resolved={resolved}>
        {children}
      </ProjectLayoutContent>
    </Suspense>
  );
}

async function ProjectStartNotice({ rulesets }: { rulesets: Promise<Ruleset[] | null> }) {
  const stages = await rulesets;
  if (!stages)
    return (
      <p role="status" className="text-sm text-zinc-500">
        Start time is unavailable.
      </p>
    );
  const startDate = stages[0]?.start;
  return startDate ? <NewProjectNotice startDate={startDate} /> : null;
}

async function ProjectLayoutContent({
  children,
  slug,
  route,
  resolved,
}: PropsWithChildren<{
  slug: string;
  route: NonNullable<Awaited<ReturnType<typeof resolveProjectRoute>>>;
  resolved: NonNullable<Awaited<ReturnType<typeof getProjectWithFallback>>>;
}>) {
  const { chainId, projectId } = route;
  const { project } = resolved;

  // `undefined` = the operator could not be read, which is not the same claim
  // as `null` ("nobody holds the role"). The header says so instead of quietly
  // dropping the operator line.
  const operatorPromise = route.verifiedOperator
    ? Promise.resolve({ address: route.verifiedOperator })
    : getProjectOperator(Number(projectId), chainId).catch(() => undefined);
  const suckerGroupPromise = project.suckerGroupId
    ? getIndexedSuckerGroup(project.suckerGroupId, chainId, projectId)
    : Promise.resolve({ data: null, status: "not-checked" as const });
  // Alias verification already proved the live REVOwner; the indexed flag may lag.
  const isRevnet = Boolean(route.verifiedOperator) || project.isRevnet !== false;
  const rulesetsPromise = isRevnet
    ? getRulesets(projectId.toString(), chainId).catch(() => null)
    : Promise.resolve([]);

  const indexedGroup = await suckerGroupPromise;

  const indexStatus = {
    project: resolved.indexStatus,
    group:
      indexedGroup.status === "unavailable" || indexedGroup.status === "not-checked"
        ? indexedGroup.status
        : indexedGroupStatus(indexedGroup.data, Number(projectId), chainId),
  };
  const degraded = resolved.degraded || indexStatus.group !== "available";
  // Incomplete groups must not omit the requested project or leave the header with no rows.
  const suckerGroup = (indexStatus.group === "available" ? indexedGroup.data : null) ?? {
    id: project.suckerGroupId,
    projects: {
      items: [
        {
          balance: "0",
          chainId,
          currency: project.currency,
          decimals: project.decimals,
          projectId: Number(projectId),
          suckerGroupId: project.suckerGroupId,
          token: project.token,
          tokenSymbol: project.tokenSymbol,
          tokenSupply: "0",
          version: project.version,
        },
      ],
    },
  };

  const projects = suckerGroup.projects?.items ?? [];

  return (
    <>
      {/* Outside the client providers on purpose: inside them React ships this in the
          flight payload instead of the HTML, so a crawler that does not run JS — which
          is most agents — would never see it. */}
      <ProjectJsonLd
        name={project.name || `Revnet ${projectId}`}
        description={projectPreviewSlogan(project.projectTagline, project.description)}
        logoUri={project.logoUri}
        path={`/${decodeProjectRouteSlug(slug) ?? slug}`}
        identifier={slugFor(chainId, projectId) ?? `${chainId}:${projectId}`}
      />
      <ProjectRouteBoundary slug={slug} snapshot={projectRouteSnapshot(route)}>
        <ProjectProviders
          chainId={chainId}
          projectId={projectId}
          project={project}
          projects={projects}
        >
          <ProjectDiagnosticsProvider chainId={chainId} projectId={projectId}>
            <ShopCartProvider scope={project.suckerGroupId || `${chainId}:${projectId}`}>
              <div id="project-top">
                <Nav wide skipTo={isRevnet ? PROJECT_SECTIONS_ID : undefined} />
              </div>

              {degraded && (
                <div className="w-full px-4 sm:container pt-4">
                  <ProjectDataNotice
                    status={indexStatus}
                    project={{
                      chainId,
                      projectId: Number(projectId),
                      groupId: project.suckerGroupId,
                    }}
                  />
                </div>
              )}
              <div className="w-full px-4 sm:container empty:hidden pt-4">
                <ProjectContractWarning projects={projects} isRevnet={isRevnet} />
              </div>
              <div className="w-full px-4 sm:container pt-6">
                <Suspense
                  fallback={
                    <ProjectHeaderSkeleton
                      hint={{
                        name: project.name || `Revnet ${projectId}`,
                        logoUri: project.logoUri,
                      }}
                    />
                  }
                >
                  <Header
                    isRevnet={isRevnet}
                    operatorPromise={operatorPromise}
                    projects={projects}
                    createdAt={project.createdAt}
                  />
                </Suspense>
              </div>
              {isRevnet ? (
                <ResponsiveProjectLayout
                  sidebar={
                    <>
                      <Suspense
                        fallback={
                          <p role="status" className="text-sm text-zinc-500">
                            Loading start time…
                          </p>
                        }
                      >
                        <ProjectStartNotice rulesets={rulesetsPromise} />
                      </Suspense>
                      <div className="mt-1 mb-4">
                        <PayCard />
                      </div>
                    </>
                  }
                  activity={<ActivityFeed suckerGroupId={suckerGroup.id} projects={projects} />}
                >
                  {children}
                </ResponsiveProjectLayout>
              ) : null}
            </ShopCartProvider>
          </ProjectDiagnosticsProvider>
        </ProjectProviders>
      </ProjectRouteBoundary>
    </>
  );
}

function buildMetadata({
  title,
  description,
  imageUrl,
  url,
}: {
  title: string;
  description: string;
  imageUrl: string;
  url: string;
}): Metadata {
  return {
    title,
    // Search results and agents read the page description; only the social cards
    // carried one before.
    description,
    // A revnet answers at /@handle and /<chain>:<id> alike. Name one.
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${title} preview image`,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}
