import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";

/**
 * A loading card. Its own module so a page can use it without referencing LoadingSkeletons,
 * which the project layout also uses (a shared client reference takes one entry's chunks).
 */
export function CardSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading content"
      className={`border border-melon-100 bg-melon-50 p-4 ${className}`}
    >
      <span className="sr-only">Loading content</span>
      <Skeleton className="mb-4 h-4 w-28" />
      <SkeletonLines lines={rows} />
    </div>
  );
}
