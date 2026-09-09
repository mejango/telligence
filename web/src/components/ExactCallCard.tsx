"use client";

import {
  buildTransactionReviewPrompt,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { useState } from "react";

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

/**
 * The ONE exact-action card: the same chrome whether it appears inside a flow
 * dialog (pay) or the generic transaction safety check — chain eyebrow,
 * destination, action title, caller-supplied rows, a raw-data disclosure, and
 * the tx-audit prompt. Every confirm surface renders payloads through this so
 * "a transaction" always looks the same regardless of which door opened it.
 */
export function ExactCallCard({
  eyebrow,
  destination,
  title,
  children,
  raw,
  auditRequest,
}: {
  /** Uppercase context line, e.g. "BASE" or "CALL 1 OF 2 | BASE | 8453". */
  eyebrow: string;
  /** Resolved destination line, e.g. "Permit2 | 0x…". */
  destination?: string;
  title: string;
  children: React.ReactNode;
  /** Pretty JSON for the Show raw data disclosure. */
  raw: string;
  /** The request the audit-prompt button copies for an LLM review. */
  auditRequest: TransactionReviewRequest;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <section className="rounded border border-melon-200 bg-melon-50 p-3 text-xs">
      <div>
        <p className="uppercase tracking-wide text-zinc-500">{eyebrow}</p>
        {destination ? <p className="mt-1 break-all text-zinc-600">{destination}</p> : null}
        <p className="mt-2 text-sm font-medium text-zinc-900">{title}</p>
      </div>
      {children}
      <details className="mt-3 border-t border-melon-200 pt-2">
        <summary className="cursor-pointer select-none text-zinc-500">Show raw data</summary>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all border border-melon-300 bg-melon-100 p-3 font-mono text-xs leading-relaxed text-melon-950">
          {raw}
        </pre>
      </details>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="border border-melon-500 bg-melon-100 px-3 py-2 text-xs font-medium hover:bg-melon-200"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildTransactionReviewPrompt(auditRequest));
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
            window.setTimeout(() => setCopyState("idle"), 2200);
          }}
        >
          {copyState === "copied"
            ? "Prompt copied — paste into your LLM"
            : copyState === "failed"
              ? "Could not copy prompt"
              : "[copy tx audit prompt]"}
        </button>
      </div>
    </section>
  );
}
