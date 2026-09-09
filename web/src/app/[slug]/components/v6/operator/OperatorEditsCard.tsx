"use client";

import { EditMetadataDialog } from "@/app/[slug]/about/components/EditMetadataDialog";
import { ChangeSplitRecipientsDialog } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import { currentStageIndex } from "@/app/[slug]/owners/components/splitsLib";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchProjectRulesets } from "@/hooks/useFetchProjectRulesets";
import { useJBChainId } from "@/lib/nana/project";
import { useSuckers } from "@/lib/nana/suckers";
import { ProjectItem } from "../shared";
import { OperatorSection } from "./OperatorSection";
import { ProjectHandleEditor } from "./ProjectHandleEditor";
import type { ChainProjectRow } from "./operatorLib";

/**
 * website/-parity renderEditsCard: the operator's edit actions, each reusing
 * the app's existing dialog. "Set token metadata" is intentionally absent —
 * Token identity edits live in the Owners Token panel, immediately above the
 * Owners subtabs, where their omnichain state is visible in context.
 */
export function OperatorEditsCard({
  projects,
  handleProject,
  fallbackOperator,
}: {
  projects: ProjectItem[];
  handleProject: ChainProjectRow;
  fallbackOperator?: string;
}) {
  const chainId = useJBChainId();
  const { data: suckers } = useSuckers();
  const { suckerPairsWithRulesets } = useFetchProjectRulesets(suckers);

  // The current stage on the page's chain. Shares the splits subtab's derivation rather than
  // restating it — the previous local copy used `findIndex(start > now)`, which returns -1
  // once the last stage begins and pinned every edit to stage 1 from then on.
  const rulesets = suckerPairsWithRulesets?.find(
    (sucker) => sucker.peerChainId === chainId,
  )?.rulesets;
  const currentStageIdx = currentStageIndex(rulesets);

  return (
    <OperatorSection title="Edits">
      <div className="space-y-4">
        <div className="bg-melon-50 p-4">
          <p className="text-sm font-medium">Set project metadata</p>
          <p className="text-xs text-zinc-500 mt-1 mb-3">
            Update the project&apos;s name, logo, description, links, and tags. Requires the project
            operator&apos;s SET_PROJECT_URI permission.
          </p>
          <EditMetadataDialog projects={projects} triggerVariant="secondary" />
        </div>
        <ProjectHandleEditor project={handleProject} fallbackOperator={fallbackOperator} />
        <div className="bg-melon-50 p-4">
          <p className="text-sm font-medium">Set splits</p>
          <p className="text-xs text-zinc-500 mt-1 mb-3">
            Edit the split recipients for the current stage. Requires the revnet operator&apos;s
            SET_SPLIT_GROUPS permission.
          </p>
          {chainId ? (
            <ChangeSplitRecipientsDialog
              stageIdx={currentStageIdx}
              initialChainId={chainId}
              triggerVariant="secondary"
            />
          ) : (
            <Skeleton className="h-8 w-36" />
          )}
        </div>
      </div>
    </OperatorSection>
  );
}
