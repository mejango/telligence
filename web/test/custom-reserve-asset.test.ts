import {
  bridgeableReserveAssets,
  customReserveCoversChains,
  verifyCustomReserveAsset,
} from "@/app/create/helpers/customReserveAsset";
import { JBChainId, MappableAsset } from "@bananapus/nana-sdk-core";
import { describe, expect, it, vi } from "vitest";

const TOKEN = "0x000000000000000000000000000000000000d00d";
const CHAINS = [1, 8453] as JBChainId[];

function tokenClient(symbol = "DAI", decimals = 18) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "symbol" ? symbol : decimals,
    ),
  };
}

describe("custom reserve verification", () => {
  it("reads and matches symbol and decimals on every selected chain", async () => {
    const clients = new Map(CHAINS.map((chainId) => [chainId, tokenClient()]));
    const reserve = await verifyCustomReserveAsset(
      TOKEN,
      CHAINS,
      (chainId) => clients.get(chainId) as never,
    );

    expect(reserve).toEqual({
      address: TOKEN,
      symbol: "DAI",
      decimals: 18,
      verifiedChainIds: CHAINS,
    });
    expect(customReserveCoversChains(reserve, CHAINS)).toBe(true);
  });

  it("rejects inconsistent token metadata across chains", async () => {
    const clients = new Map([
      [CHAINS[0], tokenClient("DAI", 18)],
      [CHAINS[1], tokenClient("DAI", 6)],
    ]);

    await expect(
      verifyCustomReserveAsset(TOKEN, CHAINS, (chainId) => clients.get(chainId) as never),
    ).rejects.toThrow("different symbols or decimals");
  });

  it("does not consider a token verified after the deployment chain set changes", () => {
    expect(
      customReserveCoversChains(
        {
          address: TOKEN,
          symbol: "DAI",
          decimals: 18,
          verifiedChainIds: [CHAINS[0]],
        },
        CHAINS,
      ),
    ).toBe(false);
  });

  it("keeps custom reserves local while preserving canonical bridge mappings", () => {
    expect(bridgeableReserveAssets("CUSTOM")).toEqual([]);
    expect(bridgeableReserveAssets("ETH")).toEqual([MappableAsset.NATIVE]);
    expect(bridgeableReserveAssets("USDC")).toEqual([MappableAsset.USDC]);
    expect(bridgeableReserveAssets("ETH_USDC")).toEqual([MappableAsset.NATIVE, MappableAsset.USDC]);
  });
});
