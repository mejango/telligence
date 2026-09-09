"use client";

import { decodeProjectRouteSlug } from "@/lib/slug";
import { useEffect } from "react";

export function isMutableHandlePath(pathname: string): boolean {
  const firstSegment = pathname.split("/")[1];
  return Boolean(firstSegment && decodeProjectRouteSlug(firstSegment)?.startsWith("@"));
}

/**
 * Next's router cache and the browser BFCache can otherwise restore a layout
 * for the tuple an @handle used to name. Back/forward into an alias therefore
 * gets a document reload and a fresh bidirectional authority check.
 */
export function MutableHandleNavigationGuard() {
  useEffect(() => {
    const revalidateAlias = () => {
      if (isMutableHandlePath(window.location.pathname)) window.location.reload();
    };
    const restoreAlias = (event: PageTransitionEvent) => {
      if (event.persisted) revalidateAlias();
    };

    window.addEventListener("popstate", revalidateAlias);
    window.addEventListener("pageshow", restoreAlias);
    return () => {
      window.removeEventListener("popstate", revalidateAlias);
      window.removeEventListener("pageshow", restoreAlias);
    };
  }, []);

  return null;
}
