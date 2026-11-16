import { getProject } from "@/app/[slug]/getProject";
import { getSuckerGroup } from "@/app/[slug]/getSuckerGroup";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { REVNET_ONE_LINER } from "@/lib/one-liner";
import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const LOGO_MAX_BYTES = 8 * 1024 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 6_000;

/**
 * The logo as a 360px PNG data URI, or null. Satori only draws PNG, JPEG, GIF
 * and SVG, so a webp/avif logo rendered as a blank square; a fetch it cannot
 * complete rendered the same. Converting here covers every format sharp reads
 * and keeps the card independent of the renderer's own network reach.
 */
async function logoDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!response.ok) return null;
    if (Number(response.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > LOGO_MAX_BYTES) return null;
    const png = await sharp(Buffer.from(buffer), { animated: false })
      .resize(360, 360, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A headline size the 704px column fits in two lines at 700 weight. */
function nameFontSize(name: string): number {
  if (name.length > 48) return 40;
  if (name.length > 34) return 48;
  if (name.length > 22) return 56;
  return 68;
}

/**
 * One size for both stat values so the pair fits the 704px column on one
 * line: bold digits run about 0.66em wide, and the gap between them is 48px.
 */
function statFontSize(balance: string, payments: string): number {
  const fitted = Math.floor((704 - 48) / (0.66 * (balance.length + payments.length)));
  return Math.max(32, Math.min(60, fitted));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; projectId: string }> },
) {
  const raw = await params;
  const chainId = Number(raw.chainId);
  const projectId = Number(raw.projectId);
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !Number.isSafeInteger(projectId) ||
    projectId < 0
  ) {
    return new Response(null, { status: 400 });
  }
  const project = await getProject(projectId, chainId);
  if (!project) return new Response(null, { status: 404 });

  const suckerGroup = project.suckerGroupId
    ? await getSuckerGroup(project.suckerGroupId, chainId, projectId)
    : null;
  const deployments = suckerGroup?.projects?.items ?? [];
  const balance = formatProjectPreviewBalance(deployments);
  const paymentsCount = suckerGroup?.paymentsCount ?? 0;
  const name = project.name ?? `Project ${projectId}`;
  const tagline =
    projectPreviewSlogan(project.projectTagline, project.description) || REVNET_ONE_LINER;

  // Not `request.nextUrl.origin`: behind the platform proxy that is the container's bind
  // address, which this renderer cannot fetch, and the card silently loses its logo.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  // The gateway copy of an ipfs:// logo is fetched and transcoded directly; anything
  // else (inline data images, the initial fallback) still comes through project-image.
  const imageUrl =
    (await logoDataUri(
      ipfsUriToAppUrl(project.logoUri) ??
        new URL(`/api/project-image/${chainId}/${projectId}`, origin).href,
    )) ?? new URL(`/api/project-image/${chainId}/${projectId}`, origin).href;
  const payments = paymentsCount.toLocaleString("en-US");
  const statSize = statFontSize(balance, payments);

  return new ImageResponse(
    <div
      style={{
        background: "#f5fcf8",
        color: "#15281f",
        display: "flex",
        height: "100%",
        padding: "64px 72px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          height: 360,
          justifyContent: "center",
          overflow: "hidden",
          width: 360,
        }}
      >
        {/* Satori rejects string width/height ("Invalid value 360…") and then renders nothing,
            which left a hole where every project logo belongs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" width={360} height={360} style={{ objectFit: "contain" }} />
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          marginLeft: "64px",
          minWidth: 0,
        }}
      >
        {/* Satori does not clip overflow: an unclamped name or tagline runs
            straight through the stats below, so both are held to two lines and
            the stats refuse to shrink. */}
        <div
          style={{
            display: "block",
            fontSize: nameFontSize(name),
            fontWeight: 700,
            lineClamp: 2,
            lineHeight: 1.05,
          }}
        >
          {name}
        </div>
        <div
          style={{
            color: "#2c3f36",
            display: "block",
            fontSize: 32,
            lineClamp: 2,
            lineHeight: 1.3,
            marginTop: "22px",
          }}
        >
          {tagline}
        </div>

        <div style={{ display: "flex", flexShrink: 0, gap: 48, marginTop: "auto", paddingTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#4d6459", display: "flex", fontSize: 26 }}>Balance</div>
            <div style={{ display: "flex", fontSize: statSize, fontWeight: 700, marginTop: 6 }}>
              {balance}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#4d6459", display: "flex", fontSize: 26 }}>Payments</div>
            <div style={{ display: "flex", fontSize: statSize, fontWeight: 700, marginTop: 6 }}>
              {payments}
            </div>
          </div>
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
