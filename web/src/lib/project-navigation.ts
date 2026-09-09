export type ProjectNavigationHint = {
  name: string;
  logoUri: string | null;
  tagline?: string | null;
  ticker?: string | null;
};

const MAX_HINTS = 24;
const hints = new Map<string, ProjectNavigationHint>();

function routeKey(href: string): string {
  const path = href.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function normalize(hint: ProjectNavigationHint): ProjectNavigationHint | null {
  const name = hint.name.trim().slice(0, 200);
  if (!name) return null;
  return {
    name,
    logoUri: hint.logoUri?.trim().slice(0, 2_048) || null,
    tagline: hint.tagline?.trim().slice(0, 500) || null,
    ticker: hint.ticker?.trim().slice(0, 80) || null,
  };
}

/** Remember identity the user can already see before a project transition. */
export function rememberProjectNavigation(href: string, hint: ProjectNavigationHint): void {
  const key = routeKey(href);
  const normalized = normalize(hint);
  if (!key.startsWith("/") || !normalized) return;
  hints.delete(key);
  hints.set(key, normalized);
  if (hints.size > MAX_HINTS) {
    const oldest = hints.keys().next().value;
    if (typeof oldest === "string") hints.delete(oldest);
  }
}

export function getProjectNavigationHint(href: string): ProjectNavigationHint | null {
  return hints.get(routeKey(href)) ?? null;
}

export function clearProjectNavigationHints(): void {
  hints.clear();
}
