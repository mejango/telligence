import { chainDisplayName, chainSortIndex } from "@/app/constants";
import { requireOnchainExecution } from "@/hooks/useReviewedWriteContract";
import { projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import type { PermissionHolder, PermissionHolderFilter } from "@/lib/bendystraw/types";
import type { AuthorityIdentity } from "@/lib/cross-chain-authority";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  getJBContractAddress,
  JB_CHAINS,
  JBChainId,
  jbContractAddress,
  JBCoreContracts,
  jbProjectsAbi,
  RevnetCoreContracts,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { Abi, Address, PublicClient } from "viem";
import { getAccount, getPublicClient, switchChain } from "wagmi/actions";
import { ProjectItem } from "../shared";

/** A sucker-group project on a chain this UI understands. */
export type ChainProjectRow = { chainId: JBChainId; projectId: number };

/** JB_CHAINS-known rows, in the app's canonical chain order. */
export function chainProjectRows(projects: ProjectItem[]): ChainProjectRow[] {
  return projects
    .filter((p) => Boolean(JB_CHAINS[p.chainId as JBChainId]))
    .map((p) => ({ chainId: p.chainId as JBChainId, projectId: p.projectId }))
    .sort((a, b) => chainSortIndex(a.chainId) - chainSortIndex(b.chainId));
}

export function chainName(chainId: number): string {
  return chainDisplayName(chainId);
}

/** A v6 contract's address on a chain, or undefined where it isn't deployed. */
export function v6ContractAddress(
  contract: keyof (typeof jbContractAddress)["6"],
  chainId: JBChainId,
): Address | undefined {
  const deployments = jbContractAddress["6"][contract] as Partial<Record<number, Address>>;
  return deployments?.[chainId];
}

// Typed as a plain viem PublicClient: wagmi's per-chain client union makes
// simulateContract's generics explode past TS's union-size limit (TS2590).
export function publicClientFor(chainId: JBChainId): PublicClient {
  return getPublicClient(wagmiConfig, { chainId }) as unknown as PublicClient;
}

/** Require both canonical revnet ownership and the live REVOwner permission set. */
export async function isLiveRevnetOperator(
  client: PublicClient,
  row: ChainProjectRow,
  candidate: Address,
): Promise<boolean> {
  const revOwner = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, row.chainId);
  const [owner, isOperator] = await Promise.all([
    client.readContract({
      address: getJBContractAddress(JBCoreContracts.JBProjects, 6, row.chainId),
      abi: jbProjectsAbi,
      functionName: "ownerOf",
      args: [BigInt(row.projectId)],
    }),
    client.readContract({
      address: revOwner,
      abi: revOwnerAbi,
      functionName: "isOperatorOf",
      args: [BigInt(row.projectId), candidate],
    }),
  ]);
  return owner.toLowerCase() === revOwner.toLowerCase() && isOperator;
}

// ---------------------------------------------------------------------------
// Bendystraw permission holders (no generated document covers this shape).
// ---------------------------------------------------------------------------

export type PermissionHolderRow = Pick<
  PermissionHolder,
  "chainId" | "projectId" | "account" | "operator" | "permissions" | "isRevnetOperator"
> & {
  /**
   * Scoped to JBPermissions.WILDCARD_PROJECT_ID (0) rather than to this project.
   * Wildcard grants act on every project the granting account owns and
   * `hasPermission` honors them, so they confer power here while carrying a
   * different project id — a project-scoped query never returns them.
   */
  wildcard?: boolean;
};

/** Per-project (chainId, projectId) filter for v6 projects. */
export function permissionHoldersWhere(
  rows: readonly ChainProjectRow[],
  extra?: Partial<PermissionHolderFilter>,
): PermissionHolderFilter {
  const exactProjects = projectRefsWhere(rows.map((row) => ({ ...row, version: 6 }))) ?? { OR: [] };
  return extra && Object.keys(extra).length > 0 ? { AND: [exactProjects, extra] } : exactProjects;
}

/** A revnet's project owner: the REVOwner contract, which delegates to the operator. */
export function revnetOwnerAddress(chainId: JBChainId): Address | undefined {
  try {
    return getJBContractAddress(RevnetCoreContracts.REVOwner, 6, chainId);
  } catch {
    return undefined;
  }
}

