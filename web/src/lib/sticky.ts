import { chainDisplayName as chainName } from "@/app/constants";
import { chainRevert } from "@/lib/contract-revert";
import { jbV6ContractAddress, type JBChainId } from "@bananapus/nana-sdk-core";
import {
  STICKY_CRITERIA_BASE,
  STICKY_DEFAULT_GROUP_ID,
  STICKY_MAX_CRITERIA_WEEKS,
  describeStickySplit,
  isStickySplit,
  stickyDistributorAddress,
  stickyGroupId,
  validateStickyGroupId,
} from "@bananapus/nana-sdk-core/v6";
import {
  BaseError,
  ContractFunctionZeroDataError,
  erc20Abi,
  isAddressEqual,
  type Address,
  type PublicClient,
} from "viem";

const truncateAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * A Sticky split pays the holders of a Sticky project's token. Its hook is the
 * chain's StickyDistributor, its beneficiary is the Sticky token, and its
 * projectId is the reward group: 0 for every holder by voting power, or a
 * tenure group of holders stuck a range of weeks.
 *
 * The distributor never reverts: an invalid group, or a tenure group whose
 * token the Sticky hook does not track, silently funds group 0. So the app
 * checks the token and the group on every target chain before it submits.
 * A revnet always deploys its ERC-20, so its reserved tokens can always reach
 * the distributor; only the destination token needs checking. Mirrors
 * juicebox-money's src/lib/sticky.ts.
 */

export { STICKY_MAX_CRITERIA_WEEKS };

/** Whether `hook` is the StickyDistributor on `chainId` (false where Sticky is not deployed). */
export function isStickyHook(hook: string, chainId: number): boolean {
  try {
    return isStickySplit({ hook: hook as Address }, chainId as JBChainId);
  } catch {
    return false;
  }
}

/** A split row that pays Sticky holders: a hook row whose hook is the Sticky distributor. */
export function isStickyRow(row: { kind?: unknown; hookKind?: unknown }): boolean {
  return row.kind === "hook" && row.hookKind === "sticky";
}

/** The chains in `chainIds` with no StickyDistributor, where Sticky splits can't be encoded. */
function chainsWithoutSticky(chainIds: readonly number[]): number[] {
  return chainIds.filter((chainId) => {
    try {
      stickyDistributorAddress(chainId as JBChainId);
      return false;
    } catch {
      return true;
    }
  });
}

/** Why Sticky can't be offered on `chainIds`, or null when it can. */
export function stickyUnavailableReason(chainIds: readonly number[]): string | null {
  const gap = chainsWithoutSticky(chainIds);
  return gap.length > 0 ? `Sticky is not deployed on ${gap.map(chainName).join(", ")}.` : null;
}

/** The StickyDistributor to encode on `chainId`, throwing where Sticky is not deployed. */
export function requireStickyDistributor(chainId: number): Address {
  try {
    return stickyDistributorAddress(chainId as JBChainId);
  } catch {
    throw new Error(`Sticky is not deployed on ${chainName(chainId)}.`);
  }
}

/** The editable group fields of a Sticky split row. */
export type StickyGroupDraft = {
  stickyGroup: "all" | "tenure";
  stickyMinWeeks: string;
  stickyMaxWeeks: string;
};

const WHOLE = /^\d{1,3}$/;

/** A stored row's group fields, with the defaults a row saved before Sticky lacks. */
export function stickyGroupOf(row: Partial<StickyGroupDraft>): StickyGroupDraft {
  return {
    stickyGroup: row.stickyGroup === "tenure" ? "tenure" : "all",
    stickyMinWeeks: row.stickyMinWeeks ?? "",
    stickyMaxWeeks: row.stickyMaxWeeks ?? "",
  };
}

/** Why the group fields can't be encoded, or null when they can. */
export function stickyGroupDraftError(draft: StickyGroupDraft): string | null {
  if (draft.stickyGroup === "all") return null;
  const min = draft.stickyMinWeeks.trim();
  const max = draft.stickyMaxWeeks.trim();
  if (!WHOLE.test(min)) return "Enter the minimum weeks";
  if (max !== "" && !WHOLE.test(max)) return "Enter whole weeks";
  // Checked before encoding: a larger maximum would carry into the minimum.
  if (max !== "" && Number(max) > STICKY_MAX_CRITERIA_WEEKS) {
    return `Maximum weeks can't be more than ${STICKY_MAX_CRITERIA_WEEKS}.`;
  }
  return validateStickyGroupId(
    BigInt(min) * STICKY_CRITERIA_BASE + (max === "" ? 0n : BigInt(max)),
  );
}

