import { Button } from "@/components/ui/button";
import Link from "next/link";

export function GatewayFeedback({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div role="alert" className="border border-melon-300 bg-melon-50 p-6 sm:p-8">
      <p className="font-medium">We couldn&apos;t reach the compute gateway.</p>
      <p className="mt-2 max-w-[68ch] text-sm leading-6 text-melon-800">{error}</p>
      <Button variant="outline" onClick={retry} className="mt-5">
        Try again
      </Button>
      <Link
        href="/recover"
        className="compute-text-link ml-5 inline-flex min-h-11 items-center text-xs"
      >
        Recover backing directly on Base
      </Link>
    </div>
  );
}

export function ComputeLoading({ label = "Loading project" }: { label?: string }) {
  return (
    <div role="status" className="space-y-6 py-8">
      <span className="text-sm text-melon-700">{label}…</span>
      <div aria-hidden="true" className="space-y-5">
        <div className="skeleton-shimmer h-5 max-w-64" />
        <div className="skeleton-shimmer h-20 w-full" />
        <div className="skeleton-shimmer h-20 w-full" />
      </div>
    </div>
  );
}
