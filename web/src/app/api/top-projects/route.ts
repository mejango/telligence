import { getTopProjects } from "@/app/getTopProjects";
import { NextResponse } from "next/server";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 32;

function pageParam(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = pageParam(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = pageParam(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const projects = await getTopProjects(limit + 1, offset);
  return NextResponse.json(
    { projects: projects.slice(0, limit), hasMore: projects.length > limit },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400" } },
  );
}
