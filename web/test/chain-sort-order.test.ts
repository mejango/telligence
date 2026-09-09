import {
  chainSortIndex,
  isSupportedChainId,
  isTestnetChain,
  MAINNET_CHAIN_IDS,
  SUPPORTED_CHAIN_IDS,
  TESTNET_CHAIN_IDS,
} from "@/app/constants";
import { sortChains } from "@/lib/utils";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { describe, expect, it } from "vitest";

/**
 * The sort map used to hold only the four Sepolias, so every production comparison was
 * 0 − 0 and chain lists came out in whatever order the data source happened to emit.
 */
describe("chain display order", () => {
  it("orders every supported chain, production first", () => {
    const all = [42161, 11155111, 8453, 10, 421614, 1, 84532, 11155420] as JBChainId[];
    expect(sortChains(all)).toEqual([1, 10, 8453, 42161, 11155111, 11155420, 84532, 421614]);
  });

  it("gives each production chain a distinct index", () => {
    const production = [1, 10, 8453, 42161].map(chainSortIndex);
    expect(new Set(production).size).toBe(4);
  });

  it("sorts an unlisted chain after every known one, deterministically by chain id", () => {
    expect(chainSortIndex(1337)).toBeGreaterThan(chainSortIndex(421614));
    expect(chainSortIndex(1337)).toBeLessThan(chainSortIndex(1338));
  });
});

/**
 * Chain MEMBERSHIP is derived from the SDK, never from a literal: a chain added to
 * `JB_CHAINS` must appear in every picker and filter without a code change here, and the
 * testnet split routes Bendystraw, so a miss is a wrong-network read, not an empty one.
 */
describe("chain membership", () => {
  it("covers exactly the SDK's chains", () => {
    const fromSdk = Object.values(JB_CHAINS).map((metadata) => metadata.chain.id);
    expect([...SUPPORTED_CHAIN_IDS].sort((a, b) => a - b)).toEqual(
      [...fromSdk].sort((a, b) => a - b),
    );
    for (const chainId of fromSdk) expect(isSupportedChainId(chainId)).toBe(true);
    expect(isSupportedChainId(1337)).toBe(false);
  });

  it("splits production from testnet off the chain definitions, in display order", () => {
    expect(MAINNET_CHAIN_IDS).toEqual([1, 10, 8453, 42161]);
    expect(TESTNET_CHAIN_IDS).toEqual([11155111, 11155420, 84532, 421614]);
    expect([...MAINNET_CHAIN_IDS, ...TESTNET_CHAIN_IDS].sort((a, b) => a - b)).toEqual(
      [...SUPPORTED_CHAIN_IDS].sort((a, b) => a - b),
    );
    expect(isTestnetChain(11155111)).toBe(true);
    expect(isTestnetChain(1)).toBe(false);
    expect(isTestnetChain(1337)).toBe(false);
  });
});
