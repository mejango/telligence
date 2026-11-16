"use client";

/** One `Label: value` line — the row grammar every exact-action card shares. */
export function CallRow({
  label,
  mono = true,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-1">
      <dt className="shrink-0 text-zinc-500">{label}:</dt>
      <dd className={`min-w-0 break-all text-zinc-800 ${mono ? "font-mono text-xs" : ""}`}>
        {children}
      </dd>
    </div>
  );
}
