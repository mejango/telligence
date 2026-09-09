import type { ReactNode } from "react";

/** Shared outer treatment for every subsection in the Operator tab. */
export function OperatorSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="max-w-screen-sm border border-melon-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
