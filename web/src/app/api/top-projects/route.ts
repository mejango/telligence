import { getTopProjects } from "@/app/getTopProjects";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const projects = await getTopProjects(limit + 1, offset);
  return NextResponse.json({
    projects: projects.slice(0, limit),
    hasMore: projects.length > limit,
  });
}
