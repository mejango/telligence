import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import { describe, expect, it } from "vitest";

describe("Relayr network families", () => {
  it.each([1, 10, 8453, 42161, 11155111, 11155420, 84532, 421614])(
    "supports the advertised chain %s",
    (chainId) => expect(isRelayrSupportedChain(chainId)).toBe(true),
  );

  it.each([0, 56, 31337])("does not support an unverified chain %s", (chainId) => {
    expect(isRelayrSupportedChain(chainId)).toBe(false);
    expect(areRelayrChainsCompatible([chainId])).toBe(false);
  });

  it("requires a nonempty selection entirely within one supported family", () => {
    expect(areRelayrChainsCompatible([1, 10, 8453, 42161])).toBe(true);
    expect(areRelayrChainsCompatible([11155111, 11155420, 84532, 421614])).toBe(true);
    expect(areRelayrChainsCompatible([])).toBe(false);
    expect(areRelayrChainsCompatible([1, 11155111])).toBe(false);
    expect(areRelayrChainsCompatible([11155111, 10])).toBe(false);
    expect(areRelayrChainsCompatible([1, 56])).toBe(false);
  });
});
