"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useHydrated } from "@/hooks/useHydrated";

// Every route's bundle carries the root not-found module, so the nav it needs loads on demand.
export const NotFoundNav = dynamic(() =>
  import("@/components/layout/Nav").then((module) => module.Nav),
);

function messageFor(pathname: string) {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is still worth echoing as typed.
  }
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "account" && segments[1]) return `No account matches ${segments[1]}.`;
  if (segments.length !== 1) return `Nothing at ${path}.`;
  return segments[0].startsWith("@")
    ? `No revnet has the handle ${segments[0]}.`
    : `No revnet at /${segments[0]}.`;
}

export function NotFoundMessage() {
  // The metadata of the layout that threw overwrites this page's own title after hydration.
  useEffect(() => {
    document.title = "Not found | Revnet";
  }, []);
  // The prebuilt 404 is rendered for "/_not-found", so the path is named once the browser knows it.
  const hydrated = useHydrated();
  const pathname = usePathname();
  return (
    <p className="mb-6 min-h-6 max-w-full break-words text-zinc-600">
      {hydrated ? messageFor(pathname) : ""}
    </p>
  );
}
