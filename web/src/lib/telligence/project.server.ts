import "server-only";

import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { validatedGatewayOrigin } from "./gatewayOrigin.server";
import { parseProjectResponse, parseProjectsResponse } from "./project-data";

export const PUBLIC_READ_CACHE_LIMIT = 500;
type PublicRead = { data: unknown; stale: boolean; at: string };
/** Last successful body per path, so an outage never blanks a project's public purpose. */
const lastKnownGood = new Map<string, { data: unknown; at: string }>();

function remember(path: string, data: unknown): PublicRead {
  const at = new Date().toISOString();
  lastKnownGood.delete(path);
  if (lastKnownGood.size >= PUBLIC_READ_CACHE_LIMIT) {
    const oldest = lastKnownGood.keys().next().value;
    if (oldest !== undefined) lastKnownGood.delete(oldest);
  }
  lastKnownGood.set(path, { data, at });
  return { data, stale: false, at };
}

/** Public SEO reads use the fixed deployment origin, never a request-supplied URL. */
async function publicGatewayRead(path: string): Promise<PublicRead | null> {
  const configured = process.env.TELLIGENCE_GATEWAY_URL;
  if (!configured) return null;
  const origin = validatedGatewayOrigin(configured);
  try {
    const response = await fetch(new URL(path, origin).href, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 60 },
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
      throw new Error("The compute gateway did not answer with JSON.");
    const bytes = await readBoundedBody(response.body, 4 * 1024 * 1024);
    if (!bytes) throw new Error("The compute gateway response was too large.");
    return remember(path, JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    const saved = lastKnownGood.get(path);
    return saved ? { ...saved, stale: true } : null;
  }
}

export async function readComputeProjects() {
  try {
    const read = await publicGatewayRead("/v1/projects");
    return read ? parseProjectsResponse(read.data) : [];
  } catch {
    // An unavailable index must not remove the static sitemap or fabricate projects.
    return [];
  }
}

/** The project plus whether it is the last saved copy and when that copy was read. */
export async function readComputeProjectRecord(projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) return null;
  try {
    const read = await publicGatewayRead(`/v1/projects/${encodeURIComponent(projectId)}`);
    if (!read) return null;
    return { project: parseProjectResponse(read.data, projectId), stale: read.stale, at: read.at };
  } catch {
    return null;
  }
}

export async function readComputeProject(projectId: string) {
  return (await readComputeProjectRecord(projectId))?.project ?? null;
}
