import { SuckerGroupOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { COMPUTE_CHAIN_ID } from "@/lib/telligence/transactions";
import { unstable_cache } from "next/cache";

export const getSuckerGroup = unstable_cache(
  async (suckerGroupId: string, chainId: number) => {
    if (chainId !== COMPUTE_CHAIN_ID) return null;
    try {
      const result = await queryBendystraw(chainId, SuckerGroupOperation, { id: suckerGroupId });
      const group = result.suckerGroup;
      const projects = group?.projects?.items?.filter(
        (project) => project.chainId === COMPUTE_CHAIN_ID,
      );
      if (!group || !projects?.length) return null;
      // These deployments feed chain selectors and transaction tabs. Indexer
      // peers must not expand Telligence's supported transaction network.
      return { ...group, projects: { ...group.projects, items: projects } };
    } catch (err) {
      console.error((err as Error).message);
      return null;
    }
  },
  ["telligence-getSuckerGroup-base"],
  { revalidate: 15 },
);
