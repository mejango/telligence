"use client";

import { chainDisplayName } from "@/app/constants";
import EtherscanLink from "@/components/EtherscanLink";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";

/**
 * Says so when a project points at a contract this app does not recognize, or when the check
 * could not finish. Renders nothing while it runs and nothing for a project whose contracts are
 * all known. The same check, from the SDK, as juicebox.money's.
 */
export function ProjectContractWarning({
  projects,
  isRevnet,
}: {
  projects: readonly { chainId: number; projectId: number | bigint }[];
  isRevnet: boolean;
}) {
  const chains = projects.map((project) => [project.chainId, Number(project.projectId)] as const);
  const { data, isError } = useQuery({
    queryKey: ["project-contract-audit", chains, isRevnet],
    queryFn: async () => {
      // Loaded on demand: the check's readers stay out of the page's first load.
      const [{ auditProjectContracts }, { publicClientFor }] = await Promise.all([
        import("@bananapus/nana-sdk-core/review/contract-audit"),
        import("./v6/operator/operatorLib"),
      ]);
      return Promise.all(
        chains.map(([chainId, projectId]) =>
          auditProjectContracts(publicClientFor(chainId as JBChainId), {
            chainId: chainId as JBChainId,
            projectId: BigInt(projectId),
            isRevnet,
          }),
        ),
      );
    },
    staleTime: 5 * 60_000,
  });
  if (!data && !isError) return null;
  const unknown = data?.flatMap((audit) => audit.unknown) ?? [];
  const failed = isError
    ? chains.map(([chainId]) => chainDisplayName(chainId))
    : data!.filter((audit) => audit.failed).map((audit) => chainDisplayName(audit.chainId));
  if (!unknown.length && !failed.length) return null;

  const frame = "border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900";
  if (!unknown.length) {
    return (
      <div role="status" className={frame}>
        <p className="font-medium">Could not verify this project’s contracts</p>
        <p className="mt-1">
          The contract check did not finish on {failed.join(", ")}. That is not evidence the
          contracts are canonical. Reload, or review them yourself, before transacting.
        </p>
      </div>
    );
  }
  return (
    <div role="status" className={frame}>
      <p className="font-medium">Unknown project contracts</p>
      <p className="mt-1">
        This project uses contracts this app does not recognize. Some data may load, but this app
        cannot verify how those contracts behave.
      </p>
      <ul className="mt-3 space-y-2">
        {unknown.map((row) => (
          <li key={`${row.chainId}:${row.role}:${row.address}`}>
            <span className="font-medium">
              {chainDisplayName(row.chainId)} | {row.role}
            </span>{" "}
            <EtherscanLink
              value={row.address}
              chain={JB_CHAINS[row.chainId]?.chain}
              className="break-all underline"
            />
            <span className="block text-xs">{row.note}</span>
          </li>
        ))}
      </ul>
      {failed.length ? (
        <p className="mt-3">
          The check also did not finish on {failed.join(", ")}, so contracts there are unverified.
        </p>
      ) : null}
    </div>
  );
}
