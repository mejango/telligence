"use client";

import { useState } from "react";

import { WalletButton } from "@/components/WalletButton";
import { BrainMark } from "@/components/telligence/BrainMark";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Magnifier, RevnetSearch } from "./RevnetSearch";

function GuideLinks({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  return (
    <div
      aria-label="Revnet guides"
      className={`flex items-center gap-1 whitespace-nowrap text-xs leading-normal text-zinc-600 sm:gap-2 sm:text-sm ${className}`}
    >
      <Link
        href="/learn"
        aria-current={pathname === "/learn" ? "page" : undefined}
        className="inline-flex min-h-11 min-w-11 items-center justify-center underline-offset-4 hover:underline hover:text-zinc-900 aria-[current=page]:text-zinc-900 aria-[current=page]:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
      >
        Learn
      </Link>
      <span aria-hidden className="text-zinc-400">
        |
      </span>
      <Link
        href="/build"
        aria-current={pathname === "/build" ? "page" : undefined}
        className="inline-flex min-h-11 min-w-11 items-center justify-center underline-offset-4 hover:underline hover:text-zinc-900 aria-[current=page]:text-zinc-900 aria-[current=page]:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
      >
        Build
      </Link>
      <span aria-hidden className="text-zinc-400">
        |
      </span>
      <Link
        href="/audit"
        aria-current={pathname === "/audit" ? "page" : undefined}
        className="inline-flex min-h-11 min-w-11 items-center justify-center underline-offset-4 hover:underline hover:text-zinc-900 aria-[current=page]:text-zinc-900 aria-[current=page]:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
      >
        Audit
      </Link>
    </div>
  );
}

export function Nav({ wide = false }: { wide?: boolean }) {
  const pathname = usePathname();
  const isWide = wide || pathname === "/";
  // On phones the search column can get too narrow for even the word "Search"
  // once the wallet pill takes its share; then it collapses to an icon at the
  // right, and tapping it opens the field across the logo's column.
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <nav aria-label="Main navigation" className="text-zinc-50 border-b border-zinc-100">
      {pathname === "/learn" || pathname === "/build" ? (
        <a
          href="#guide-content"
          className="sr-only fixed left-4 top-4 z-50 bg-white px-4 py-3 font-semibold text-melon-900 shadow-lg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800"
        >
          Skip to content
        </a>
      ) : null}
      <div
        data-site-nav-layout
        className={`mx-auto grid w-full grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-[clamp(0.5rem,1.5vw,2rem)] px-4 py-3 md:grid-cols-[minmax(max-content,1fr)_minmax(12rem,32rem)_minmax(max-content,1fr)] md:grid-rows-1 ${
          isWide ? "max-w-[1800px]" : "max-w-[1536px]"
        }`}
      >
        <div
          className={`col-start-1 row-start-1 items-center justify-self-start md:flex md:gap-x-4 ${
            searchOpen ? "hidden" : "flex"
          }`}
        >
          <Link
            href="/"
            aria-label="Telligence home"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-melon-700"
          >
            <BrainMark className="size-9" />
          </Link>
          <GuideLinks className="hidden md:flex md:min-h-11" />
        </div>
        {/* On phones the logo alone shares row one with the search and wallet,
            so it centers on them; the guide links hang underneath. */}
        {searchOpen ? null : (
          <GuideLinks className="col-span-3 col-start-1 row-start-2 justify-self-start md:hidden" />
        )}
        <div
          data-site-nav-search
          className={`row-start-1 w-full min-w-0 max-w-lg @container ${
            searchOpen
              ? "col-span-2 col-start-1 justify-self-center md:col-span-1 md:col-start-2"
              : "col-start-2 justify-self-end md:justify-self-center"
          }`}
        >
          {searchOpen ? (
            <RevnetSearch
              autoFocus
              onFocusChange={(focused) => {
                if (!focused) setSearchOpen(false);
              }}
            />
          ) : (
            <>
              <div className="@max-[7.5rem]:hidden">
                <RevnetSearch />
              </div>
              <div className="hidden justify-end @max-[7.5rem]:flex">
                <button
                  type="button"
                  aria-label="Search"
                  onClick={() => setSearchOpen(true)}
                  className="flex h-11 w-11 items-center justify-center border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"
                >
                  <Magnifier />
                </button>
              </div>
            </>
          )}
        </div>
        <div
          data-site-nav-wallet
          className="col-start-3 row-start-1 flex min-w-0 max-w-full items-stretch justify-self-end [&>*]:min-w-0 [&>*]:max-w-full [&_button]:max-w-full [&>button]:min-h-11"
        >
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
