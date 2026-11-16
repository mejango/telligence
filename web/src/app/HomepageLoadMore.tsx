"use client";

import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

/**
 * The last row of a homepage feed. Phones get a thin "More" cell, so reaching the
 * end hands the scroll back to the page. Wider screens, where the feed scrolls in
 * its own fixed-height card, load the next page as the end comes into view.
 */
export function HomepageLoadMore({
  loadMore,
  hasMore,
  loading,
}: {
  loadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}) {
  // The marker is not rendered on phones, so it never comes into view there.
  const markerRef = useInfiniteScroll(loadMore, hasMore && !loading);
  if (!hasMore && !loading) return null;
  return (
    <li>
      <button
        type="button"
        onClick={loadMore}
        disabled={loading}
        aria-busy={loading}
        className={`flex h-11 w-full items-center justify-center text-sm text-teal-600 hover:text-teal-700 sm:hidden ${
          loading ? "animate-pulse" : ""
        }`}
      >
        More
      </button>
      <div ref={markerRef} aria-hidden className="hidden h-12 sm:block" />
    </li>
  );
}
