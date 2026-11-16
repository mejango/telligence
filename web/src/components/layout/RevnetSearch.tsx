"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { useEnsAddress } from "@/hooks/ens/useEnsAddress";
import { useHydrated } from "@/hooks/useHydrated";
import { ensAvatarUrlForAddress } from "@/lib/ensAvatarUrl";
import type { JBChainId } from "@/lib/nana/types";
import { rememberProjectNavigation } from "@/lib/project-navigation";
import { formatEthAddress } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Address, isAddress } from "viem";

// The field is on every page, while results exist only after typing. Their image code carries the
// CID parser, which pages without project images would otherwise load for nothing.
const ResultLogoPlaceholder = () => (
  <span data-search-result-logo className="size-8 shrink-0 bg-teal-100" />
);
const IpfsImage = dynamic(() => import("@/components/IpfsImage").then((m) => m.IpfsImage), {
  loading: ResultLogoPlaceholder,
});
const ImageWithFallback = dynamic(
  () => import("@/components/IpfsImage").then((m) => m.ImageWithFallback),
  { loading: ResultLogoPlaceholder },
);

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

/** The route an @handle query opens, or null for an invalid handle. */
async function routeForHandle(query: string): Promise<string | null> {
  const { parseProjectHandleInput } = await import("@/lib/projectHandles");
  try {
    return `/@${parseProjectHandleInput(query).handle}`;
  } catch {
    return null;
  }
}

function looksLikeEnsName(value: string) {
  return value.includes(".") && ENS_NAME_PATTERN.test(value);
}

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
  const hydrated = useHydrated();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const trimmedQuery = query.trim();
  const isHandleQuery = trimmedQuery.startsWith("@");
  // Handle parsing normalizes through ENS, whose Unicode table loads only once the query is an
  // @handle. Until it has parsed this query, the handle is neither valid nor invalid.
  const [parsedHandle, setParsedHandle] = useState<{ query: string; route: string | null }>();
  const handleParsed = parsedHandle?.query === trimmedQuery;
  const handleRoute = isHandleQuery && handleParsed ? parsedHandle.route : null;
  useEffect(() => {
    if (!isHandleQuery) return;
    let live = true;
    void routeForHandle(trimmedQuery).then((route) => {
      if (live) setParsedHandle({ query: trimmedQuery, route });
    });
    return () => {
      live = false;
    };
  }, [isHandleQuery, trimmedQuery]);

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

  useEffect(() => {
    if (autoFocus && hydrated) inputRef.current?.focus();
  }, [autoFocus, hydrated]);

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
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // A search field's native Escape would also clear the query.
        event.preventDefault();
        // Focus first: the field's focus handler reopens the list.
        inputRef.current?.focus();
        setOpen(false);
      }}
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
          if (isHandleQuery && !handleParsed) {
            // Submitted before the handle parser loaded: parse, then go as the parsed form would.
            event.preventDefault();
            const query = trimmedQuery;
            void routeForHandle(query).then((route) => {
              setParsedHandle({ query, route });
              if (!route) return;
              clearSearch();
              window.location.assign(route);
            });
            return;
          }
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
            ref={inputRef}
            type="search"
            disabled={!hydrated}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (results.length > 0 || searching || hasAccountRow || isHandleQuery) setOpen(true);
            }}
            // A blank placeholder keeps :placeholder-shown working; the visible hint is the
            // span below, so its phone wording is right from the first paint.
            placeholder=" "
            className="peer min-h-12 w-full border border-zinc-200 bg-white py-2 pl-11 pr-3 text-base text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-11 right-3 top-1/2 hidden -translate-y-1/2 truncate text-base text-zinc-500 peer-placeholder-shown:block"
          >
            Search<span className="hidden md:inline"> revnets</span>
          </span>
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
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
            >
              <ImageWithFallback
                data-search-result-logo
                src={ensAvatarUrlForAddress(accountResult.address, { size: 32 })}
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-full"
                fallback={
                  <span
                    data-search-result-logo
                    className="size-8 shrink-0 rounded-full bg-teal-600"
                  />
                }
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-900">
                  {accountResult.name ?? formatEthAddress(accountResult.address)}
                </span>
                <span className="block truncate text-xs text-zinc-600">
                  {accountResult.name ? `${formatEthAddress(accountResult.address)} | ` : ""}
                  View account
                </span>
              </span>
            </button>
          ) : ensResolving ? (
            <p className="px-4 py-3 text-xs text-zinc-400">Resolving name…</p>
          ) : null}
          {isHandleQuery ? (
            handleRoute || !handleParsed ? null : (
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
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                  >
                    <IpfsImage
                      data-search-result-logo
                      src={result.logoUri}
                      alt=""
                      width={32}
                      height={32}
                      className="size-8 shrink-0 object-cover"
                      fallback={<ResultLogoPlaceholder />}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-900">
                        {result.name ?? `Project ${result.projectId}`}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-zinc-600">
                        {result.ticker ? <span>{result.ticker.replace(/^\$+/, "")}</span> : null}
                        {(result.chainIds.length ? result.chainIds : [result.chainId]).map(
                          (chainId) => (
                            <ChainLogo
                              key={chainId}
                              chainId={chainId as JBChainId}
                              width={14}
                              height={14}
                              standalone
                            />
                          ),
                        )}
                      </span>
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
