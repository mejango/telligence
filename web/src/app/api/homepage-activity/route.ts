import { getHomepageActivityPage } from "@/app/getHomepageActivity";
import { readActivityRows } from "@/app/homepageActivityRows";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  // `rows` pages by feed row: a row holds every event of one transaction.
  const rows = Number(url.searchParams.get("rows"));
  if (rows >= 1) {
    return NextResponse.json(
      await readActivityRows(getHomepageActivityPage, Math.min(24, Math.floor(rows)), offset),
    );
  }
  const events = await getHomepageActivityPage(limit + 1, offset);
  return NextResponse.json({ events: events.slice(0, limit), hasMore: events.length > limit });
}
