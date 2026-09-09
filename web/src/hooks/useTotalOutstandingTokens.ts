import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";

export function useTotalOutstandingTokens() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const { data } = useBendystrawQuery(ProjectOperation, {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version: 6,
  });

  const suckerGroupId = data?.project?.suckerGroupId;
  const { data: suckerGroup } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, chainId: Number(chainId) },
  );

  return BigInt(suckerGroup?.suckerGroup?.tokenSupply ?? 0);
}
