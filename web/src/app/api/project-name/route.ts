import { getProject } from "@/app/[slug]/getProject";
import { NextRequest, NextResponse } from "next/server";

/** Resolve one exact-chain revnet project ID for form-field subtext. */
export async function GET(request: NextRequest) {
  const chainId = Number(request.nextUrl.searchParams.get("chainId"));
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !Number.isSafeInteger(projectId) ||
    projectId <= 0
  ) {
    return NextResponse.json({ error: "Bad params" }, { status: 400 });
  }

  const project = await getProject(projectId, chainId);
  if (!project || project.isRevnet !== true) {
    return NextResponse.json({ found: false, name: null, suckerGroupId: null });
  }
  return NextResponse.json({
    found: true,
    name: project.name || project.handle || null,
    suckerGroupId: project.suckerGroupId || null,
  });
}
