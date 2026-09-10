import { buildComputeLaunch, decodeComputeDeployment } from "@/lib/telligence/launch";
import { VVV_ADDRESS } from "@/lib/telligence/transactions";
import { DEFAULT_COMPUTE_DRAFT } from "@/lib/telligence/types";
import { describe, expect, it } from "vitest";

const address = "0x1111111111111111111111111111111111111111" as const;
const factory = "0x2222222222222222222222222222222222222222" as const;
const recovery = "0x3333333333333333333333333333333333333333" as const;
const config = {
  ready: true,
  policyVersion: "2" as const,
  chainId: 8453,
  factoryAddress: factory,
  canonicalTerminal: address,
  vvvAddress: VVV_ADDRESS,
  launchPolicy: {
    conversionCadence: "3600",
    minBatchTokens: "1000000000000000000",
    maxBatchTokens: "1000000000000000000000",
    minVVVPerProjectToken: "100000000000000000",
    minDiemPerVVV: "100000000000000",
    maxPrincipal: "10000000000000000000000",
    initialIssuance: "1000000000000000000",
  },
};
const args = {
  config,
  draft: {
    ...DEFAULT_COMPUTE_DRAFT,
    name: "A public archive",
    purpose: "Make historical records searchable.",
    workload: "Embeddings and summaries.",
    recoveryAddress: recovery,
  },
  metadataUri: "ipfs://bafyexample",
  salt: `0x${"ab".repeat(32)}` as `0x${string}`,
  creator: address,
  inferenceSigner: factory,
  timestamp: 2000000000,
  creationFee: 123n,
};

describe("compute project launch", () => {
  it("builds one Base stage with reviewed production economics and explicit fixed limits", () => {
    const tx = buildComputeLaunch(args);
    expect(tx.address).toBe(factory);
    expect(tx.chainId).toBe(8453);
    expect(tx.value).toBe(123n);
    expect(tx.args[1]).toEqual([
      {
        startsAtOrAfter: 2000000600,
        splitPercent: 4000,
        initialIssuance: 10n ** 18n,
        issuanceCutFrequency: 0,
        issuanceCutPercent: 0,
        cashOutTaxRate: 1000,
        operatorSplitPercent: 0,
      },
    ]);
    expect(tx.args[3]).toBe(recovery);
    expect(tx.args[4]).toBe(factory);
  });
  it("encodes the operator share separately from the compute allocation", () => {
    const tx = buildComputeLaunch({ ...args, draft: { ...args.draft, operatorSplitBps: 2500 } });
    expect(tx.args[1][0]).toMatchObject({ splitPercent: 4000, operatorSplitPercent: 2500 });
    expect(tx.args[3]).toBe(recovery);
    expect(tx.args[4]).toBe(factory);
  });
  it("requires a recovery wallet that is separate from the creator", () => {
    const separate = /separate recovery wallet/i;
    expect(() =>
      buildComputeLaunch({ ...args, draft: { ...args.draft, recoveryAddress: undefined } }),
    ).toThrow(separate);
    expect(() =>
      buildComputeLaunch({ ...args, draft: { ...args.draft, recoveryAddress: address } }),
    ).toThrow(separate);
    expect(() =>
      buildComputeLaunch({
        ...args,
        draft: { ...args.draft, recoveryAddress: address.toUpperCase() as `0x${string}` },
      }),
    ).toThrow(separate);
    expect(() =>
      buildComputeLaunch({
        ...args,
        draft: { ...args.draft, recoveryAddress: `0x${"0".repeat(40)}` },
      }),
    ).toThrow(/recovery|authority/i);
  });
  it.each([undefined, null, "2500", false, NaN, Infinity, -1, 1.5, 6000, 10000])(
    "rejects invalid operator allocation before constructing a wallet request: %j",
    (operatorSplitBps) => {
      expect(() =>
        buildComputeLaunch({
          ...args,
          draft: { ...args.draft, operatorSplitBps: operatorSplitBps as number },
        }),
      ).toThrow(/operator/i);
    },
  );
  it("rejects hidden or invalid economics before constructing a launch", () => {
    expect(() =>
      buildComputeLaunch({ ...args, config: { ...config, launchPolicy: undefined } }),
    ).toThrow(/policy/);
    expect(() =>
      buildComputeLaunch({ ...args, draft: { ...args.draft, productionSplitBps: 10000 } }),
    ).toThrow(/production/);
    expect(() =>
      buildComputeLaunch({
        ...args,
        config: { ...config, launchPolicy: { ...config.launchPolicy, minDiemPerVVV: "0" } },
      }),
    ).toThrow(/positive/);
    expect(() =>
      buildComputeLaunch({ ...args, metadataUri: "https://untrusted.example/story" }),
    ).toThrow(/metadata/);
  });
  it.each([0, 2500])(
    "refuses the legacy factory ABI even for operator share %i",
    (operatorSplitBps) => {
      expect(() =>
        buildComputeLaunch({
          ...args,
          config: { ...args.config, policyVersion: "1" },
          draft: { ...args.draft, operatorSplitBps },
        }),
      ).toThrow(/version/i);
    },
  );
  it("never treats a missing or reverted event as a successful deployment", () => {
    expect(() =>
      decodeComputeDeployment({ status: "reverted", logs: [] }, factory, address),
    ).toThrow(/reverted/);
    expect(() =>
      decodeComputeDeployment({ status: "success", logs: [] }, factory, address),
    ).toThrow(/deployment event/);
  });
});
