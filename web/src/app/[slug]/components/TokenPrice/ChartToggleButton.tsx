"use client";

import { ConceptTerm } from "@/components/ui/ConceptTerm";
import { cn } from "@/lib/utils";
import { useProjectNavigation } from "../../ProjectRouteContext";

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
  const navigate = useProjectNavigation();
  const isActive = active && !disabled;

  return (
    <button
      aria-pressed={isActive}
      data-project-navigation="local"
      onClick={() => navigate(onClick)}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 transition-opacity",
        disabled && "cursor-not-allowed",
        !isActive && "opacity-45",
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: `var(${colorVar})` }}
      />
      {note ? <ConceptTerm note={note}>{label}</ConceptTerm> : label}
    </button>
  );
}
