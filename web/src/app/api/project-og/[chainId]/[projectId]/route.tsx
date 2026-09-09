import { getProject } from "@/app/[slug]/getProject";
import { getSuckerGroup } from "@/app/[slug]/getSuckerGroup";
import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

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
    ? await getSuckerGroup(project.suckerGroupId, chainId)
    : null;
  const deployments = suckerGroup?.projects?.items ?? [];
  const balance = formatProjectPreviewBalance(deployments);
  const paymentsCount = suckerGroup?.paymentsCount ?? 0;
  const name = project.name ?? `Project ${projectId}`;
  const tagline =
    projectPreviewSlogan(project.projectTagline, project.description) ||
    "An autonomous business model for the open web.";

  // Not `request.nextUrl.origin`: behind the platform proxy that is the container's bind
  // address, which this renderer cannot fetch, and the card silently loses its logo.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const imageUrl = new URL(`/api/project-image/${chainId}/${projectId}`, origin).href;

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
        <div
          style={{
            display: "flex",
            fontSize: name.length > 28 ? 56 : 68,
            fontWeight: 700,
            lineHeight: 1.05,
          }}
        >
          {name}
        </div>
        <div
          style={{
            color: "#2c3f36",
            display: "flex",
            fontSize: 32,
            lineHeight: 1.3,
            marginTop: "22px",
          }}
        >
          {tagline}
        </div>

        <div style={{ display: "flex", gap: 48, marginTop: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#4d6459", display: "flex", fontSize: 26 }}>Balance</div>
            <div
              style={{
                display: "flex",
                fontSize: balance.length > 14 ? 48 : 60,
                fontWeight: 700,
                marginTop: 6,
              }}
            >
              {balance}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#4d6459", display: "flex", fontSize: 26 }}>Payments</div>
            <div style={{ display: "flex", fontSize: 60, fontWeight: 700, marginTop: 6 }}>
              {paymentsCount.toLocaleString("en-US")}
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
