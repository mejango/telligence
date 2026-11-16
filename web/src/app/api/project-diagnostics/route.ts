import { isSupportedChainId } from "@/app/constants";
import { readProjectDiagnostics } from "@/lib/projectDiagnostics.server";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

/** Public, read-only evidence for one supported project; never accepts an RPC URL. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const chainId = Number(params.get("chainId"));
  const projectId = Number(params.get("projectId"));
  const operator = params.get("operator") || undefined;
  const headers = { "Cache-Control": "no-store" };
  if (
    !Number.isSafeInteger(chainId) ||
    !isSupportedChainId(chainId) ||
    !Number.isSafeInteger(projectId) ||
    projectId <= 0 ||
    (operator !== undefined && !isAddress(operator))
  ) {
    return NextResponse.json({ error: "Invalid project or operator." }, { status: 400, headers });
  }
  try {
    const report = await readProjectDiagnostics(chainId, BigInt(projectId), operator);
    return NextResponse.json(report, { headers });
  } catch {
    return NextResponse.json(
      { error: "Deployment checks are unavailable." },
      { status: 503, headers },
    );
  }
}
