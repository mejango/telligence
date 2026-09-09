"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAllRulesetsByChain } from "@/hooks/useAllRulesetsByChain";
import {
  useCompleteProjectPayers,
  useCompleteProjectPermissions,
  useCompleteStoredAutoIssuances,
} from "@/hooks/useCompleteBendystrawLists";
import { matchesProjectRef, projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import {
  useJBChainId,
  useJBContractContext,
  useJBProjectMetadataContext,
  useJBTokenContext,
} from "@/lib/nana/project";
import { buildRevnetDraft, revnetDraftFileName } from "@/lib/revnet-draft";
import { pickRevnetOperator } from "@/lib/revnetOperator";
import { formatTokenSymbol } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { useMemo, useState } from "react";
import { getPublicClient } from "wagmi/actions";
import { ProjectItem } from "../shared";
import { PayerAddressList } from "./PayerAddressList";
import { PayerDeployForm } from "./PayerDeployForm";
import { chainProjectRows, payersWhere } from "./projectPayers";

/**
 * website/-parity Extras tab (renderExtrasSection): the "Payer address"
 * deployment form (JBProjectPayerDeployer.deployProjectPayer per selected
 * chain, sequential simulate-first txs) with the sucker group's indexed payer
 * addresses from bendystraw below it.
 */
export function V6ExtrasTab({ projects }: { projects: ProjectItem[] }) {
  const chainId = useJBChainId();
  const { projectId } = useJBContractContext();
  const { metadata } = useJBProjectMetadataContext();
  const { token } = useJBTokenContext();
  const rows = useMemo(() => chainProjectRows(projects), [projects]);
  const projectRefs = useMemo(() => rows.map((row) => ({ ...row, version: 6 })), [rows]);
  const autoIssuancesWhere = useMemo(
    () => projectRefsWhere(projectRefs) ?? { OR: [] },
    [projectRefs],
  );

  const payersQuery = useCompleteProjectPayers(payersWhere(rows), rows.length > 0);
  const payerRows = (payersQuery.data ?? []).filter((row) => matchesProjectRef(row, projectRefs));
  const operatorQuery = useCompleteProjectPermissions({
    chainId: Number(chainId),
    projectId: Number(projectId),
    version: 6,
    isRevnetOperator: true,
  });
  const operator = pickRevnetOperator(operatorQuery.data ?? []);
  const autoIssuancesQuery = useCompleteStoredAutoIssuances(
    autoIssuancesWhere,
    projectRefs.length > 0,
  );
  const rulesetsQuery = useAllRulesetsByChain(
    rows.map((row) => ({
      chainId: row.chainId,
      projectId: row.projectId,
    })),
  );
  const [exportBusy, setExportBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  const exportDraft = async () => {
    if (exportBusy || !operator || !chainId) return;
    setExportBusy(true);
    setExportStatus("Verifying deployed stages, splits, and reserve assets…");
    try {
      const client = getPublicClient(wagmiConfig, { chainId });
      if (!client) throw new Error(`No public client for chain ${chainId}.`);
      const result = await buildRevnetDraft({
        client,
        chainId,
        projectId,
        projects: rows,
        operator,
        metadata: (metadata?.data ?? {}) as Record<string, unknown>,
        tokenSymbol: token?.data ? formatTokenSymbol(token) : "TOKEN",
        autoIssuances: (autoIssuancesQuery.data ?? []).flatMap((row) => {
          const rulesets = rulesetsQuery.data?.[Number(row.chainId)] ?? [];
          const stageIndex = rulesets.findIndex(
            (ruleset) => String(ruleset.id) === String(row.stageId),
          );
          return stageIndex < 0
            ? []
            : [
                {
                  stageIndex,
                  count: row.count,
                  beneficiary: row.beneficiary,
                  chainId: row.chainId,
                },
              ];
        }),
      });
      if (
        result.warnings.length &&
        !window.confirm(`${result.warnings.join("\n\n")}\n\nExport this editable .jb anyway?`)
      ) {
        setExportStatus("Cancelled");
        return;
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result.file, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = revnetDraftFileName(result.file.data.name);
      anchor.click();
      URL.revokeObjectURL(url);
      setExportStatus("Exported .jb. Import it from Create a revnet to review and edit.");
    } catch (error) {
      setExportStatus(
        error instanceof Error ? error.message : "Could not safely reconstruct this revnet.",
      );
    } finally {
      setExportBusy(false);
    }
  };

  if (rows.length === 0) {
    return <div className="text-zinc-500">Nothing here yet.</div>;
  }

  return (
    <div className="flex flex-col min-w-0 gap-8">
      <section className="max-w-screen-sm">
        <h3 className="mb-2 text-base font-semibold text-zinc-700">Export deployment</h3>
        <p className="text-sm text-zinc-500">
          Download this revnet&apos;s deployed stages, splits, reserve asset, and details as a .jb
          file. Import it from Create a revnet to review and change it before deploying.
        </p>
        {exportStatus ? <p className="mt-3 text-sm text-zinc-600">{exportStatus}</p> : null}
        <Button
          className="mt-4"
          variant="outline"
          disabled={
            exportBusy ||
            !operator ||
            !chainId ||
            autoIssuancesQuery.isLoading ||
            rulesetsQuery.isLoading
          }
          onClick={() => void exportDraft()}
        >
          {exportBusy ? "Verifying…" : "Export .jb"}
        </Button>
        {!operator && !operatorQuery.isLoading ? (
          <p className="mt-2 text-xs text-zinc-500">
            The operator must be indexed before this deployment can be exported.
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-zinc-700">Payer address</h3>
        <div className="max-w-screen-sm">
          <p className="text-sm text-zinc-500">
            Create a dedicated address that pays this project whenever it receives ETH. Anyone can
            create and reuse as many payer addresses as they need.
          </p>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" className="mt-4">
                Create payer address
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create payer address</DialogTitle>
                <DialogDescription>
                  Configure how incoming ETH is handled, who receives tokens, and where the address
                  is deployed.
                </DialogDescription>
              </DialogHeader>
              <PayerDeployForm
                rows={rows}
                existingRows={payerRows}
                tokenSymbol={token?.data ? formatTokenSymbol(token) : undefined}
                onDeployed={() => payersQuery.refetch()}
              />
            </DialogContent>
          </Dialog>
        </div>
        <div className="max-w-screen-lg">
          <PayerAddressList
            rows={payerRows}
            isLoading={payersQuery.isLoading}
            isError={payersQuery.isError}
          />
        </div>
      </section>
    </div>
  );
}
