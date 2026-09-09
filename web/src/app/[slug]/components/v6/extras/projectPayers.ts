import { chainSortIndex } from "@/app/constants";
import { projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import type { ProjectPayer, ProjectPayerFilter } from "@/lib/bendystraw/types";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { ProjectItem } from "../shared";

/** A sucker-group project on a chain this UI understands. */
export type ChainProjectRow = { chainId: JBChainId; projectId: number };

/** JB_CHAINS-known rows, in the app's canonical chain order. */
export function chainProjectRows(projects: ProjectItem[]): ChainProjectRow[] {
  return projects
    .filter((p) => Boolean(JB_CHAINS[p.chainId as JBChainId]))
    .map((p) => ({ chainId: p.chainId as JBChainId, projectId: p.projectId }))
    .sort((a, b) => chainSortIndex(a.chainId) - chainSortIndex(b.chainId));
}

export type PayerRow = Pick<
  ProjectPayer,
  | "chainId"
  | "projectId"
  | "version"
  | "address"
  | "defaultAddToBalance"
  | "defaultBeneficiary"
  | "owner"
  | "paymentsCount"
  | "addToBalanceCount"
  | "totalFacilitated"
  | "totalFacilitatedUsd"
  | "lastUsedAt"
  | "createdAt"
>;

/** Per-project (chainId, projectId) filter for v6 projects. */
export function payersWhere(rows: readonly ChainProjectRow[]): ProjectPayerFilter {
  return projectRefsWhere(rows.map((row) => ({ ...row, version: 6 }))) ?? { OR: [] };
}

/** Bendystraw USD aggregates are 18-decimal fixed-point. */
export function usdFromScaled(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return Number(BigInt(String(value).split(".")[0]) / 1_000_000_000_000n) / 1e6;
  } catch {
    return null;
  }
}

/**
 * USD for display. Cents matter up to $1,000 — at $340.50 they still carry meaning — and a
 * real amount below a cent shows as `<$0.01` rather than `$0.00`, because rounding a
 * payment to zero reads as "nothing happened". See lib/number.ts for the full policy.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  if (value < 0 && value > -0.01) return ">-$0.01";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2,
  });
}
