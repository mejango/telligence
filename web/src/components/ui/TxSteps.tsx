/**
 * The wallet-prompt queue for a multi-transaction flow, shown before the first
 * prompt so a signer knows how many are coming and why. Steps default to
 * sequential: everything before `activeIndex` is done, and a flow that has
 * finished passes `steps.length`. Pass -1 while nothing is running yet, or
 * an explicit state per step for results that arrive independently.
 */
export function TxSteps({
  steps,
  activeIndex,
  intro,
  ariaLabel,
  className = "mt-3 border border-melon-200 bg-melon-50 p-3",
}: {
  steps: readonly {
    /** Stable list key; falls back to the title when it is a plain string. */
    key?: string;
    title: React.ReactNode;
    /** Independent progress, shown beside the heading rather than buried in details. */
    status?: React.ReactNode;
    /** Overrides sequential progress when results arrive out of order. */
    state?: "pending" | "active" | "complete" | "failed";
    detail?: React.ReactNode;
  }[];
  activeIndex: number;
  intro?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={className} aria-label={ariaLabel}>
      <p className="text-xs leading-relaxed text-zinc-600">
        {intro ??
          (steps.length === 1
            ? "Your wallet will ask for one action."
            : `Your wallet will ask for ${steps.length} actions. This stays open and advances through each one.`)}
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => {
          const state =
            step.state ??
            (activeIndex > index ? "complete" : activeIndex === index ? "active" : "pending");
          const complete = state === "complete";
          const active = state === "active";
          const failed = state === "failed";
          return (
            <li
              key={step.key ?? String(step.title)}
              data-state={state}
              aria-current={active ? "step" : undefined}
              className={`flex items-start gap-2 text-sm ${step.status ? "border-melon-200 not-first:border-t not-first:pt-3" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                  failed
                    ? "border-red-600 bg-red-50 text-red-700"
                    : complete
                      ? "border-melon-400 bg-melon-400 text-zinc-900"
                      : active
                        ? "border-melon-600 bg-melon-50 text-melon-700"
                        : "border-zinc-300 text-zinc-500"
                }`}
              >
                {failed ? "×" : complete ? "✓" : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    step.status
                      ? "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                      : undefined
                  }
                >
                  <span
                    className={
                      active || step.status
                        ? "min-w-0 font-medium text-zinc-900"
                        : "block text-zinc-600"
                    }
                  >
                    <span className="sr-only">
                      Step {index + 1} of {steps.length}:{" "}
                    </span>
                    {step.title}
                  </span>
                  {step.status ? (
                    <span
                      className={`shrink-0 font-medium ${failed ? "text-red-700" : "text-zinc-900"}`}
                    >
                      {step.status}
                    </span>
                  ) : null}
                </span>
                {step.detail ? (
                  <span className="mt-0.5 block text-xs text-zinc-500">{step.detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Two booleans is how progress usually arrives from a status query. */
export function stepStatus(complete: boolean, active: boolean): "done" | "active" | "pending" {
  return complete ? "done" : active ? "active" : "pending";
}

/**
 * A resumable leg of a flow whose steps can already be satisfied out of order,
 * so each carries its own state and its own explanatory body.
 */
export function TxStep({
  number,
  total,
  title,
  status,
  children,
}: {
  number: number;
  total: number;
  title: string;
  status: "done" | "active" | "pending";
  children?: React.ReactNode;
}) {
  const complete = status === "done";
  const active = status === "active";
  return (
    <li className="flex items-start gap-3" aria-current={active ? "step" : undefined}>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
          complete
            ? "border-melon-400 bg-melon-400 text-zinc-900"
            : active
              ? "border-melon-600 bg-melon-50 text-melon-700"
              : "border-zinc-300 text-zinc-500"
        }`}
      >
        {complete ? "✓" : number}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11px] uppercase tracking-wide ${
            complete || active ? "text-melon-700" : "text-zinc-400"
          }`}
        >
          Step {number} of {total}
        </p>
        <p className={`font-medium ${complete || active ? "text-zinc-900" : "text-zinc-500"}`}>
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}
