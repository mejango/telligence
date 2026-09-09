import { NextRequest, NextResponse } from "next/server";

const LEGACY_V6_PROJECT_PATH = /^\/v6:([^/:]+):([1-9]\d*)(\/.*)?$/;
const DOUBLE_ENCODED_HANDLE_PATH = /^\/%2540[^/]*(?:\/|$)/i;

export function proxy(request: NextRequest) {
  // Next exposes literal `@` route params encoded once (`%40`). Reject the
  // raw double-encoded spelling at the request boundary so a later decode can
  // never reinterpret it as the same mutable authority alias.
  if (DOUBLE_ENCODED_HANDLE_PATH.test(new URL(request.url).pathname)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const match = request.nextUrl.pathname.match(LEGACY_V6_PROJECT_PATH);
  if (!match) return NextResponse.next();

  const [, chainSlug, projectId, suffix = ""] = match;
  const destination = request.nextUrl.clone();
  destination.pathname = `/${chainSlug}:${projectId}${suffix}`;

  return NextResponse.redirect(destination, 308);
}
