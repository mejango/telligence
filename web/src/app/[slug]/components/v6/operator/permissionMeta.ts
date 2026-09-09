import { JBPermissionCatalogV6, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";

/**
 * Human labels + blurbs for the 39 v6 permission ids. The ids themselves come
 * from the SDK's JBPermissionIdsV6.
 */
const DESCRIPTIONS: Record<keyof typeof JBPermissionIdsV6, string> = {
  ROOT: "Every permission across all Juicebox contracts. Extreme caution.",
  QUEUE_RULESETS: "Queue new rulesets — future rules, splits, and limits.",
  LAUNCH_RULESETS: "Launch a project's first rulesets.",
  CASH_OUT_TOKENS: "Cash out the holder's tokens for a share of surplus.",
  SEND_PAYOUTS: "Send payouts when the ruleset restricts that to the project owner.",
  MIGRATE_TERMINAL: "Migrate the project's funds between terminals.",
  SET_PROJECT_URI: "Update the project's metadata (name, logo, description).",
  DEPLOY_ERC20: "Deploy the project's ERC-20 token.",
  SET_TOKEN: "Replace the project's token with a custom ERC-20.",
  MINT_TOKENS: "Mint new project tokens without a payment.",
  BURN_TOKENS: "Burn the holder's project tokens.",
  CLAIM_TOKENS: "Claim the holder's internal credits into the ERC-20.",
  TRANSFER_CREDITS: "Transfer the holder's unclaimed credits to another address.",
  SET_CONTROLLER: "Point the project at a new controller contract.",
  SET_TERMINALS: "Replace the project's payment terminals.",
  ADD_TERMINALS: "Add new payment terminals.",
  SET_PRIMARY_TERMINAL: "Set the primary terminal for a token.",
  USE_ALLOWANCE: "Spend from the project's surplus allowance.",
  SET_SPLIT_GROUPS: "Edit split groups — reserved-token and payout recipients.",
  ADD_PRICE_FEED: "Register currency price feeds for the project.",
  ADD_ACCOUNTING_CONTEXTS: "Register tokens the project's terminal accepts.",
  SET_TOKEN_METADATA: "Rename the project's ERC-20 (name and symbol).",
  SIGN_FOR_ERC20: "Provide signatures on the project ERC-20's behalf.",
  ADJUST_721_TIERS: "Add, remove, or change the project's shop items (NFT tiers).",
  SET_721_METADATA: "Update the shop collection's metadata.",
  MINT_721: "Mint the project's shop items (NFTs) without a payment.",
  SET_721_DISCOUNT_PERCENT: "Set per-item shop discount percents.",
  SET_BUYBACK_TWAP: "Tune the buyback hook's TWAP window.",
  SET_BUYBACK_POOL: "Register Uniswap pools on the buyback hook.",
  SET_BUYBACK_HOOK: "Point the project at a buyback hook in the registry.",
  SET_ROUTER_TERMINAL: "Set the terminal router-swapped payments forward into.",
  MAP_SUCKER_TOKEN: "Map bridgeable tokens on the project's suckers.",
  DEPLOY_SUCKERS: "Deploy new suckers (cross-chain bridges) for the project.",
  SET_SUCKER_PEER: "Point a sucker at a new cross-chain peer.",
  SUCKER_SAFETY: "Use the suckers' emergency safety controls.",
  SET_SUCKER_DEPRECATION: "Schedule a sucker's deprecation.",
  OPEN_LOAN: "Open REVLoans against the holder's token collateral.",
  REALLOCATE_LOAN: "Reallocate collateral across the holder's loans.",
  REPAY_LOAN: "Repay the holder's loans and reclaim collateral.",
};

export type PermissionInfo = { id: number; name: string; label: string; description: string };

function labelFromName(name: string): string {
  const words = name.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const V6_PERMISSIONS: PermissionInfo[] = JBPermissionCatalogV6.map(({ key: name, id }) => ({
  id,
  name,
  label: labelFromName(name),
  description: DESCRIPTIONS[name],
}));

const BY_ID = new Map(V6_PERMISSIONS.map((p) => [p.id, p]));

export function permissionInfo(id: number): PermissionInfo {
  return (
    BY_ID.get(id) ?? {
      id,
      name: `PERMISSION_${id}`,
      label: `Permission #${id}`,
      description: "Unrecognized permission id (newer than this UI).",
    }
  );
}
