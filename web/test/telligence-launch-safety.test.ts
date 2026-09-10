import { computeFactoryAbi } from "@/lib/telligence/factory";
import { TelligenceFactoryAbi } from "@/lib/telligence/generated/TelligenceFactory";
import { buildComputeLaunch, decodeComputeDeployment } from "@/lib/telligence/launch";
import { validateComputeDraft } from "@/lib/telligence/presentation";
import { buildComputePayment, VVV_ADDRESS } from "@/lib/telligence/transactions";
import { DEFAULT_COMPUTE_DRAFT } from "@/lib/telligence/types";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiParameters,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

const creator = "0x1111111111111111111111111111111111111111" as const;
const factory = "0x2222222222222222222222222222222222222222" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const draft = {
  ...DEFAULT_COMPUTE_DRAFT,
  name: "A public archive",
  purpose: "Make historical records searchable.",
  workload: "Embeddings and summaries.",
  recoveryAddress: "0x4444444444444444444444444444444444444444" as const,
};
const launchPolicy = {
  conversionCadence: "3600",
  minBatchTokens: "1000000000000000000",
  maxBatchTokens: "1000000000000000000000",
  minVVVPerProjectToken: "100000000000000000",
  minDiemPerVVV: "100000000000000",
  maxPrincipal: "10000000000000000000000",
  initialIssuance: "1000000000000000000",
};
const config = {
  ready: true,
  policyVersion: "2" as const,
  chainId: 8453,
  factoryAddress: factory,
  canonicalTerminal: creator,
  vvvAddress: VVV_ADDRESS,
  launchPolicy,
};
const launch = {
  config,
  draft,
  metadataUri: "ipfs://bafyexample",
  salt: `0x${"ab".repeat(32)}` as Hex,
  creator,
  inferenceSigner: factory,
  timestamp: 2_000_000_000,
  creationFee: 123n,
};
const payment = {
  projectId: 42n,
  terminal: factory,
  beneficiary: creator,
  amount: 10n ** 18n,
  quotedTokens: 2n * 10n ** 18n,
  slippageBps: 100,
};

describe("compute factory ABI compatibility", () => {
  it("matches every exposed factory function selector against the generated Foundry ABI", () => {
    for (const item of computeFactoryAbi) {
      if (item.type !== "function") continue;
      const canonical = TelligenceFactoryAbi.find(
        (entry) => entry.type === "function" && entry.name === item.name,
      );
      if (!canonical || canonical.type !== "function")
        throw new Error(`Missing factory function ${item.name}`);
      expect(toFunctionSelector(item)).toBe(toFunctionSelector(canonical));
    }
    const tx = buildComputeLaunch(launch);
    expect(encodeFunctionData(tx)).toBe(
      encodeFunctionData({ abi: TelligenceFactoryAbi, functionName: "deployFor", args: tx.args }),
    );
  });

  it("preserves a nonzero operator share through canonical contract calldata", () => {
    const tx = buildComputeLaunch({ ...launch, draft: { ...draft, operatorSplitBps: 2500 } });
    const data = encodeFunctionData(tx);
    expect(data).toBe(
      encodeFunctionData({ abi: TelligenceFactoryAbi, functionName: "deployFor", args: tx.args }),
    );
    const decoded = decodeFunctionData({ abi: TelligenceFactoryAbi, data });
    expect(decoded.functionName).toBe("deployFor");
    if (decoded.functionName !== "deployFor") throw new Error("Expected a factory launch.");
    expect(decoded.args[1][0]).toMatchObject({ splitPercent: 4000, operatorSplitPercent: 2500 });
  });

  it("decodes the generated deployment event only once for its actual factory and creator", () => {
    const vault = "0x3333333333333333333333333333333333333333" as const;
    const [signatureTopic, ...indexedTopics] = encodeEventTopics({
      abi: TelligenceFactoryAbi,
      eventName: "DeployProject",
      args: { revnetId: 42n, creator },
    });
    const topics: [Hex, ...Hex[]] = [
      signatureTopic,
      ...indexedTopics.map((topic) => {
        if (typeof topic !== "string")
          throw new Error("A mined deployment log must have exact topics.");
        return topic;
      }),
    ];
    const data = encodeAbiParameters(
      parseAbiParameters("address policy, address vault, bytes32 policyHash"),
      [factory, vault, `0x${"cd".repeat(32)}`],
    );
    const log = { address: factory, topics, data };
    expect(decodeComputeDeployment({ status: "success", logs: [log] }, factory, creator)).toEqual({
      revnetId: "42",
      wrapperAddress: factory,
      vaultAddress: vault,
    });
    expect(() =>
      decodeComputeDeployment(
        { status: "success", logs: [{ ...log, address: creator }] },
        factory,
        creator,
      ),
    ).toThrow(/unique/);
    expect(() =>
      decodeComputeDeployment({ status: "success", logs: [log] }, factory, vault),
    ).toThrow(/unique/);
    expect(() =>
      decodeComputeDeployment({ status: "success", logs: [log, log] }, factory, creator),
    ).toThrow(/unique/);
  });
});

