"use client";

import { InformationCircle } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Qualifies DATA that is shown — an approximation, a sampling caveat, a stale read. Defining a
 * TERM is `ConceptTerm`'s job, which underlines the word instead of adding a glyph beside it.
 *
 * A small icon that carries a caveat without taking a line of the layout.
 *
 * For notes that are ALWAYS true of a given project rather than notes about something being
 * wrong — a permanent banner reads as a warning and trains the reader to ignore it. Anything
 * saying data is missing or a source is down belongs inline, where it cannot be missed.
 *
 * No `title` alongside it: the browser would show its own slower copy on top of this one.
 * `aria-label` carries the text for assistive tech, and the panel opens on tap.
 */
export function InfoTip({ note }: { note: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={note}
            className="flex items-center justify-center text-zinc-400 transition-colors hover:text-zinc-600"
          >
            <InformationCircle className="h-[18px] w-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
          {note}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
