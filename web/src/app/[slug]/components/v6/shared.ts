import type { Project } from "@/lib/bendystraw/types";

/** The sucker-group project rows the v6 tabs receive from their server pages. */
export type ProjectItem = Pick<
  Project,
  "projectId" | "token" | "chainId" | "currency" | "decimals" | "tokenSymbol"
>;

type ProjectItemFallbackSource = Pick<
  ProjectItem,
  "token" | "currency" | "decimals" | "tokenSymbol"
>;

/** Keep tabs usable while the sucker-group index is unavailable. */
export function projectItemsWithFallback(
  indexed: readonly ProjectItem[] | null | undefined,
  project: ProjectItemFallbackSource,
  chainId: ProjectItem["chainId"],
  projectId: number | bigint,
): ProjectItem[] {
  if (indexed?.length) return [...indexed];
  return [
    {
      chainId,
      projectId: Number(projectId),
      token: project.token,
      currency: project.currency,
      decimals: project.decimals,
      tokenSymbol: project.tokenSymbol,
    },
  ];
}
