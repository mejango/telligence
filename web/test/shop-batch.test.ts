import {
  addItemsConditions,
  shopWriteConditions,
  tierConfigsForDestination,
} from "@/app/[slug]/components/v6/shop/shopBatch";
import type { ShopDestination } from "@/app/[slug]/components/v6/shop/useShopDestinations";
import { newDraftItem } from "@/components/shop/itemDraft";
import {
  jb721TiersHookAbi,
  jb721TiersHookStoreAbi,
  jbPermissionsAbi,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { decodeFunctionData, decodeFunctionResult, type Address, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const hook = `0x${"11".repeat(20)}` as Address;
const owner = `0x${"22".repeat(20)}` as Address;
const permissions = `0x${"33".repeat(20)}` as Address;
const operator = `0x${"44".repeat(20)}` as Address;
const flags = {
  noNewTiersWithReserves: false,
  noNewTiersWithVotes: false,
  noNewTiersWithOwnerMinting: false,
  preventOverspending: false,
  issueTokensForSplits: false,
};
const destination = {
  chainId: 8453,
  projectId: 91n,
  shop: {
    hook,
    store: `0x${"55".repeat(20)}`,
    pricing: { currency: 2, decimals: 6, symbol: "USD" },
    configFlags: flags,
    fixedTierTransferability: false,
  },
} as ShopDestination;

function client(values: Record<string, unknown> = {}) {
  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }) =>
      ({
        tiered721HookOf: hook,
        owner,
        PERMISSIONS: permissions,
        hasPermission: true,
        pricingContext: [2n, 6n],
        flagsOf: flags,
        maxTierIdOf: 17n,
        ...values,
      })[functionName],
  );
  return { readContract } as unknown as PublicClient;
}

describe("wallet-action:shop-items — selected-chain shop add requests", () => {
  it("encodes each destination's own decimals, overridden price and inventory", () => {
    const item = { ...newDraftItem(), price: "2.5", supply: "10", perChainSupply: { 8453: "23" } };
    const primary = tierConfigsForDestination([item], {
      ...destination,
      chainId: 1,
      shop: { ...destination.shop, pricing: { currency: 1, decimals: 18, symbol: "ETH" } },
    });
    const peer = tierConfigsForDestination([item], destination, { 0: "7.75" });
    expect(primary[0]).toMatchObject({ price: 2500000000000000000n, initialSupply: 10 });
    expect(peer[0]).toMatchObject({ price: 7750000n, initialSupply: 23 });
  });

  it.each([
    [
      "noNewTiersWithReserves",
      { reserveFrequency: "2", reserveBeneficiary: owner },
      "Reserves are locked",
    ],
    ["noNewTiersWithVotes", { votingUnits: "2" }, "Voting items are locked"],
    ["noNewTiersWithOwnerMinting", { allowOwnerMint: true }, "Owner minting is locked"],
  ] as const)("enforces the peer's %s flag", (flag, patch, message) => {
    expect(() =>
      tierConfigsForDestination([{ ...newDraftItem(), price: "1", ...patch }], {
        ...destination,
        shop: { ...destination.shop, configFlags: { ...flags, [flag]: true } },
      }),
    ).toThrow(message);
  });

  it("refuses unknown configuration or an unguaranteed transfer policy", () => {
    expect(() =>
      tierConfigsForDestination([{ ...newDraftItem(), price: "1" }], {
        ...destination,
        shop: { ...destination.shop, configFlags: null },
      }),
    ).toThrow("configuration is unavailable");
    expect(() =>
      tierConfigsForDestination(
        [{ ...newDraftItem(), price: "1", nonTransferable: true }],
        destination,
      ),
    ).toThrow("non-transferability is unavailable");
  });

  it("uses explicit zero votes on a peer that forbids new voting tiers", () => {
    const tiers = tierConfigsForDestination([{ ...newDraftItem(), price: "1" }], {
      ...destination,
      shop: { ...destination.shop, configFlags: { ...flags, noNewTiersWithVotes: true } },
    });
    expect(tiers[0]).toMatchObject({
      price: 1000000n,
      votingUnits: 0,
      flags: { useVotingUnits: true },
    });
  });

  it("refuses to silently round prices beyond the destination's decimals", () => {
    expect(() =>
      tierConfigsForDestination([{ ...newDraftItem(), price: "1.0000001" }], destination),
    ).toThrow("exceeds 6 decimal places");
    expect(
      tierConfigsForDestination([{ ...newDraftItem(), price: "1.0000000" }], destination)[0].price,
    ).toBe(1000000n);
  });

  it("retains active hook, actual permission contract and owner-bound grant as replayable guards", async () => {
    const rpc = client();
    const guards = await shopWriteConditions(rpc, destination, operator, 24n);
    expect(guards).toHaveLength(4);
    expect(decodeFunctionData({ abi: revOwnerAbi, data: guards[0].data })).toMatchObject({
      functionName: "tiered721HookOf",
      args: [91n],
    });
    expect(
      decodeFunctionResult({
        abi: jb721TiersHookAbi,
        functionName: "owner",
        data: guards[1].expected,
      }),
    ).toBe(owner);
    expect(guards[3].address).toBe(permissions);
    expect(decodeFunctionData({ abi: jbPermissionsAbi, data: guards[3].data })).toMatchObject({
      functionName: "hasPermission",
      args: [operator, owner, 91n, 24n, true, true],
    });
  });

  it("owner exemption skips the delegated grant but still freezes ownership", async () => {
    const guards = await shopWriteConditions(
      client({ hasPermission: false }),
      destination,
      owner,
      24n,
    );
    expect(guards).toHaveLength(3);
  });

  it("rejects changed hooks and denied permissions before building a batch", async () => {
    await expect(
      shopWriteConditions(client({ tiered721HookOf: operator }), destination, operator, 24n),
    ).rejects.toThrow("live shop changed");
    await expect(
      shopWriteConditions(client({ hasPermission: false }), destination, operator, 24n),
    ).rejects.toThrow("cannot manage");
  });

  it("guards pricing, configuration and allocated tier IDs across recovery", async () => {
    const guards = await addItemsConditions(client(), destination, owner);
    expect(guards).toHaveLength(6);
    expect(decodeFunctionData({ abi: jb721TiersHookAbi, data: guards[3].data }).functionName).toBe(
      "pricingContext",
    );
    expect(
      decodeFunctionData({ abi: jb721TiersHookStoreAbi, data: guards[4].data }).functionName,
    ).toBe("flagsOf");
    expect(
      decodeFunctionResult({
        abi: jb721TiersHookStoreAbi,
        functionName: "maxTierIdOf",
        data: guards[5].expected,
      }),
    ).toBe(17n);
    await expect(
      addItemsConditions(client({ pricingContext: [2n, 18n] }), destination, owner),
    ).rejects.toThrow("pricing changed");
  });
});
