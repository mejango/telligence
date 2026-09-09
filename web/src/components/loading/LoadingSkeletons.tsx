import { IpfsImage } from "@/components/IpfsImage";
import { Revalidating } from "@/components/ui/Revalidating";
import { Skeleton, SkeletonLines, SkeletonTable } from "@/components/ui/skeleton";
import { type ProjectNavigationHint } from "@/lib/project-navigation";

function ActivityRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-2.5 w-1/3" />
            <Skeleton className={index % 2 === 0 ? "h-3 w-4/5" : "h-3 w-2/3"} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityFeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading activity" className="py-2">
      <span className="sr-only">Loading activity</span>
      <ActivityRows rows={rows} />
    </div>
  );
}

export function ChartSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading chart"
      className={`relative overflow-hidden border-b border-l border-melon-100 ${className}`}
    >
      <span className="sr-only">Loading chart</span>
      <div className="absolute inset-0 flex flex-col justify-evenly px-4" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="border-t border-melon-100" />
        ))}
      </div>
      <div className="absolute inset-x-4 bottom-3 top-4 text-melon-100" aria-hidden="true">
        <svg className="h-full w-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
          <path
            d="M 20 268 H 100 V 248 H 185 V 225 H 270 V 196 H 360 V 166 H 450 V 130 H 545 V 98 H 635 V 72 H 725 V 54 H 815 V 39 H 900 V 25 H 980"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="square"
            strokeLinejoin="miter"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M 20 278 H 980"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="square"
            vectorEffect="non-scaling-stroke"
            opacity="0.7"
          />
        </svg>
      </div>
    </div>
  );
}

function OverviewContentSkeleton() {
  return (
    <div role="status" aria-label="Loading overview" className="flex flex-col gap-6">
      <span className="sr-only">Loading overview</span>
      <div>
        <div className="flex flex-col items-start gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-4">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
          <div className="flex gap-1">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-14" />
            ))}
          </div>
        </div>
        <ChartSkeleton className="mt-6 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
      </div>
      <div>
        <Skeleton className="mb-3 h-5 w-16" />
        <SkeletonLines lines={3} className="max-w-screen-sm" />
      </div>
      <CardSkeleton rows={3} />
    </div>
  );
}

export function ShopInventorySkeleton() {
  const chipWidths = ["w-16", "w-24", "w-20", "w-28", "w-20", "w-16", "w-24", "w-20"];

  return (
    <div role="status" aria-label="Loading shop" className="flex flex-col gap-4">
      <span className="sr-only">Loading shop</span>
      <div className="flex gap-5 border-b border-zinc-200 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="border border-zinc-200 bg-white p-4">
        <Skeleton className="h-5 w-14" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chipWidths.map((width, index) => (
            <Skeleton key={index} className={`h-8 ${width}`} />
          ))}
        </div>
        <Skeleton className="mb-2 mt-4 h-3 w-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="overflow-hidden border border-zinc-200 bg-white">
              <Skeleton className="aspect-square w-full" />
              <div className="space-y-2 border-t border-zinc-200 bg-melon-50 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-7 w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-4 w-40" />
      </div>
    </div>
  );
}

function TermsContentSkeleton() {
  return (
    <div role="status" aria-label="Loading terms">
      <span className="sr-only">Loading terms</span>
      <Skeleton className="mb-3 h-5 w-32" />
      <SkeletonLines lines={2} className="w-72 max-w-full" />
      <ChartSkeleton className="mt-5 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
      <Skeleton className="mb-3 mt-8 h-5 w-20" />
      <TableSkeleton rows={4} columns={6} />
    </div>
  );
}

function OwnersContentSkeleton() {
  return (
    <div role="status" aria-label="Loading token owner tools" className="space-y-6">
      <span className="sr-only">Loading token owner tools</span>
      <CardSkeleton rows={4} />
      <div className="flex gap-5 overflow-hidden border-b border-zinc-200 pb-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-4 w-24 shrink-0" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={4} />
      </div>
    </div>
  );
}

