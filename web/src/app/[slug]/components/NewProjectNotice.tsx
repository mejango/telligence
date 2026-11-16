"use client";

import { useSecondsUntil } from "@/hooks/useSecondsUntil";
import { formatSeconds } from "@/lib/utils";

interface NewProjectNoticeProps {
  startDate: number;
}

export function NewProjectNotice({ startDate }: NewProjectNoticeProps) {
  const timeUntilStart = useSecondsUntil(startDate);
  if (!timeUntilStart) return null;

  return (
    <div className="bg-orange-100 px-4 py-2.5 text-orange-950 text-sm">
      Starts in {formatSeconds(timeUntilStart)}
    </div>
  );
}
