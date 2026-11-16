import { groupMixesTokens, tokenKindOf } from "@/lib/tokenUtils";
import { USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { expect, it } from "vitest";

it("qualifies custom-token identity by chain, even for equal addresses and metadata", () => {
  const row = {
    token: "0x1111111111111111111111111111111111111111",
    tokenSymbol: "XYZ",
    decimals: 18,
  };
  expect(tokenKindOf({ ...row, chainId: 1 })).not.toBe(tokenKindOf({ ...row, chainId: 8453 }));
  expect(
    groupMixesTokens([
      { ...row, chainId: 1 },
      { ...row, chainId: 8453 },
    ]),
  ).toBe(true);
  expect(
    groupMixesTokens([
      { ...row, chainId: 1 },
      { ...row, chainId: 1 },
    ]),
  ).toBe(false);
});
it("combines authenticated USDC across chains but not its address copied onto another chain", () => {
  const row = { tokenSymbol: "USDC", decimals: 6 };
  const eth = { ...row, chainId: 1, token: USDC_ADDRESSES[1] };
  const base = { ...row, chainId: 8453, token: USDC_ADDRESSES[8453] };
  expect(tokenKindOf(eth)).toBe(tokenKindOf(base));
  expect(tokenKindOf(eth)).not.toBe(tokenKindOf({ ...eth, chainId: 8453 }));
});
it("does not authenticate USDC without its chain", () => {
  const row = { token: USDC_ADDRESSES[1], tokenSymbol: "USDC", decimals: 6 };
  expect(tokenKindOf(row)).not.toBe(tokenKindOf({ ...row, chainId: 1 }));
});
