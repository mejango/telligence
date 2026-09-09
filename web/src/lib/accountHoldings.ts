import { mainnet } from "@/lib/chains";

export {
  projectRefKey,
  projectRefsWhere,
  projectRefsWheres,
  REF_LOOKUP_BATCH_SIZE,
} from "@/lib/bendystraw/projectRefs";
/**
 * The account view spans chains, so it has no single chainId to route its
 * Bendystraw queries by (project pages route by the project's own chain).
 * This app browses the production networks only, so every account query pins
 * the mainnet endpoint through this ONE constant — change it here if a
 * testnet account mode ever exists.
 */
export const ACCOUNT_BENDYSTRAW_CHAIN_ID: number = mainnet.id;
