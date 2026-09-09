"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A term whose definition appears on hover, marked by a dotted underline.
 *
 * The underline rather than an icon, for anything rendered AS TEXT: it attaches to the exact
 * word being defined instead of floating beside it, it is the `<abbr>`/`<dfn>` convention
 * readers already know, and it adds no visual mass — which is what breaks down when several
 * defined terms sit in a row and each grows a competing glyph.
 *
 * Matches the affordance `StagesTable`'s `TooltipLabel` has always used, so the app has one
 * way of saying "this word has a definition" rather than two.
 *
 * An icon is only right where there is no text to underline. There is no such case here today;
 * if one appears, add `QuestionMarkCircle` back rather than switching this.
 *
 * Distinct from `InfoTip` (ⓘ), which qualifies data that is shown rather than defining a term.
 */
export function ConceptTerm({
  note,
  children,
  className,
}: {
  note: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        // The browser's own `title` tooltip waits about a second and cannot be
        // tuned, which reads as nothing happening. This is the same panel the
        // rest of the app uses, on the app's own delay.
      >
        <span
          tabIndex={0}
          className={[
            "cursor-help border-b border-dotted border-zinc-400 transition-colors",
            "hover:border-zinc-600 focus:border-zinc-600 focus:outline-none",
            className ?? "",
          ].join(" ")}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed font-normal">
        {note}
      </TooltipContent>
    </Tooltip>
  );
}
