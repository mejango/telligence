"use client";

import { createContext, useContext, useLayoutEffect, type PropsWithChildren } from "react";
import { projectRouteIdentity, type ProjectRouteSnapshot } from "./projectRouteIdentity";

type RouteContext = {
  identity: string;
  acknowledgePage: (identity: string) => void;
  navigate: (action: () => void, href?: string) => void;
};
export const ProjectRouteContext = createContext<RouteContext | null>(null);

/** A freshly resolved child must never render under a retained layout for another tuple. */
export function ProjectPageBoundary({
  snapshot,
  children,
}: PropsWithChildren<{ snapshot: ProjectRouteSnapshot }>) {
  const context = useContext(ProjectRouteContext);
  const identity = projectRouteIdentity(snapshot);
  const acknowledge = context?.acknowledgePage;
  useLayoutEffect(() => {
    acknowledge?.(identity);
  }, [acknowledge, identity]);
  return !context || context.identity === identity ? children : null;
}

export function useProjectNavigation() {
  const context = useContext(ProjectRouteContext);
  return context?.navigate ?? ((action: () => void) => action());
}