/**
 * Wildcard (projectId 0) grants made by each chain's REVOwner. An operator
 * holding ROOT this way controls the revnet while appearing in no
 * project-scoped query. Scoped to REVOwner as the grantor: other accounts'
 * wildcards confer nothing here.
 */
export function wildcardPermissionHoldersWhere(
  rows: readonly ChainProjectRow[],
): PermissionHolderFilter | null {
  const clauses = rows.flatMap((row) => {
    const account = revnetOwnerAddress(row.chainId);
    if (!account) return [];
    return [{ AND: [{ chainId: row.chainId }, { projectId: 0 }, { version: 6 }, { account }] }];
  });
  return clauses.length ? { OR: clauses } : null;
}

// ---------------------------------------------------------------------------
// Sequential, simulate-first multi-chain writes from the connected wallet.
// ---------------------------------------------------------------------------

export type ChainWrite = {
  chainId: JBChainId;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** Shown in the review dialog when the write is bundled through Relayr. */
  contractName?: string;
  /**
   * The account the call must come from on this chain (the revnet operator).
   * When the connected wallet co-signs it as a Safe, the write is proposed to
   * that Safe instead of being sent directly.
   */
  authority?: Address;
};

/**
 * Runs each write in order: switch the wallet chain, simulate the exact call
 * (a failed simulation never becomes an unprotected write), send, and wait for
 * the receipt. Throws on the first failure; `onProgress` reports each step.
 */
export async function runSequentialWrites({
  writes,
  account,
  writeContractAsync,
  onProgress,
}: {
  writes: ChainWrite[];
  account: Address;
  writeContractAsync: (variables: any) => Promise<`0x${string}`>;
  onProgress: (message: string) => void;
}): Promise<number> {
  let done = 0;
  for (const write of writes) {
    const name = chainName(write.chainId);
    if (getAccount(wagmiConfig).chainId !== write.chainId) {
      onProgress(`Switch your wallet to ${name}…`);
      await switchChain(wagmiConfig, { chainId: write.chainId });
    }
    const client = publicClientFor(write.chainId);
    onProgress(`Simulating on ${name}…`);
    await client.simulateContract({
      account,
      address: write.address,
      abi: write.abi,
      functionName: write.functionName,
      args: write.args as unknown[],
    });
    onProgress(`Confirm the transaction on ${name} in your wallet…`);
    const hash = await writeContractAsync({
      chainId: write.chainId,
      address: write.address,
      abi: write.abi,
      functionName: write.functionName,
      args: write.args as unknown[],
    });
    onProgress(`Waiting for confirmation on ${name}…`);
    requireOnchainExecution(hash, `${write.functionName} on ${name}`);
    const receipt = await waitForReceiptWithRetry(client, hash);
    if (receipt.status !== "success") {
      throw new Error(`${write.functionName} reverted on ${name} (${hash}).`);
    }
    done += 1;
  }
  return done;
}

// ── Who signs an operator write ───────────────────────────────────────────────

export type OperatorWriteRoute =
  /** The connected account is the authority itself (an EOA operator, or the Safe via its app). */
  | { kind: "direct" }
  /** The authority is a Safe the connected account co-signs: propose to it, don't call it. */
  | { kind: "safe-signer"; safe: Address; owners: Address[]; threshold: number };

/**
 * Decide how the connected account can act for a chain's operator. An
 * unknown authority keeps the historical direct path (the simulation still
 * guards it); a known one must be the account itself or a Safe it co-signs,
 * otherwise the write is refused with the reason instead of a bare revert.
 */
export function operatorWriteRoute({
  account,
  authority,
  identity,
}: {
  account: Address;
  authority: Address | undefined;
  identity: AuthorityIdentity | null | undefined;
}): OperatorWriteRoute {
  if (!authority || account.toLowerCase() === authority.toLowerCase()) return { kind: "direct" };
  if (identity?.kind === "safe") {
    if (identity.owners.some((owner) => owner.toLowerCase() === account.toLowerCase())) {
      return {
        kind: "safe-signer",
        safe: authority,
        owners: identity.owners,
        threshold: identity.threshold,
      };
    }
    throw new Error(
      `The connected wallet ${account} is not a signer of the operator Safe ${authority}. Connect one of its signers.`,
    );
  }
  throw new Error(
    `The connected wallet ${account} is not this revnet's operator (${authority}). Connect the operator${
      identity?.kind === "contract" ? " — it is a contract this app cannot act for" : ""
    }.`,
  );
}
