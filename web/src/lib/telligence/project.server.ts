import "server-only";

import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { validatedGatewayOrigin } from "./gatewayOrigin.server";
import { parseProjectResponse, parseProjectsResponse } from "./project-data";

/** Public SEO reads use the fixed deployment origin, never a request-supplied URL. */
async function publicGatewayRead(path: string): Promise<unknown> {
  const configured = process.env.TELLIGENCE_GATEWAY_URL;
  if (!configured) return null;
  const origin = validatedGatewayOrigin(configured);
  const response = await fetch(new URL(path, origin).href, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(4000),
    next: { revalidate: 60 },
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    return null;
  const bytes = await readBoundedBody(response.body, 4 * 1024 * 1024);
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function readComputeProjects() {
  try {
    const data = await publicGatewayRead("/v1/projects");
    return data ? parseProjectsResponse(data) : [];
  } catch {
    // An unavailable index must not remove the static sitemap or fabricate projects.
    return [];
  }
}

export async function readComputeProject(projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) return null;
  try {
    const data = await publicGatewayRead(`/v1/projects/${encodeURIComponent(projectId)}`);
    return data ? parseProjectResponse(data, projectId) : null;
  } catch {
    return null;
  }
}
