"use client";

import { STICKY_MAX_CRITERIA_WEEKS, type StickyGroupDraft } from "@/lib/sticky";
import { useState } from "react";

const inputClassName =
  "h-9 border-2 border-melon-300 bg-melon-25 px-2 py-0 text-md hover:border-melon-400 focus:border-melon-600 focus:outline-none focus:ring-0";

/** Which Sticky holders a split pays: everyone, or holders stuck a range of weeks. */
export function StickyGroupFields({
  value,
  onChange,
  disabled,
}: {
  value: StickyGroupDraft;
  onChange: (patch: Partial<StickyGroupDraft>) => void;
  disabled?: boolean;
}) {
  // No maximum unless asked for: an unchecked box means any length of time.
  const [maxOn, setMaxOn] = useState(value.stickyMaxWeeks !== "");
  const weeksInput = (
    field: "stickyMinWeeks" | "stickyMaxWeeks",
    label: string,
    placeholder: string,
  ) => (
    <input
      type="text"
      inputMode="numeric"
      value={value[field]}
      onChange={(e) => onChange({ [field]: e.target.value.replace(/\D/g, "").slice(0, 3) })}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      className={`${inputClassName} w-16 tabular-nums placeholder:text-zinc-400`}
    />
  );
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-md text-zinc-600">
        <select
          value={value.stickyGroup}
          onChange={(e) =>
            onChange({ stickyGroup: e.target.value as StickyGroupDraft["stickyGroup"] })
          }
          disabled={disabled}
          aria-label="Sticky holders"
          className={`${inputClassName} pr-8`}
        >
          <option value="all">All holders</option>
          <option value="tenure">Holders stuck at least</option>
        </select>
        {value.stickyGroup === "tenure" ? (
          <>
            {weeksInput("stickyMinWeeks", "Minimum weeks stuck", "4")}
            <span>weeks</span>
          </>
        ) : null}
      </div>
      {value.stickyGroup === "tenure" ? (
        <div className="flex min-h-9 flex-wrap items-center gap-2 text-md text-zinc-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={maxOn}
              onChange={(e) => {
                setMaxOn(e.target.checked);
                if (!e.target.checked) onChange({ stickyMaxWeeks: "" });
              }}
              disabled={disabled}
            />
            {maxOn ? "up to" : "Set max time"}
          </label>
          {maxOn ? (
            <>
              {weeksInput("stickyMaxWeeks", "Maximum weeks stuck", "52")}
              <span>weeks</span>
            </>
          ) : null}
        </div>
      ) : null}
      <p className="text-sm text-zinc-500">
        {value.stickyGroup === "all"
          ? "Pays every holder by voting power when each round starts."
          : `Counts stake held that long when each round starts, 1 to ${STICKY_MAX_CRITERIA_WEEKS} weeks.`}
      </p>
    </div>
  );
}
