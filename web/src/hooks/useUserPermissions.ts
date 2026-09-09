import { useViewedAccount } from "@/hooks/useViewedAccount";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import {
  getJBContractAddress,
  JBCoreContracts,
  jbPermissionsAbi,
  jbProjectsAbi,
} from "@bananapus/nana-sdk-core";
import { decodePermissionBitmap, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePublicClient } from "wagmi";

type JBPermissionKey = keyof typeof JBPermissionIdsV6;
const ALL_PERMISSION_IDS = Object.values(JBPermissionIdsV6);
const NO_PERMISSIONS: number[] = [];

export function useUserPermissions() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();
  const { address } = useViewedAccount();
  const publicClient = usePublicClient({ chainId });
  const enabled = !!chainId && !!projectId && !!address && !!publicClient;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["live-project-permissions", chainId, projectId?.toString(), address?.toLowerCase()],
    enabled,
    staleTime: 15_000,
    retry: false,
    queryFn: async (): Promise<number[]> => {
      if (!chainId || !projectId || !address || !publicClient) return NO_PERMISSIONS;
      const owner = await publicClient.readContract({
        address: getJBContractAddress(JBCoreContracts.JBProjects, 6, chainId),
        abi: jbProjectsAbi,
        functionName: "ownerOf",
        args: [projectId],
      });
      if (owner.toLowerCase() === address.toLowerCase()) return ALL_PERMISSION_IDS;

      // Grants belong to the current NFT owner. Combine its project-specific
      // and wildcard scopes instead of trusting an indexed operator row.
      const permissionsAddress = getJBContractAddress(JBCoreContracts.JBPermissions, 6, chainId);
      const [projectPermissions, wildcardPermissions] = await Promise.all(
        [projectId, 0n].map((scope) =>
          publicClient.readContract({
            address: permissionsAddress,
            abi: jbPermissionsAbi,
            functionName: "permissionsOf",
            args: [address, owner, scope],
          }),
        ),
      );
      const permissions = decodePermissionBitmap(projectPermissions | wildcardPermissions);
      return permissions.includes(JBPermissionIdsV6.ROOT) ? ALL_PERMISSION_IDS : permissions;
    },
  });
  // React Query keeps old data after a failed refetch; it must not keep granting access.
  const userPermissions = enabled && !isError ? (data ?? NO_PERMISSIONS) : NO_PERMISSIONS;

  const hasPermission = useMemo(
    () => (permission: JBPermissionKey) => {
      const permissionId = JBPermissionIdsV6[permission as keyof typeof JBPermissionIdsV6];
      return permissionId !== undefined && userPermissions.includes(permissionId);
    },
    [userPermissions],
  );

  return {
    hasPermission,
    permissions: userPermissions,
    isLoading,
  };
}
