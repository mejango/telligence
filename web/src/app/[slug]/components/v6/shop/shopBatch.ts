import { buildTierConfigs, type DraftItem } from "@/components/shop/itemDraft";
import {
  getJBContractAddress,
  jb721TiersHookAbi,
  jb721TiersHookStoreAbi,
  jbPermissionsAbi,
  RevnetCoreContracts,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import {
  encodeFunctionData,
  encodeFunctionResult,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ShopDestination } from "./useShopDestinations";

export type ShopReadCondition = { address: Address; data: Hex; expected: Hex };

export async function captureShopRead<T>(
  client: PublicClient,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  const value = (await client.readContract({ address, abi, functionName, args })) as T;
  return {
    value,
    condition: {
      address,
      data: encodeFunctionData({ abi, functionName, args }),
      expected: encodeFunctionResult({ abi, functionName, result: value }),
    },
  };
}

/** Persist exact reads as well as calldata so recovery cannot silently accept a changed shop. */
export async function shopWriteConditions(
  client: PublicClient,
  destination: ShopDestination,
  account: Address,
  permissionId: bigint,
): Promise<ShopReadCondition[]> {
  const { chainId, projectId, shop } = destination;
  const [active, owner, permissions] = await Promise.all([
    captureShopRead<Address>(
      client,
      getJBContractAddress(RevnetCoreContracts.REVOwner, 6, chainId),
      revOwnerAbi,
      "tiered721HookOf",
      [projectId],
    ),
    captureShopRead<Address>(client, shop.hook, jb721TiersHookAbi, "owner"),
    captureShopRead<Address>(client, shop.hook, jb721TiersHookAbi, "PERMISSIONS"),
  ]);
  if (active.value.toLowerCase() !== shop.hook.toLowerCase())
    throw new Error("The live shop changed. Reopen the editor.");
  const conditions = [active.condition, owner.condition, permissions.condition];
  if (owner.value.toLowerCase() !== account.toLowerCase()) {
    const permission = await captureShopRead<boolean>(
      client,
      permissions.value,
      jbPermissionsAbi,
      "hasPermission",
      [account, owner.value, projectId, permissionId, true, true],
    );
    if (!permission.value)
      throw new Error(`This wallet cannot manage the shop on chain ${chainId}.`);
    conditions.push(permission.condition);
  }
  return conditions;
}

export function tierConfigsForDestination(
  items: DraftItem[],
  destination: ShopDestination,
  prices: Record<number, string> = {},
) {
  const { shop, chainId } = destination;
  if (!shop.configFlags) throw new Error(`Shop configuration is unavailable on chain ${chainId}.`);
  const drafts = items.map((item, index) => {
    const price = prices[index] ?? item.price;
    if ((price.trim().split(".")[1]?.replace(/0+$/u, "").length ?? 0) > shop.pricing.decimals)
      throw new Error(
        `Chain ${chainId}: item ${index + 1}'s price exceeds ${shop.pricing.decimals} decimal places.`,
      );
    return { ...item, price };
  });
  const configs = buildTierConfigs(drafts, shop.pricing.decimals, chainId);
  if (typeof configs === "string") throw new Error(`Chain ${chainId}: ${configs}`);
  configs.forEach((tier) => {
    if (shop.configFlags?.noNewTiersWithReserves && tier.reserveFrequency > 0)
      throw new Error(`Reserves are locked on chain ${chainId}.`);
    if (shop.configFlags?.noNewTiersWithVotes && tier.votingUnits > 0)
      throw new Error(`Voting items are locked on chain ${chainId}.`);
    // The hook interprets useVotingUnits=false as price-based votes. A collection
    // which forbids new votes needs an explicit zero, including on priced tiers.
    if (shop.configFlags?.noNewTiersWithVotes) tier.flags.useVotingUnits = true;
    if (shop.configFlags?.noNewTiersWithOwnerMinting && tier.flags.allowOwnerMint)
      throw new Error(`Owner minting is locked on chain ${chainId}.`);
    if (tier.flags.transfersPausable && shop.fixedTierTransferability !== true)
      throw new Error(`Permanent non-transferability is unavailable on chain ${chainId}.`);
  });
  return configs;
}

export async function addItemsConditions(
  client: PublicClient,
  destination: ShopDestination,
  account: Address,
) {
  const conditions = await shopWriteConditions(client, destination, account, 24n);
  const [pricing, flags, lastTier] = await Promise.all([
    captureShopRead<readonly [bigint, bigint]>(
      client,
      destination.shop.hook,
      jb721TiersHookAbi,
      "pricingContext",
    ),
    captureShopRead(client, destination.shop.store, jb721TiersHookStoreAbi, "flagsOf", [
      destination.shop.hook,
    ]),
    captureShopRead(client, destination.shop.store, jb721TiersHookStoreAbi, "maxTierIdOf", [
      destination.shop.hook,
    ]),
  ]);
  if (
    Number(pricing.value[0]) !== destination.shop.pricing.currency ||
    Number(pricing.value[1]) !== destination.shop.pricing.decimals
  )
    throw new Error("Shop pricing changed. Reopen the editor.");
  return [...conditions, pricing.condition, flags.condition, lastTier.condition];
}
