"use client";

import { AuditPromptLink } from "@/components/AuditPromptLink";

/**
 * The home page's own client reference to the audit prompt link. The root layout's Footer uses
 * the same component; a module both a layout and a page reference gets one entry's chunk list
 * in Next's merged manifest, which pulled the home bundle into other routes.
 */
export function HomeAuditPromptLink({ className }: { className?: string }) {
  return <AuditPromptLink className={className} />;
}
