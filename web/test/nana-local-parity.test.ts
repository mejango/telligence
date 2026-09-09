import { resolveV6DataHookAddress, selectPrimaryNativeTerminal } from "@/lib/nana/state";
import { normalizeSuckerPairs } from "@/lib/nana/suckers";
import type { SuckerPair } from "@/lib/nana/types";
import { zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;

describe("local Nana V6 parity", () => {
  it("prefers native and only falls back to USDC after native resolves as unset", () => {
    const native = address("1");
    const usdc = address("2");

    expect(selectPrimaryNativeTerminal(native, usdc)).toBe(native);
    expect(selectPrimaryNativeTerminal(zeroAddress, usdc)).toBe(usdc);
    expect(selectPrimaryNativeTerminal(undefined, usdc)).toBeUndefined();
    expect(selectPrimaryNativeTerminal(null, usdc)).toBeUndefined();
  });

  it("resolves an omnichain deployer to the tiered hook before the extra hook", () => {
    const deployer = address("1");
    const tiered = address("2");
    const extra = address("3");

    expect(
      resolveV6DataHookAddress({
        dataHook: deployer,
        omnichainDeployer: deployer,
        tiered721Hook: tiered,
        extraDataHook: extra,
      }),
    ).toBe(tiered);
    expect(
      resolveV6DataHookAddress({
        dataHook: deployer,
        omnichainDeployer: deployer,
        tiered721Hook: zeroAddress,
        extraDataHook: extra,
      }),
    ).toBe(extra);
  });

  it("keeps direct hooks unchanged and represents the active project once", () => {
    const direct = address("9");
    expect(
      resolveV6DataHookAddress({
        dataHook: direct,
        omnichainDeployer: address("1"),
        tiered721Hook: address("2"),
        extraDataHook: address("3"),
      }),
    ).toBe(direct);

    // A group member's identity is the whole (chain, project) pair, matching
    // `resolveSuckers`. Re-listing the active pair collapses; a DIFFERENT
    // project on the active chain is a distinct member and must survive.
    const current = { peerChainId: 10, projectId: 7n } satisfies SuckerPair;
    const pairs = normalizeSuckerPairs(
      [
        { peerChainId: 8453, projectId: 9n },
        { peerChainId: 10, projectId: 7n },
        { peerChainId: 10, projectId: 999n },
        { peerChainId: 1, projectId: 5n },
      ],
      current,
    );
    expect(pairs).toEqual([
      { peerChainId: 1, projectId: 5n },
      { peerChainId: 8453, projectId: 9n },
      current,
      { peerChainId: 10, projectId: 999n },
    ]);
  });
});
