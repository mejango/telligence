import { projectRouteSnapshot } from "@/app/[slug]/projectRouteIdentity";
import { resolveProjectRoute } from "@/app/[slug]/resolveProjectRoute.server";
import { decodeProjectRouteSlug } from "@/lib/slug";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (slug.length > 256 || !decodeProjectRouteSlug(slug)?.startsWith("@")) {
    return Response.json({ error: "Invalid handle" }, { status: 400, headers });
  }
  const route = await resolveProjectRoute(slug);
  if (!route?.verifiedOperator || route.checkedAt === undefined) {
    return Response.json({ error: "Unable to verify this handle" }, { status: 409, headers });
  }
  return Response.json({ ...projectRouteSnapshot(route), serverNow: Date.now() }, { headers });
}
