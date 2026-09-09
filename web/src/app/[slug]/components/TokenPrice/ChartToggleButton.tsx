"use client";

import { ConceptTerm } from "@/components/ui/ConceptTerm";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  active: boolean;
  disabled?: boolean;
  colorVar: `--chart-${number}`;
  onClick: () => void;
  /** What this price MEANS. Carried by the button itself so the whole target reveals it; the
   *  (?) beside the label is the affordance saying so. */
  note?: string;
}

export function ChartToggleButton({
  label,
  active,
  disabled = false,
  colorVar,
  onClick,
  note,
}: Props) {
  const isActive = active && !disabled;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
        disabled && "cursor-not-allowed",
        isActive
          ? `bg-[${colorVar}]/10 text-[${colorVar}] ring-1 ring-[${colorVar}]/30`
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
      )}
      style={
        isActive
          ? {
              backgroundColor: `color-mix(in srgb, var(${colorVar}) 10%, transparent)`,
              color: "rgb(24 24 27)",
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(${colorVar}) 30%, transparent)`,
            }
          : undefined
      }
    >
      <span
        className={cn("w-2.5 h-2.5 rounded-full", !isActive && "bg-zinc-300")}
        style={isActive ? { backgroundColor: `var(${colorVar})` } : undefined}
      />
      {note ? <ConceptTerm note={note}>{label}</ConceptTerm> : label}
    </button>
  );
}
