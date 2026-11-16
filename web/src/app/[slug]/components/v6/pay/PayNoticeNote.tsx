"use client";

import { chainDisplayName } from "@/app/constants";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import type { PayNoticeView } from "@bananapus/nana-sdk-core/v6";

/**
 * Under the pay form: a notice that could not be read gets one quiet
 * line with a retry, and a notice that reads differently on the revnet's
 * other chains can be opened to compare. Neither blocks the payment.
 */
export function PayNoticeNote({ view, retry }: { view: PayNoticeView; retry: () => void }) {
  if (view.failed) {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        The project’s notice could not be loaded.{" "}
        <button
          type="button"
          onClick={retry}
          className="underline underline-offset-2 hover:text-black"
        >
          Retry
        </button>
      </p>
    );
  }
  if (!view.others.length) return null;
  const name = (chainId: number) => chainDisplayName(chainId as JBChainId);
  return (
    <details className="mt-2 text-xs text-zinc-500">
      <summary className="cursor-pointer hover:text-black">
        The notice differs on {view.others.map((row) => name(row.chainId)).join(", ")}.
      </summary>
      <dl className="mt-2 space-y-2">
        {view.others.map((row) => (
          <div key={row.chainId}>
            <dt className="font-medium text-zinc-700">{name(row.chainId)}</dt>
            <dd className="whitespace-pre-wrap break-words">{row.notice || "No notice."}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
