"use client";

import { BrainMark } from "@/components/telligence/BrainMark";
import { WalletButton } from "@/components/WalletButton";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ComputeNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-melon-200">
      <a
        href="#compute-content"
        className="sr-only fixed left-4 top-4 z-50 bg-melon-25 px-4 py-3 focus:not-sr-only"
      >
        Skip to content
      </a>
      <nav
        aria-label="Main navigation"
        className="compute-container flex min-h-24 flex-wrap items-center justify-between gap-x-5 gap-y-1 py-4"
      >
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-5 sm:gap-x-8">
          <Link
            href="/"
            aria-label="Telligence home"
            className="compute-wordmark inline-flex min-h-11 items-center text-2xl font-bold tracking-[-0.07em] sm:text-3xl"
          >
            <BrainMark className="mr-2.5 size-8 shrink-0 text-melon-700 sm:size-9" />
            telligence<span className="text-melon-600">.</span>
          </Link>
          <Link
            href="/how-it-works"
            aria-current={pathname === "/how-it-works" ? "page" : undefined}
            className="compute-nav-link text-xs sm:text-sm"
          >
            Learn
          </Link>
        </div>
        <div className="min-w-0 max-w-full [&_button]:min-h-11">
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
