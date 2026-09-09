import {
  assetsFromAccountingContexts,
  buildSuckerExtensionWrites,
  extensionCandidateChains,
} from "@/app/[slug]/components/v6/operator/suckerExtensionLib";
import { MappableAsset, NATIVE_TOKEN, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

const SALT = `0x${"ab".repeat(32)}` as const;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

describe("extensionCandidateChains", () => {
  it("offers only same-environment chains the group is not already on", () => {
    expect(
      extensionCandidateChains([
        { chainId: 1, projectId: 5 },
        { chainId: 10, projectId: 7 },
      ]),
    ).toEqual([8453, 42161]);
  });

  it("keeps testnet groups in the testnet environment", () => {
    const candidates = extensionCandidateChains([{ chainId: 11155111, projectId: 3 }]);
    expect(candidates).not.toContain(1);
    expect(candidates).toContain(11155420);
    expect(candidates).toContain(84532);
    expect(candidates).toContain(421614);
    expect(candidates).not.toContain(11155111);
  });
});

describe("assetsFromAccountingContexts", () => {
  it("maps the native sentinel and the chain's canonical USDC", () => {
    expect(assetsFromAccountingContexts([{ token: NATIVE_TOKEN }], 1)).toEqual([
      MappableAsset.NATIVE,
    ]);
    expect(assetsFromAccountingContexts([{ token: USDC_ETH }], 1)).toEqual([MappableAsset.USDC]);
    expect(assetsFromAccountingContexts([{ token: NATIVE_TOKEN }, { token: USDC_ETH }], 1)).toEqual(
      [MappableAsset.NATIVE, MappableAsset.USDC],
    );
  });

  it("excludes custom reserve tokens (no canonical bridge mapping)", () => {
    // USDC on the wrong chain is NOT that chain's canonical USDC.
    expect(assetsFromAccountingContexts([{ token: USDC_BASE }], 1)).toEqual([]);
    expect(
      assetsFromAccountingContexts([{ token: "0x1111111111111111111111111111111111111111" }], 1),
    ).toEqual([]);
  });
});

describe("buildSuckerExtensionWrites", () => {
  const groupRows = [
    { chainId: 1 as const, projectId: 5 },
    { chainId: 10 as const, projectId: 7 },
  ];

  it("builds one write per chain: the target links every peer, each peer links the target", () => {
    const writes = buildSuckerExtensionWrites({
      groupRows,
      targetChainId: 8453,
      targetProjectId: 12,
      assets: [MappableAsset.NATIVE],
      salt: SALT,
    });

    expect(writes).toHaveLength(3);
    const target = writes.find((w) => w.chainId === 8453)!;
    const eth = writes.find((w) => w.chainId === 1)!;
    const op = writes.find((w) => w.chainId === 10)!;

    // Each chain calls deploySuckersFor with ITS OWN project id.
    expect(target.args[0]).toBe(12n);
    expect(eth.args[0]).toBe(5n);
    expect(op.args[0]).toBe(7n);

    // The target chain deploys one sucker per existing peer; each existing
    // chain deploys exactly one sucker toward the target.
    const targetConfig = target.args[1] as { deployerConfigurations: unknown[]; salt: string };
    const ethConfig = eth.args[1] as { deployerConfigurations: unknown[]; salt: string };
    const opConfig = op.args[1] as { deployerConfigurations: unknown[]; salt: string };
    expect(targetConfig.deployerConfigurations.length).toBe(2);
    expect(ethConfig.deployerConfigurations.length).toBe(1);
    expect(opConfig.deployerConfigurations.length).toBe(1);

    // The SAME user salt everywhere: REVDeployer folds it with the config
    // hash and the caller, so identical salts (from the same operator) are
    // what make the two ends of each edge land at the same address and pair.
    for (const write of writes) {
      expect((write.args[1] as { salt: string }).salt).toBe(SALT);
      expect(write.functionName).toBe("deploySuckersFor");
      // The args must encode against the real ABI.
      expect(() =>
        encodeFunctionData({
          abi: revDeployerAbi,
          functionName: "deploySuckersFor",
          args: write.args as never,
        }),
      ).not.toThrow();
    }
  });

  it("refuses a target chain already in the group", () => {
    expect(() =>
      buildSuckerExtensionWrites({
        groupRows,
        targetChainId: 10,
        targetProjectId: 7,
        assets: [MappableAsset.NATIVE],
        salt: SALT,
      }),
    ).toThrow(/already/iu);
  });
});
