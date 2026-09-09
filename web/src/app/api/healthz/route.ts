import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      revision: process.env.NEXT_PUBLIC_VERSION ?? "unknown",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