describe("compute launch contract boundaries", () => {
  it.each(["1", "3599", "2592001", ((1n << 48n) - 1n).toString()])(
    "rejects cadence %s outside the policy constructor's executable range",
    (conversionCadence) => {
      expect(() =>
        buildComputeLaunch({
          ...launch,
          config: { ...config, launchPolicy: { ...launchPolicy, conversionCadence } },
        }),
      ).toThrow(/cadence/i);
    },
  );

  it.each(["3600", "2592000"])("accepts contract cadence boundary %s", (conversionCadence) => {
    const tx = buildComputeLaunch({
      ...launch,
      config: { ...config, launchPolicy: { ...launchPolicy, conversionCadence } },
    });
    expect(tx.args[2].conversionCadence).toBe(Number(conversionCadence));
    expect(() => encodeFunctionData(tx)).not.toThrow();
  });

  it("rejects a project name below the character limit but above the factory UTF-8 byte limit", () => {
    const oversizedName = "档".repeat(43);
    expect(oversizedName.length).toBeLessThan(80);
    expect(validateComputeDraft({ ...draft, name: oversizedName }).name).toMatch(/128|byte/i);
    expect(() =>
      buildComputeLaunch({ ...launch, draft: { ...draft, name: oversizedName } }),
    ).toThrow(/128|byte/i);
  });

  it("accepts a multibyte project name at the factory byte limit", () => {
    expect(() =>
      buildComputeLaunch({ ...launch, draft: { ...draft, name: "档".repeat(42) + "ab" } }),
    ).not.toThrow();
  });

  it("supports the factory's zero cash-out tax while preserving nonzero production allocation", () => {
    const tx = buildComputeLaunch({ ...launch, draft: { ...draft, cashOutTaxBps: 0 } });
    expect(tx.args[1][0].cashOutTaxRate).toBe(0);
    expect(() => encodeFunctionData(tx)).not.toThrow();
  });

  it("rejects native creation values outside uint256 before constructing a wallet request", () => {
    expect(() => buildComputeLaunch({ ...launch, creationFee: 1n << 256n })).toThrow(
      /context|fee|bound/i,
    );
  });

  it.each([
    "minBatchTokens",
    "maxBatchTokens",
    "minVVVPerProjectToken",
    "minDiemPerVVV",
    "maxPrincipal",
  ])("rejects uint128 overflow in %s", (field) => {
    expect(() =>
      buildComputeLaunch({
        ...launch,
        config: { ...config, launchPolicy: { ...launchPolicy, [field]: (1n << 128n).toString() } },
      }),
    ).toThrow(/bound/i);
  });

  it("rejects issuance overflow and reversed batch bounds", () => {
    expect(() =>
      buildComputeLaunch({
        ...launch,
        config: {
          ...config,
          launchPolicy: { ...launchPolicy, initialIssuance: (1n << 112n).toString() },
        },
      }),
    ).toThrow(/bound/i);
    expect(() =>
      buildComputeLaunch({
        ...launch,
        config: {
          ...config,
          launchPolicy: { ...launchPolicy, minBatchTokens: "2", maxBatchTokens: "1" },
        },
      }),
    ).toThrow(/batch/i);
  });
});

describe("compute payment contract boundaries", () => {
  it.each(["projectId", "amount", "quotedTokens"])(
    "rejects uint256 overflow in %s at the helper boundary",
    (field) => {
      expect(() => buildComputePayment({ ...payment, [field]: 1n << 256n })).toThrow(
        /bound|uint256/i,
      );
    },
  );

  it.each(["terminal", "beneficiary"])("rejects zero %s", (field) => {
    expect(() => buildComputePayment({ ...payment, [field]: zero })).toThrow(
      /address|terminal|beneficiary/i,
    );
  });

  it.each(["terminal", "beneficiary"])("rejects malformed %s", (field) => {
    expect(() => buildComputePayment({ ...payment, [field]: "0x1234" as Address })).toThrow(
      /address|terminal|beneficiary/i,
    );
  });

  it("accepts exact uint256 upper boundaries without JavaScript number conversion", () => {
    const max = (1n << 256n) - 1n;
    const tx = buildComputePayment({
      ...payment,
      projectId: max,
      amount: max,
      quotedTokens: max,
      slippageBps: 0,
    });
    expect(tx.args[0]).toBe(max);
    expect(tx.args[2]).toBe(max);
    expect(tx.args[4]).toBe(max);
    expect(() => encodeFunctionData(tx)).not.toThrow();
  });
});
