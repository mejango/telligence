import { JBChainId, MappableAsset } from "@bananapus/nana-sdk-core";
import { Address, erc20Abi, isAddress, PublicClient } from "viem";
import type { CustomReserveAsset, RevnetFormData } from "../types";

type TokenClient = Pick<PublicClient, "readContract">;

function cleanTokenSymbol(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\0/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

export async function verifyCustomReserveAsset(
  rawAddress: string,
  chainIds: readonly JBChainId[],
  clientForChain: (chainId: JBChainId) => TokenClient | undefined,
): Promise<CustomReserveAsset> {
  const address = rawAddress.trim();
  if (!isAddress(address, { strict: false })) {
    throw new Error("Enter a valid ERC-20 token address.");
  }
  if (chainIds.length === 0) {
    throw new Error("Choose at least one chain before verifying the custom reserve.");
  }

  const normalizedAddress = address.toLowerCase() as Address;
  const results = await Promise.all(
    chainIds.map(async (chainId) => {
      const client = clientForChain(chainId);
      if (!client) throw new Error(`No RPC client is available for chain ${chainId}.`);
      try {
        const [decimals, rawSymbol] = await Promise.all([
          client.readContract({
            address: normalizedAddress,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({
            address: normalizedAddress,
            abi: erc20Abi,
            functionName: "symbol",
          }),
        ]);
        const symbol = cleanTokenSymbol(rawSymbol);
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
          throw new Error("invalid decimals");
        }
        if (!symbol) throw new Error("missing symbol");
        return { chainId, decimals, symbol };
      } catch {
        throw new Error(`No standard ERC-20 token was found at ${address} on chain ${chainId}.`);
      }
    }),
  );

  const reference = results[0];
  const mismatch = results.find(
    (token) => token.decimals !== reference.decimals || token.symbol !== reference.symbol,
  );
  if (mismatch) {
    throw new Error(
      "The token at this address has different symbols or decimals across the selected chains.",
    );
  }

  return {
    address: normalizedAddress,
    symbol: reference.symbol,
    decimals: reference.decimals,
    verifiedChainIds: results.map(({ chainId }) => chainId),
  };
}

export function customReserveCoversChains(
  reserve: CustomReserveAsset,
  chainIds: readonly JBChainId[],
): boolean {
  if (
    !isAddress(reserve.address, { strict: false }) ||
    !reserve.symbol.trim() ||
    !Number.isInteger(reserve.decimals) ||
    (reserve.decimals ?? -1) < 0 ||
    (reserve.decimals ?? 37) > 36
  ) {
    return false;
  }
  const verified = new Set(reserve.verifiedChainIds.map(Number));
  return chainIds.length > 0 && chainIds.every((chainId) => verified.has(Number(chainId)));
}

export function bridgeableReserveAssets(
  reserveAsset: RevnetFormData["reserveAsset"],
): MappableAsset[] {
  if (reserveAsset === "CUSTOM") return [];
  if (reserveAsset === "ETH_USDC") return [MappableAsset.NATIVE, MappableAsset.USDC];
  return [reserveAsset === "USDC" ? MappableAsset.USDC : MappableAsset.NATIVE];
}
