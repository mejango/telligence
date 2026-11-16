import { BUILD_GUIDE } from "@/lib/build-guide";
import { guideMarkdownResponse } from "@/lib/guide-markdown";

export const revalidate = 3600;

/** The Build guide as markdown, for agents. */
export function GET() {
  return guideMarkdownResponse(BUILD_GUIDE, "/build");
}
