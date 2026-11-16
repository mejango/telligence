"use client";

import type { useUserPermissions } from "@/hooks/useUserPermissions";
import { Button } from "./ui/button";

type Props = Pick<
  ReturnType<typeof useUserPermissions>,
  "isLoading" | "isError" | "isFetching" | "refetch"
> & {
  /** Shown once the account is verified to lack the permission. */
  deniedNote?: string;
};

/** Permission read failures are unknown authority, not verified denial. */
export function PermissionStatus({ isLoading, isError, isFetching, refetch, deniedNote }: Props) {
  if (isError) {
    return (
      <div className="space-y-2 text-sm">
        <p role="alert">Could not verify your project permissions.</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? "Checking permissions…" : "Retry permissions"}
        </Button>
      </div>
    );
  }
  if (isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking permissions…
      </p>
    );
  return deniedNote ? <p className="text-sm text-muted-foreground">{deniedNote}</p> : null;
}
