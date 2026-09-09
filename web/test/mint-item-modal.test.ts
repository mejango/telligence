import { buildOwnerMintTierIds } from "@/app/[slug]/components/v6/shop/MintItemModal";
import { jb721TiersHookAbi } from "@bananapus/nana-sdk-core";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

const beneficiary = "0x1111111111111111111111111111111111111111";

describe("revnet shop owner mint", () => {
  // wallet-action:shop-items
  it("encodes quantity as repeated uint16 tier ids for mintFor", () => {
    const tierIds = buildOwnerMintTierIds(7, 3);
    const data = encodeFunctionData({
      abi: jb721TiersHookAbi,
      functionName: "mintFor",
      args: [tierIds, beneficiary],
    });

    expect(tierIds).toEqual([7, 7, 7]);
    expect(decodeFunctionData({ abi: jb721TiersHookAbi, data })).toEqual({
      functionName: "mintFor",
      args: [[7, 7, 7], beneficiary],
    });
  });

  it("bounds tier IDs and transaction size before simulation", () => {
    expect(() => buildOwnerMintTierIds(0, 1)).toThrow(/tier ID/);
    expect(() => buildOwnerMintTierIds(65_536, 1)).toThrow(/tier ID/);
    expect(() => buildOwnerMintTierIds(7, 0)).toThrow(/between 1 and 50/);
    expect(() => buildOwnerMintTierIds(7, 51)).toThrow(/between 1 and 50/);
  });
});
