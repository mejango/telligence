"use client";

import { useTransactionReviewScope } from "@/components/TransactionReviewScope";
import { ProjectRouteBlockedContext } from "@/lib/project-route-state";
import { replaceProjectDocument } from "@/lib/projectSubtabNavigation";
import { decodeProjectRouteSlug, slugFor } from "@/lib/slug";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { ProjectRouteContext } from "./ProjectRouteContext";
import { projectRouteIdentity, type ProjectRouteSnapshot } from "./projectRouteIdentity";
import { verifyProjectRoute } from "./projectRouteQuery";

/** Shared layouts survive RSC navigation. Keep their providers bound to the verified tuple. */
export function ProjectRouteBoundary({
  slug,
  snapshot,
  children,
}: PropsWithChildren<{
  slug: string;
  snapshot: ProjectRouteSnapshot;
}>) {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const alias = decodeProjectRouteSlug(slug)?.startsWith("@") ?? false;
  const identity = projectRouteIdentity(snapshot);
  const [verified, setVerified] = useState(snapshot);
  const [pageIdentity, setPageIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<"ready" | "checking" | "refreshing" | "failed">("ready");
  const sequence = useRef(0);
  const pending = useRef<(() => void) | null>(null);
  const mountedBinding = useRef({ slug, identity });
  if (mountedBinding.current.slug !== slug) mountedBinding.current = { slug, identity };
  const replacingDocument = useRef(false);
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = useRef({ identity, snapshot, pageIdentity, slug });
  current.current = { identity, snapshot, pageIdentity, slug };

  const check = useCallback(
    async (action?: () => void, force = false, href?: string) => {
      if (!alive.current || replacingDocument.current) return false;
      const attempt = ++sequence.current;
      pending.current = action ?? null;
      if (!alias) {
        action?.();
        return true;
      }
      setStatus("checking");
      try {
        const proof = await verifyProjectRoute(client, slug, current.current.snapshot, force);
        if (!alive.current || attempt !== sequence.current || slug !== current.current.slug)
          return false;
        setVerified(proof);
        if (projectRouteIdentity(proof) !== mountedBinding.current.identity) {
          // This is a different project/authority, not a same-project view change.
          // Replacing the document cancels old async preparations as well as UI state.
          replacingDocument.current = true;
          setStatus("refreshing");
          replaceProjectDocument(href ?? window.location.href);
          return false;
        }
        if (
          projectRouteIdentity(proof) !== current.current.identity ||
          (current.current.pageIdentity !== null &&
            current.current.pageIdentity !== current.current.identity)
        ) {
          setStatus("refreshing");
          router.refresh();
          return false;
        }
        setStatus("ready");
        pending.current = null;
        action?.();
        return true;
      } catch {
        if (!alive.current || attempt !== sequence.current || slug !== current.current.slug)
          return false;
        pending.current = null;
        setStatus("failed");
        return false;
      }
    },
    [alias, client, router, slug],
  );

  const acknowledgePage = useCallback((value: string) => setPageIdentity(value), []);
  const blocked =
    alias &&
    (status !== "ready" ||
      pageIdentity !== identity ||
      projectRouteIdentity(verified) !== identity);

  // A stale child for the same verified binding needs a matching RSC refresh.
  // A positively changed binding replaces the document above, cancelling old preparations.
  useEffect(() => {
    if (
      status !== "refreshing" ||
      pageIdentity !== identity ||
      projectRouteIdentity(verified) !== identity
    )
      return;
    void check(pending.current ?? undefined);
  }, [check, identity, pageIdentity, status, verified]);

  useEffect(() => {
    if (
      alias &&
      pageIdentity !== null &&
      (pageIdentity !== identity || projectRouteIdentity(verified) !== identity) &&
      status === "ready"
    )
      void check(undefined, true);
  }, [alias, check, identity, pageIdentity, status, verified]);

  useEffect(() => {
    if (!alias) return;
    // Back/forward may restore a complete old tree. Recheck its proof, without a document request.
    const restore = () => void check();
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("focus", restore);
    return () => {
      // Invalidate outstanding checks; this is a sequence counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      window.removeEventListener("popstate", restore);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("focus", restore);
    };
  }, [alias, check, pathname]);

  // The global review dialog is a sibling of the route, so its owner must check
  // the initiating scope. Ordinary form edits and modal dismissal stay local.
  const reviewScope = useMemo(
    () =>
      alias
        ? {
            identity: `${slug}:${identity}`,
            verify: async () => {
              if (
                !alive.current ||
                current.current.identity !== identity ||
                current.current.slug !== slug
              )
                return false;
              const allowed = await check();
              return (
                alive.current &&
                allowed &&
                current.current.identity === identity &&
                current.current.slug === slug
              );
            },
          }
        : null,
    [alias, check, identity, slug],
  );
  useTransactionReviewScope(reviewScope);

  const navigate = (action: () => void, href?: string) => {
    if (!alias) action();
    else void check(action, false, href);
  };

  return (
    <ProjectRouteContext.Provider value={{ identity, acknowledgePage, navigate }}>
      {alias && blocked ? (
        <div
          role={status === "failed" ? "alert" : "status"}
          className="mx-auto max-w-4xl p-4 text-sm"
        >
          {status === "failed"
            ? "Unable to verify this handle. Project actions are paused."
            : status === "refreshing"
              ? "This handle changed. Loading the current project…"
              : blocked
                ? "Checking this handle…"
                : null}
          {status === "failed" || status === "refreshing" ? (
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => void check(undefined, true)}
            >
              Retry
            </button>
          ) : null}
          {status === "failed" ? (
            <Link
              className="ml-3 underline"
              href={`/${slugFor(snapshot.chainId, BigInt(snapshot.projectId))}`}
            >
              Open original project
            </Link>
          ) : null}
        </div>
      ) : null}
      <div data-project-route-boundary inert={blocked} aria-busy={blocked}>
        <ProjectRouteBlockedContext.Provider value={blocked}>
          <Fragment key={identity}>{children}</Fragment>
        </ProjectRouteBlockedContext.Provider>
      </div>
    </ProjectRouteContext.Provider>
  );
}
