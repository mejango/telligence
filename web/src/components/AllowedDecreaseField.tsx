"use client";

/** How far a return may fall from its quote: presets plus a custom percent. */
export function AllowedDecreaseField({
  bps,
  onChange,
  maxBps = 9_999,
  className = "mt-4",
}: {
  bps: number;
  onChange: (bps: number) => void;
  /** The most the custom field accepts, in basis points. */
  maxBps?: number;
  className?: string;
}) {
  return (
    <div className={`${className} flex flex-wrap items-center gap-2`}>
      <span className="shrink-0 text-sm text-zinc-700">Allowed decrease</span>
      <div className="flex flex-wrap items-center gap-1">
        {[50, 100, 300].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={
              bps === preset
                ? "h-7 px-2 text-sm border border-teal-500 bg-teal-500 text-melon-950"
                : "h-7 px-2 text-sm border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }
          >
            {preset / 100}%
          </button>
        ))}
        <label className="flex h-7 w-[4.75rem] shrink-0 items-center border border-melon-300 bg-melon-25 px-2 text-sm text-zinc-700 focus-within:border-teal-600">
          <span className="sr-only">Custom allowed decrease percent</span>
          <input
            type="number"
            min="0"
            max={maxBps / 100}
            step="0.1"
            inputMode="decimal"
            value={bps / 100}
            onChange={(event) => {
              const bps = Math.round(Number(event.target.value) * 100);
              // Checked after rounding, so a value can't round past the limit.
              if (Number.isFinite(bps) && bps >= 0 && bps <= maxBps) onChange(bps);
            }}
            className="min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-right !shadow-none outline-none !ring-0 focus:!border-0 focus:!shadow-none focus:!ring-0"
          />
          <span>%</span>
        </label>
      </div>
    </div>
  );
}
