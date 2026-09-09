import { Nav } from "@/components/layout/Nav";
import { getEnsPublicClient } from "@/lib/ensPublicClient.server";
import { ipfsUriToGatewayUrl } from "@/lib/ipfs";
import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { readExactProjectHandle } from "@/lib/projectHandles";
import { decodeProjectRouteSlug, slugFor } from "@/lib/slug";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { PropsWithChildren } from "react";
import { ActivityFeed } from "./components/ActivityFeed/ActivityFeed";
import { Header } from "./components/Header/Header";
import { NewProjectNotice } from "./components/NewProjectNotice";
import { PayCard } from "./components/PayCard/PayCard";
import { ResponsiveProjectLayout } from "./components/ResponsiveProjectLayout";
import { ShopCartProvider } from "./components/v6/ShopCartContext";
import { getProject } from "./getProject";
import { getProjectWithFallback } from "./getProjectFallback";
import { getIndexedProjectOperatorAddresses, getProjectOperator } from "./getProjectOperator";
import { getSuckerGroup } from "./getSuckerGroup";
import { ProjectProviders } from "./ProjectProviders";
import { resolveProjectRoute } from "./resolveProjectRoute.server";
import { getRulesets } from "./terms/getRulesets";

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

/**
 * The verified handle names the revnet, so it is the canonical URL for every
 * route that reaches it — each chain's slug and the handle itself. The
 * registry keys handles by (chainId, projectId), so every deployment in the
 * group is checked, and only the operator (the callable authority) counts as
 * a trusted setter. handleOf() already enforces the bidirectional ENS check.
 */
const lookupCanonicalHandle = unstable_cache(
  async (
    chainId: number,
    projectId: number,
    suckerGroupId: string | null,
  ): Promise<string | null> => {
    const operators = await getIndexedProjectOperatorAddresses(projectId, chainId).catch(() => []);
    if (!operators.length) return null;
    const deployments: [number, number][] = [[chainId, projectId]];
    if (suckerGroupId) {
      const group = await getSuckerGroup(suckerGroupId, chainId);
      for (const sibling of group?.projects?.items ?? []) {
        const pair: [number, number] = [Number(sibling.chainId), Number(sibling.projectId)];
        if (!deployments.some(([chain, id]) => chain === pair[0] && id === pair[1])) {
          deployments.push(pair);
        }
      }
    }
    const client = getEnsPublicClient();
    const handles = await Promise.all(
      deployments.flatMap(([chain, id]) =>
        operators.map((operator) => readExactProjectHandle(client, chain, id, operator)),
      ),
    );
    return handles.find((handle) => handle) ?? null;
  },
  ["telligence-project-canonical-handle-base"],
  { revalidate: 900 },
);

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
    const description = "An autonomous business model for the open web. 100% open source.";
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
    ? await getSuckerGroup(project.suckerGroupId, chainId)
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
      projectPreviewSlogan(project?.projectTagline, project?.description) ||
      "An autonomous business model for the open web. 100% open source.",
    imageUrl,
    url: canonicalUrl.href,
  });
}

export default async function SlugLayout({ children, params }: PropsWithChildren<Props>) {
  const { slug } = await params;
  const route = await resolveProjectRoute(slug);
  if (!route) notFound();
  const { chainId, projectId } = route;

  const resolved = await getProjectWithFallback(projectId, chainId);
  if (!resolved) notFound();
  const { project } = resolved;

  // `undefined` = the operator could not be read, which is not the same claim
  // as `null` ("nobody holds the role"). The header says so instead of quietly
  // dropping the operator line.
  const operatorPromise = route.verifiedOperator
    ? Promise.resolve({ address: route.verifiedOperator })
    : getProjectOperator(Number(projectId), chainId).catch(() => undefined);
  const suckerGroupPromise = project.suckerGroupId
    ? getSuckerGroup(project.suckerGroupId, chainId)
    : Promise.resolve(null);
  const isRevnet = project.isRevnet !== false;
  const rulesetsPromise = isRevnet
    ? getRulesets(projectId.toString(), chainId)
    : Promise.resolve([]);

  const [indexedSuckerGroup, rulesets] = await Promise.all([suckerGroupPromise, rulesetsPromise]);

  // A missing sucker group means the indexer hasn't caught up (or is down),
  // not that the project is gone: render a degraded page from what the chain
  // provides instead of a false 404.
  const degraded = resolved.degraded || !indexedSuckerGroup;
  const suckerGroup = indexedSuckerGroup ?? {
    id: project.suckerGroupId,
    paymentsCount: 0,
    tokenSupply: "0",
    volumeUsd: "0",
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
  const startDate = rulesets[0]?.start;

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
      <ProjectProviders
        chainId={chainId}
        projectId={projectId}
        project={project}
        projects={projects}
      >
        <ShopCartProvider>
          <div id="project-top">
            <Nav wide />
          </div>

          {degraded && (
            <div className="w-full px-4 sm:container pt-4">
              <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This project was found onchain but hasn't finished indexing. Some stats may be
                missing or out of date.
              </p>
            </div>
          )}
          <div className="w-full px-4 sm:container pt-6">
            <Header
              isRevnet={isRevnet}
              operatorPromise={operatorPromise}
              projects={projects}
              createdAt={project.createdAt}
            />
          </div>
          {isRevnet ? (
            <ResponsiveProjectLayout
              sidebar={
                <>
                  {startDate && <NewProjectNotice startDate={startDate} />}
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
      </ProjectProviders>
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