/** The split `projectId` the group fields encode. Assumes `stickyGroupDraftError` passed. */
export function stickyDraftGroupId(draft: StickyGroupDraft): bigint {
  if (draft.stickyGroup === "all") return STICKY_DEFAULT_GROUP_ID;
  const max = draft.stickyMaxWeeks.trim();
  return stickyGroupId({
    minWeeks: Number(draft.stickyMinWeeks.trim()),
    maxWeeks: max === "" ? 0 : Number(max),
  });
}

/** The group fields for an encoded group ID (an invalid ID reads as group 0, where it pays). */
export function stickyGroupDraft(groupId: bigint): StickyGroupDraft {
  if (groupId === STICKY_DEFAULT_GROUP_ID || validateStickyGroupId(groupId)) {
    return { stickyGroup: "all", stickyMinWeeks: "", stickyMaxWeeks: "" };
  }
  const max = groupId % STICKY_CRITERIA_BASE;
  return {
    stickyGroup: "tenure",
    stickyMinWeeks: String(groupId / STICKY_CRITERIA_BASE),
    stickyMaxWeeks: max === 0n ? "" : String(max),
  };
}

/** "Sticky holders stuck 4 to 52 weeks → STICKY"; the token address stands in for a missing symbol. */
export function stickyRecipientLabel(
  split: { projectId: bigint; beneficiary: string },
  symbol?: string | null,
): string {
  return `${describeStickySplit({ projectId: split.projectId })} → ${
    symbol ? symbol : truncateAddress(split.beneficiary)
  }`;
}

// Only the two views the distributor itself uses; the full Sticky ABIs are large.
const stickyTokenAbi = [
  {
    type: "function",
    name: "PROJECT_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const stickyHookAbi = [
  {
    type: "function",
    name: "tokenOf",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

export type StickyTokenCheck = { ok: true; symbol: string } | { ok: false; reason: string };

function reverted(error: unknown): boolean {
  return (
    chainRevert(error) !== null ||
    (error instanceof BaseError &&
      !!error.walk((cause) => cause instanceof ContractFunctionZeroDataError))
  );
}

/**
 * Whether `token` is a Sticky token the Sticky hook tracks on `chainId`: the
 * same test the distributor runs, `StickyHook.tokenOf(token.PROJECT_ID()) == token`.
 */
export async function checkStickyToken(
  client: PublicClient,
  chainId: number,
  token: Address,
): Promise<StickyTokenCheck> {
  const where = chainName(chainId);
  const hook = (jbV6ContractAddress.StickyHook as Partial<Record<number, Address>>)[chainId];
  if (!hook) return { ok: false, reason: `Sticky is not deployed on ${where}.` };
  let projectId: bigint;
  try {
    projectId = await client.readContract({
      address: token,
      abi: stickyTokenAbi,
      functionName: "PROJECT_ID",
    });
  } catch (error) {
    return reverted(error)
      ? { ok: false, reason: `${truncateAddress(token)} is not a Sticky token on ${where}.` }
      : { ok: false, reason: `Could not check the Sticky token on ${where}.` };
  }
  let tracked: Address;
  try {
    tracked = await client.readContract({
      address: hook,
      abi: stickyHookAbi,
      functionName: "tokenOf",
      args: [projectId],
    });
  } catch {
    return { ok: false, reason: `Could not check the Sticky token on ${where}.` };
  }
  if (!isAddressEqual(tracked, token)) {
    return { ok: false, reason: `${truncateAddress(token)} is not a Sticky token on ${where}.` };
  }
  const symbol = await client
    .readContract({ address: token, abi: erc20Abi, functionName: "symbol" })
    .catch(() => "");
  return { ok: true, symbol };
}

/**
 * The first reason any Sticky split can't be submitted on `chainIds`, or null.
 * Checks each distinct token once per chain, and every group ID.
 */
export async function stickySplitsProblem(
  splits: readonly { beneficiary: Address; projectId: bigint }[],
  chainIds: readonly number[],
  clientFor: (chainId: number) => PublicClient,
): Promise<string | null> {
  for (const split of splits) {
    const reason = validateStickyGroupId(split.projectId);
    if (reason) return reason;
  }
  const tokens = [...new Set(splits.map((split) => split.beneficiary.toLowerCase()))] as Address[];
  const checks = await Promise.all(
    chainIds.flatMap((chainId) =>
      tokens.map((token) => checkStickyToken(clientFor(chainId), chainId, token)),
    ),
  );
  const failed = checks.find((check) => !check.ok);
  return failed && !failed.ok ? failed.reason : null;
}
