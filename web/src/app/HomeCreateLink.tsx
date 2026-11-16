"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Home's link to /create. The create route is heavy, so it is not prefetched as soon as the link
 * is in view (most visitors never open it); hover or focus prefetches it ahead of a click.
 */
export function HomeCreateLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const prefetch = () => router.prefetch("/create");
  return (
    <Link
      href="/create"
      prefetch={false}
      className={className}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
    >
      {children}
    </Link>
  );
}
