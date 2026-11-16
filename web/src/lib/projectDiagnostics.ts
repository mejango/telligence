import type { JBChainId } from "@bananapus/nana-sdk-core";
import type { Address } from "viem";
import type { readProjectDiagnostics } from "./projectDiagnostics.server";

export async function loadProjectDiagnostics(
  chainId: JBChainId,
  projectId: bigint,
  operator?: Address,
): Promise<Awaited<ReturnType<typeof readProjectDiagnostics>>> {
  const params = new URLSearchParams({ chainId: String(chainId), projectId: projectId.toString() });
  if (operator) params.set("operator", operator);
  const response = await fetch(`/api/project-diagnostics?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Deployment checks are unavailable.");
  return response.json();
}
