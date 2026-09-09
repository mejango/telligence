"use client";

export function ParaConnectionNotice({
  onDismiss,
  onRetry,
}: {
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[100] max-w-sm border border-red-200 bg-white p-4 text-sm shadow-lg"
    >
      <p className="font-medium text-zinc-950">Embedded wallet connection needs attention</p>
      <p className="mt-1 text-zinc-700">
        Telligence could not finish connecting your embedded wallet. Browser wallet options still
        work.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 border border-zinc-950 px-3 py-2 font-medium hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 px-3 py-2 text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