function ExtrasContentSkeleton() {
  return (
    <div role="status" aria-label="Loading extras" className="space-y-4">
      <span className="sr-only">Loading extras</span>
      <Skeleton className="h-5 w-32" />
      <SkeletonLines lines={2} className="max-w-screen-sm" />
      <Skeleton className="h-11 w-44" />
      <TableSkeleton rows={4} columns={4} />
    </div>
  );
}

function OperatorContentSkeleton() {
  return (
    <div role="status" aria-label="Loading revnet operator tools" className="space-y-8">
      <span className="sr-only">Loading revnet operator tools</span>
      {Array.from({ length: 4 }, (_, index) => (
        <CardSkeleton key={index} rows={index === 2 ? 5 : 3} />
      ))}
    </div>
  );
}

export function ProjectContentSkeleton({ segment }: { segment: string | null }) {
  switch (segment) {
    case "shop":
      return <ShopInventorySkeleton />;
    case "terms":
      return <TermsContentSkeleton />;
    case "owners":
      return <OwnersContentSkeleton />;
    case "extras":
      return <ExtrasContentSkeleton />;
    case "operator":
      return <OperatorContentSkeleton />;
    default:
      return <OverviewContentSkeleton />;
  }
}

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

export function TableSkeleton({ rows = 4, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading table" className="bg-melon-50 p-4">
      <span className="sr-only">Loading table</span>
      <SkeletonTable rows={rows} columns={columns} />
    </div>
  );
}

function NavigationSkeleton() {
  return (
    <div className="border-b border-zinc-100">
      <div className="flex items-center justify-between px-4 py-3 sm:container">
        <Skeleton className="size-[60px]" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  );
}

export function ProjectPageSkeleton({ hint }: { hint?: ProjectNavigationHint | null }) {
  return (
    <div className="min-h-screen" role="status" aria-label="Loading project">
      <span className="sr-only">Loading project</span>
      <NavigationSkeleton />

      <div className="w-full px-4 pt-6 sm:container">
        <div className="mb-4 flex flex-col items-start gap-4 sm:mb-6 sm:flex-row sm:items-center">
          {hint ? (
            <>
              <Revalidating as="div" pending className="w-fit shrink-0">
                <IpfsImage
                  src={hint.logoUri}
                  alt=""
                  width={144}
                  height={144}
                  className="h-[120px] w-[120px] object-cover sm:size-36"
                  fallback={
                    <div className="flex h-[120px] w-[120px] items-center justify-center bg-zinc-100 text-3xl font-bold sm:size-36">
                      {hint.name.slice(0, 1).toUpperCase()}
                    </div>
                  }
                />
              </Revalidating>
              <div className="min-w-0 flex-1">
                <Revalidating as="div" pending className="w-fit max-w-full">
                  <h1 className="break-words font-mono text-3xl font-bold">
                    {hint.ticker ? `${hint.ticker} ` : ""}
                    <span className="font-medium">{hint.name}</span>
                  </h1>
                </Revalidating>
                {hint.tagline ? (
                  <Revalidating as="div" pending className="mt-2 w-fit max-w-full">
                    <p className="text-sm text-zinc-600">{hint.tagline}</p>
                  </Revalidating>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-24" />
                </div>
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-[120px] w-[120px] shrink-0 sm:size-36" />
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-8 w-72 max-w-[75%]" />
                <div className="flex flex-wrap gap-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <Skeleton className="h-4 w-96 max-w-[85%]" />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-6 px-4 pb-5 md:flex-row md:gap-10 sm:container">
        <aside className="w-full shrink-0 md:w-[300px]">
          <Skeleton className="mb-6 h-64 w-full" />
          <Skeleton className="mb-5 h-5 w-24" />
          <ActivityRows rows={5} />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-10">
            <div className="flex gap-6 overflow-hidden border-b border-zinc-200 pb-2">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-5 w-20 shrink-0" />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
            </div>
            <ChartSkeleton className="aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
            <CardSkeleton rows={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
