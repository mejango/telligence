"use client";

import { useRef, useState } from "react";

/** A code example with a copy button. When the browser blocks the clipboard, the code is selected instead. */
export function CodeBlock({ title, code, lang }: { title: string; code: string; lang?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const codeRef = useRef<HTMLElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
    } catch {
      if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current);
      setStatus("failed");
    }
  };

  return (
    <div className="mt-4 border border-black bg-zinc-900">
      {/* Two lines of status fit inside the row's fixed height, so copying never moves the code. */}
      <div className="flex h-11 items-center justify-between gap-3 border-b border-zinc-700 pl-4">
        <p role="status" aria-atomic="true" className="min-w-0 text-xs leading-4 text-melon-100">
          {status === "copied"
            ? "Copied."
            : status === "failed"
              ? "Copy blocked. The code is selected."
              : ""}
        </p>
        <button
          type="button"
          onClick={copy}
          className="h-11 shrink-0 border-l border-melon-700 bg-white px-4 text-sm font-semibold text-melon-900 hover:bg-melon-50 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-melon-800"
        >
          Copy<span className="sr-only"> {title} code</span>
        </button>
      </div>
      <pre
        role="region"
        aria-label={`${title}: code example`}
        className="overflow-x-auto p-4 text-sm leading-6 text-melon-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700"
        tabIndex={0}
      >
        <code ref={codeRef} className={lang ? `language-${lang}` : undefined}>
          {code}
        </code>
      </pre>
    </div>
  );
}
