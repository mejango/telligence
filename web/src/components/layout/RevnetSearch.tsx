"use client";

import { useEnsAddress } from "@/hooks/ens/useEnsAddress";
import { rememberProjectNavigation } from "@/lib/project-navigation";
import { parseProjectHandleInput } from "@/lib/projectHandles";
import { formatEthAddress } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Address, isAddress } from "viem";

type SearchResult = {
  projectId: number;
  chainId: number;
  chainIds: number[];
  suckerGroupId: string | null;
  name: string | null;
  logoUri: string | null;
  projectTagline: string | null;
  ticker: string | null;
};

const CHAIN_SLUGS: Record<number, string> = {
  1: "eth",
  10: "op",
  8453: "base",
  42161: "arb",
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  8453: "Base",
  42161: "Arbitrum",
};

function resultHref(result: SearchResult) {
  return `/${CHAIN_SLUGS[result.chainId] ?? "eth"}:${result.projectId}`;
}

type AccountResult = {
  /** Path segment for /account/[id] — the raw address or the ENS name. */
  id: string;
  address: Address;
  name?: string;
};

const ENS_LABEL = "[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?";
const ENS_NAME_PATTERN = new RegExp(`^${ENS_LABEL}(?:\\.${ENS_LABEL})+$`, "iu");

function looksLikeEnsName(value: string) {
  return value.includes(".") && ENS_NAME_PATTERN.test(value);
}

const subscribeToHydration = () => () => {};
const clientIsHydrated = () => true;
const serverIsHydrated = () => false;

export function Magnifier() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
  );
}

