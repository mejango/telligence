import {
  AutoIssueEventsOperation,
  StoreAutoIssuanceAmountEventsOperation,
  useBendystrawQuery,
} from "@/lib/bendystraw";
import { matchesProjectRef } from "@/lib/bendystraw/projectRefs";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { useMemo } from "react";
import { useRulesets } from "./useRulesets";

export function useAutoIssuances() {
  const { projectId } = useJBContractContext();

  const chainId = useJBChainId();
  const numericProjectId = Number(projectId);
  const enabled =
    chainId !== undefined && Number.isSafeInteger(numericProjectId) && numericProjectId > 0;

  const { data: autoIssuancesData } = useBendystrawQuery(
    StoreAutoIssuanceAmountEventsOperation,
    {
      where: { projectId: numericProjectId, chainId: chainId ?? 0, version: 6 },
    },
    { enabled },
  );

  const { data: autoIssueEventsQuery } = useBendystrawQuery(
    AutoIssueEventsOperation,
    {
      where: { projectId: numericProjectId, chainId: chainId ?? 0, version: 6 },
    },
    { enabled },
  );

  const { rulesets } = useRulesets();

  const autoIssuances = useMemo(() => {
    const projectRefs = enabled
      ? [
          {
            chainId: chainId as NonNullable<typeof chainId>,
            projectId: numericProjectId,
            version: 6,
          },
        ]
      : [];
    const storedRows = autoIssuancesData?.storeAutoIssuanceAmountEvents.items.filter((row) =>
      matchesProjectRef(row, projectRefs),
    );
    const issuedRows = autoIssueEventsQuery?.autoIssueEvents.items.filter((row) =>
      matchesProjectRef(row, projectRefs),
    );
    return storedRows?.map((autoIssuance) => {
      // `findIndex` returns -1 when nothing matches, and -1 is TRUTHY — so `|| 0` never fired
      // and an unmatched stageId rendered as "Stage 0" with an undefined start. Mirror
      // V6AutoIssuanceSubtab and leave both undefined instead of inventing a stage.
      const rulesetIndex = rulesets?.findIndex((r) => String(r.id) === autoIssuance.stageId) ?? -1;

      const distributed = issuedRows?.find((event) => {
        return (
          event.stageId === autoIssuance.stageId &&
          event.beneficiary === autoIssuance.beneficiary &&
          event.count === autoIssuance.count
        );
      });

      let distributedTxn: string | undefined = undefined;
      if (distributed) {
        distributedTxn = distributed.id.split("-")[1];
      }
      return {
        ...autoIssuance,
        startsAt: rulesetIndex >= 0 ? rulesets?.[rulesetIndex]?.start : undefined,
        stage: rulesetIndex >= 0 ? rulesetIndex + 1 : undefined,
        distributed: distributed !== undefined,
        distributedTxn,
      };
    });
  }, [autoIssuancesData, rulesets, autoIssueEventsQuery, chainId, numericProjectId, enabled]);
  return autoIssuances;
}
