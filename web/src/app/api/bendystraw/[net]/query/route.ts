import { getBrowserOperationById } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { BendystrawRequestError as BendystrawError } from "@bananapus/nana-sdk-core";
import { NextRequest } from "next/server";

const MAX_REQUEST_BYTES = 32 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ net: string }> }) {
  const { net } = await params;
  if (net !== "mainnet" && net !== "testnet") {
    return Response.json({ error: "unsupported network" }, { status: 404 });
  }
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "content type must be application/json" }, { status: 415 });
  }

  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_REQUEST_BYTES) {
    return Response.json({ error: "request is too large" }, { status: 413 });
  }
  const bytes = await readBoundedBody(req.body, MAX_REQUEST_BYTES);
  if (!bytes) {
    return Response.json({ error: "request is too large" }, { status: 413 });
  }

  let body: { operation?: unknown; variables?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as {
      operation?: unknown;
      variables?: unknown;
    };
  } catch {
    return Response.json({ error: "invalid JSON request" }, { status: 400 });
  }
  if (
    typeof body.operation !== "string" ||
    typeof body.variables !== "object" ||
    body.variables === null ||
    Array.isArray(body.variables)
  ) {
    return Response.json({ error: "invalid operation request" }, { status: 400 });
  }

  const operation = getBrowserOperationById(body.operation);
  if (!operation || !operation.validateVariables(body.variables)) {
    return Response.json({ error: "invalid operation request" }, { status: 400 });
  }

  // Only the mainnet/testnet distinction matters to URL selection. Using a
  // representative chain keeps the upstream address entirely server-owned.
  const representativeChainId = net === "testnet" ? 11155111 : 1;
  try {
    const data = await queryBendystraw(
      representativeChainId,
      operation as never,
      body.variables as never,
    );
    return Response.json(
      { data },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof BendystrawError && error.status && error.status >= 400
        ? error.status
        : (error as { name?: string }).name === "TimeoutError"
          ? 504
          : 502;
    const clientStatus = status >= 500 ? status : 400;
    return Response.json(
      {
        error:
          clientStatus === 504
            ? "Bendystraw timed out"
            : clientStatus >= 500
              ? "Bendystraw unavailable"
              : "invalid operation request",
      },
      { status: clientStatus },
    );
  }
}
