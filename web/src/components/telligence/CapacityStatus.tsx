import { capacityPresentation } from "@/lib/telligence/presentation";
import type { ProjectSnapshot } from "@/lib/telligence/types";

export function CapacityStatus({
  project,
  className = "",
}: {
  project: ProjectSnapshot;
  className?: string;
}) {
  const capacity = capacityPresentation(project);
  return (
    <span className={`inline-flex items-center gap-2 text-xs ${className}`}>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 ${capacity.tone === "active" ? "bg-melon-700" : capacity.tone === "warning" ? "bg-amber-700" : "bg-melon-600"}`}
      />
      {capacity.label}
    </span>
  );
}
