"use client";

import { ProjectContentSkeleton, ProjectPageSkeleton } from "@/components/loading/LoadingSkeletons";
import { useJBProject } from "@/lib/nana/project";
import { getProjectNavigationHint } from "@/lib/project-navigation";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";

export default function Loading() {
  const project = useJBProject();
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();

  // When the project layout is already mounted, preserve its real header and
  // only ghost the changing tab. On first entry there is no layout context yet,
  // so render the complete shell with identity seeded by the clicked link.
  return project ? (
    <ProjectContentSkeleton segment={segment} />
  ) : (
    <ProjectPageSkeleton hint={getProjectNavigationHint(pathname)} />
  );
}
