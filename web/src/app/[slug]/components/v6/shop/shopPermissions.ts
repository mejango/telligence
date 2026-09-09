import {
  jb721TiersHookAbi,
  jb721TiersHookStoreAbi,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { getProject721Shop, hasPermissions, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import type { Address, PublicClient } from "viem";

/**
 * Mirrors JB721TiersHook's live adjustTiers authorization. This deliberately
 * reads the hook instead of relying on indexed project roles, which can lag and
 * do not include hook-level delegates.
 */
export async function canAdjust721Tiers(
  client: PublicClient,
  {
    chainId,
    projectId,
    hook,
    operator,
  }: {
    chainId: JBChainId;
    projectId: bigint;
    hook: Address;
    operator: Address;
  },
): Promise<boolean> {
  const owner = await client.readContract({
    address: hook,
    abi: jb721TiersHookAbi,
    functionName: "owner",
    args: [],
  });

  if (owner.toLowerCase() === operator.toLowerCase()) return true;

  return hasPermissions(client, {
    chainId,
    operator,
    account: owner,
    projectId,
    permissionIds: [JBPermissionIdsV6.ADJUST_721_TIERS],
  });
}

/** Metadata delegates are separate from tier/inventory managers. */
export async function canSet721Metadata(
  client: PublicClient,
  {
    chainId,
    projectId,
    hook,
    operator,
  }: {
    chainId: JBChainId;
    projectId: bigint;
    hook: Address;
    operator: Address;
  },
): Promise<boolean> {
  const owner = await client.readContract({
    address: hook,
    abi: jb721TiersHookAbi,
    functionName: "owner",
  });
  if (owner.toLowerCase() === operator.toLowerCase()) return true;
  return hasPermissions(client, {
    chainId,
    operator,
    account: owner,
    projectId,
    permissionIds: [JBPermissionIdsV6.SET_721_METADATA],
  });
}

/** Mirrors `mintFor` authorization for owner/operator free mints. */
export async function canMint721Tiers(
  client: PublicClient,
  {
    chainId,
    projectId,
    hook,
    operator,
  }: {
    chainId: JBChainId;
    projectId: bigint;
    hook: Address;
    operator: Address;
  },
): Promise<boolean> {
  const owner = await client.readContract({
    address: hook,
    abi: jb721TiersHookAbi,
    functionName: "owner",
    args: [],
  });

  if (owner.toLowerCase() === operator.toLowerCase()) return true;

  return hasPermissions(client, {
    chainId,
    operator,
    account: owner,
    projectId,
    permissionIds: [JBPermissionIdsV6.MINT_721],
  });
}

/**
 * Re-resolve the revnet's live hook, then pin authorization, the immutable
 * allowOwnerMint flag, and remaining inventory immediately before simulation.
 */
export async function assertCanMint721Tier(
  client: PublicClient,
  {
    chainId,
    projectId,
    hook,
    operator,
    tierId,
    quantity,
  }: {
    chainId: JBChainId;
    projectId: bigint;
    hook: Address;
    operator: Address;
    tierId: number;
    quantity: number;
  },
): Promise<void> {
  const liveShop = await getProject721Shop(client, {
    chainId,
    projectId,
    isRevnet: true,
    tierLimit: 0,
  });
  if (!liveShop || liveShop.hook.toLowerCase() !== hook.toLowerCase()) {
    throw new Error("The revnet’s live shop hook changed. Review the mint again.");
  }
  if (!(await canMint721Tiers(client, { chainId, projectId, hook, operator }))) {
    throw new Error("This wallet does not have MINT_721 permission for this shop.");
  }
  const store = await client.readContract({
    address: hook,
    abi: jb721TiersHookAbi,
    functionName: "STORE",
  });
  const tier = await client.readContract({
    address: store,
    abi: jb721TiersHookStoreAbi,
    functionName: "tierOf",
    args: [hook, BigInt(tierId), false],
  });
  if (Number(tier.id) !== tierId || !tier.flags.allowOwnerMint) {
    throw new Error("This item does not allow revnet-operator free mints.");
  }
  if (Number(tier.remainingSupply) < quantity) {
    throw new Error(`Only ${tier.remainingSupply.toString()} remain on this chain.`);
  }
}
