"use client";

import { useMemo } from "react";
import { ProjectItem } from "../shared";
import { BuybackRouterCard } from "./BuybackRouterCard";
import { OperatorAccountCard } from "./OperatorAccountCard";
import { OperatorEditsCard } from "./OperatorEditsCard";
import { PermissionsCard } from "./PermissionsCard";
import { SafeQueueCard } from "./SafeQueueCard";
import { SuckerExtensionCard } from "./SuckerExtensionCard";
import type { ChainProjectRow } from "./operatorLib";
import { chainProjectRows } from "./operatorLib";

/**
 * website/-parity Operator tab (renderBackOfficeSection, revnet branch): the
 * Account card (per-chain operator + account type + transfer via
 * REVOwner.setOperatorOf), the Edits card (reused metadata/splits dialogs),
 * the Chains card (operator extends the sucker group to a new chain via
 * REVDeployer.deploySuckersFor), the Buyback & swap router card
 * (data-hook-resolved reads + the three registry writes), and the read-only
 * Permissions card.
 */
export function V6OperatorTab({
  projects,
  operator,
  handleProject,
}: {
  projects: ProjectItem[];
  operator?: string;
  handleProject: ChainProjectRow;
}) {
  const rows = useMemo(() => chainProjectRows(projects), [projects]);

  if (rows.length === 0) {
    return <div className="text-zinc-500">Revnet operator tools are on the way.</div>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <OperatorAccountCard
        rows={rows}
        fallbackOperator={operator}
        fallbackProject={handleProject}
      />
      <SafeQueueCard rows={rows} fallbackOperator={operator} fallbackProject={handleProject} />
      <OperatorEditsCard
        projects={projects}
        handleProject={handleProject}
        fallbackOperator={operator}
      />
      <SuckerExtensionCard rows={rows} />
      <BuybackRouterCard rows={rows} fallbackOperator={operator} fallbackProject={handleProject} />
      <PermissionsCard rows={rows} />
    </div>
  );
}