export function RevnetSearch({
  autoFocus = false,
  onFocusChange,
}: {
  /** Focus the field on mount — the phone header opens it from an icon. */
  autoFocus?: boolean;
  /** Reports focus entering or leaving the whole search, results included. */
  onFocusChange?: (focused: boolean) => void;
} = {}) {
  const router = useRouter();
  // The server form has no search action yet. Typing before its handlers attach
  // can lose the controlled value or submit back to the current project URL.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientIsHydrated, serverIsHydrated);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const trimmedQuery = query.trim();
  const isHandleQuery = trimmedQuery.startsWith("@");
  const handleRoute = (() => {
    if (!isHandleQuery) return null;
    try {
      return `/@${parseProjectHandleInput(trimmedQuery).handle}`;
    } catch {
      return null;
    }
  })();

  const isAddressQuery = isAddress(trimmedQuery);
  const ensCandidate =
    !isHandleQuery && !isAddressQuery && looksLikeEnsName(trimmedQuery) ? trimmedQuery : undefined;
  const [debouncedEnsName, setDebouncedEnsName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!ensCandidate) {
      setDebouncedEnsName(undefined);
      return;
    }
    const timeout = window.setTimeout(() => setDebouncedEnsName(ensCandidate), 250);
    return () => window.clearTimeout(timeout);
  }, [ensCandidate]);

  const ensLookup = useEnsAddress(debouncedEnsName, { enabled: Boolean(debouncedEnsName) });
  const ensResolving =
    Boolean(ensCandidate) && (debouncedEnsName !== ensCandidate || ensLookup.isFetching);

  const accountResult: AccountResult | null = isAddressQuery
    ? { id: trimmedQuery, address: trimmedQuery as Address }
    : !ensResolving && ensCandidate && ensLookup.data
      ? { id: ensCandidate, address: ensLookup.data, name: ensCandidate }
      : null;
  const hasAccountRow = accountResult !== null || ensResolving;

  useEffect(() => {
    if (isHandleQuery) {
      setResults([]);
      setOpen(true);
      setSearching(false);
      return;
    }
    const normalizedQuery = trimmedQuery.replace(/^\$/u, "");
    if (!normalizedQuery || (normalizedQuery.length < 2 && !/^\d+$/u.test(normalizedQuery))) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/search-projects?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search unavailable");
        const body = (await response.json()) as {
          projects?: SearchResult[];
        };
        setResults(body.projects ?? []);
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isHandleQuery, trimmedQuery]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    if (hasAccountRow || isHandleQuery) setOpen(true);
  }, [hasAccountRow, isHandleQuery]);

  const goToResult = (result: SearchResult) => {
    rememberProjectNavigation(resultHref(result), {
      name: result.name ?? `Project ${result.projectId}`,
      logoUri: result.logoUri,
      tagline: result.projectTagline,
      ticker: result.ticker,
    });
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(resultHref(result));
  };

  const goToAccount = (account: AccountResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(`/account/${account.id}`);
  };

  const clearSearch = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 w-full"
      onFocusCapture={() => onFocusChange?.(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onFocusChange?.(false);
        }
      }}
    >
      <form
        role="search"
        action={handleRoute ?? undefined}
        onSubmit={(event) => {
          if (handleRoute) {
            // Capture the route before clearing controlled state, then force a
            // full navigation. A React rerender must not be able to remove the
            // form action before the browser submits it, and the same alias may
            // now resolve to a different tuple than the mounted layout.
            event.preventDefault();
            clearSearch();
            window.location.assign(handleRoute);
            return;
          }
          event.preventDefault();
          if (accountResult) goToAccount(accountResult);
          else if (results[0]) goToResult(results[0]);
        }}
      >
        <label className="relative block">
          <span className="sr-only">
            Search revnets by name, handle, ticker, or project ID, or an account by address or ENS
            name
          </span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <Magnifier />
          </span>
          <input
            type="search"
            disabled={!hydrated}
            autoFocus={autoFocus}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (results.length > 0 || searching || hasAccountRow || isHandleQuery) setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="Search revnets"
            className="min-h-12 w-full border border-zinc-200 bg-white py-2 pl-11 pr-3 text-base text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </label>
      </form>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto border border-zinc-200 bg-white py-1 shadow-lg">
          {handleRoute ? (
            <a
              href={handleRoute}
              onClick={clearSearch}
              data-project-navigation="document"
              className="block w-full px-4 py-3 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
            >
              <span className="block truncate font-medium">{handleRoute.slice(1)}</span>
              <span className="block truncate text-xs text-zinc-600">
                Open revnet handle | verified on load
              </span>
            </a>
          ) : accountResult ? (
            <button
              type="button"
              onClick={() => goToAccount(accountResult)}
              className="block w-full px-4 py-3 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
            >
              <span className="block truncate font-medium">
                {accountResult.name ?? formatEthAddress(accountResult.address)}
              </span>
              <span className="block truncate text-xs text-zinc-600">
                {accountResult.name ? `${formatEthAddress(accountResult.address)} | ` : ""}
                View account
              </span>
            </button>
          ) : ensResolving ? (
            <p className="px-4 py-3 text-xs text-zinc-400">Resolving name…</p>
          ) : null}
          {isHandleQuery ? (
            handleRoute ? null : (
              <p className="px-4 py-3 text-sm text-zinc-600">Enter a valid @handle.</p>
            )
          ) : searching ? (
            <p className="px-4 py-3 text-sm text-zinc-600">Searching…</p>
          ) : results.length === 0 ? (
            hasAccountRow ? null : (
              <p className="px-4 py-3 text-sm text-zinc-600">No matching revnets.</p>
            )
          ) : (
            <ul>
              {results.map((result) => (
                <li key={result.suckerGroupId ?? `${result.chainId}:${result.projectId}`}>
                  <button
                    type="button"
                    onClick={() => goToResult(result)}
                    className="block w-full px-4 py-3 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                  >
                    <span className="block truncate font-medium">
                      {result.name ?? `Project ${result.projectId}`}
                    </span>
                    <span className="block truncate text-xs text-zinc-600">
                      {result.ticker ? `${result.ticker.replace(/^\$+/, "")} ` : ""}
                      {(result.chainIds.length ? result.chainIds : [result.chainId])
                        .map((chainId) => CHAIN_NAMES[chainId] ?? `Chain ${chainId}`)
                        .join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
