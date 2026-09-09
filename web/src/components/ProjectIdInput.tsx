"use client";

import { Input } from "@/components/ui/input";
import { useEffect, useId, useState } from "react";

type Resolution = { kind: "ok" | "warn" | "loading"; text: string };

/** Numeric project field with the resolved exact-chain project name directly beneath it. */
export function ProjectIdInput({
  value,
  onChange,
  chainId,
  disabled,
  placeholder = "Project ID",
  ariaLabel = "Project ID",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  chainId?: number;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const hintId = useId();

  useEffect(() => {
    const raw = value.trim();
    const projectId = Number(raw);
    setResolution(null);
    if (!raw || !chainId) return;
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      setResolution({ kind: "warn", text: "Not a valid project ID." });
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      setResolution({ kind: "loading", text: `Looking up project #${projectId}…` });
      try {
        const response = await fetch(`/api/project-name?chainId=${chainId}&projectId=${projectId}`);
        const result = (await response.json()) as { found?: boolean; name?: string | null };
        if (stale) return;
        setResolution(
          response.ok && result.found
            ? { kind: "ok", text: `→ ${result.name || `Project #${projectId}`}` }
            : { kind: "warn", text: `No revnet project #${projectId} found on this chain.` },
        );
      } catch {
        if (!stale) {
          setResolution({ kind: "warn", text: "Could not resolve this project right now." });
        }
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [chainId, value]);

  return (
    <div className="min-w-0">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9]/gu, "").slice(0, 12))}
        disabled={disabled}
        inputMode="numeric"
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={resolution ? hintId : undefined}
        aria-invalid={resolution?.kind === "warn"}
        className={className}
      />
      {resolution ? (
        <p
          id={hintId}
          className={`mt-1 px-1 text-xs leading-relaxed ${
            resolution.kind === "warn" ? "text-red-600" : "text-zinc-500"
          }`}
        >
          {resolution.text}
        </p>
      ) : null}
    </div>
  );
}
