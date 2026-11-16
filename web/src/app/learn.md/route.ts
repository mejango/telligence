import { guideMarkdownResponse } from "@/lib/guide-markdown";
import { LEARN_GUIDE } from "@/lib/learn-guide";

export const revalidate = 3600;

/** The Learn guide as markdown, for agents. */
export function GET() {
  return guideMarkdownResponse(LEARN_GUIDE, "/learn");
}
