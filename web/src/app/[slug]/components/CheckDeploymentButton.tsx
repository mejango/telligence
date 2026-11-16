"use client";

import { createContext, useContext } from "react";

export const DiagnosticsContext = createContext<(() => void) | null>(null);

export function CheckDeploymentButton({
  className = "min-h-11 underline",
}: {
  className?: string;
}) {
  const open = useContext(DiagnosticsContext);
  if (!open) return null;
  return (
    <button type="button" className={className} onClick={open}>
      Check deployment
    </button>
  );
}
