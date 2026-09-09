import {
  formatPolicyInterval,
  parseReviewedLaunchConfig,
  reviewedConfigKey,
} from "@/lib/telligence/policy-review";
import { describe, expect, it } from "vitest";

const config = {
  ready: true,
  policyVersion: "2" as const,
  chainId: 8453,
  factoryAddress: "0x1111111111111111111111111111111111111111",
  canonicalTerminal: "0x2222222222222222222222222222222222222222",
  vvvAddress: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf",
  launchPolicy: {
    conversionCadence: "3600",
    minBatchTokens: "1000000000000000000",
    maxBatchTokens: "100000000000000000000000",
    minVVVPerProjectToken: "100000000000000",
    minDiemPerVVV: "10000000000000000",
    maxPrincipal: "10000000000000000000000",
    initialIssuance: "1000000000000000000000000",
  },
};

describe("immutable launch policy review", () => {
  it("requires a complete ready Base deployment and exact bounded policy values", () => {
    expect(parseReviewedLaunchConfig(config)).toEqual(config);
    expect(() => parseReviewedLaunchConfig({ ...config, ready: false })).toThrow();
    expect(() =>
      parseReviewedLaunchConfig({
        ...config,
        launchPolicy: { ...config.launchPolicy, minDiemPerVVV: "0" },
      }),
    ).toThrow();
    expect(() =>
      parseReviewedLaunchConfig({
        ...config,
        launchPolicy: {
          ...config.launchPolicy,
          minBatchTokens: config.launchPolicy.maxBatchTokens,
          maxBatchTokens: "1",
        },
      }),
    ).toThrow();
    expect(() =>
      parseReviewedLaunchConfig({
        ...config,
        launchPolicy: { ...config.launchPolicy, conversionCadence: String(2 ** 48) },
      }),
    ).toThrow();
  });
  it.each([undefined, null, "1", "3", 2])(
    "does not review a new launch against an unsupported factory version: %j",
    (policyVersion) => {
      expect(() => parseReviewedLaunchConfig({ ...config, policyVersion })).toThrow(/version/i);
    },
  );
  it("binds every reviewed policy value and deployment address without key-order ambiguity", () => {
    const reviewed = parseReviewedLaunchConfig(config);
    const changedFactory = parseReviewedLaunchConfig({
      ...config,
      factoryAddress: "0x4444444444444444444444444444444444444444",
    });
    expect(reviewedConfigKey(reviewed)).not.toBe(reviewedConfigKey(changedFactory));
    for (const key of Object.keys(config.launchPolicy)) {
      const changed = parseReviewedLaunchConfig({
        ...config,
        launchPolicy: {
          ...config.launchPolicy,
          [key]: String(BigInt(config.launchPolicy[key as keyof typeof config.launchPolicy]) + 1n),
        },
      });
      expect(reviewedConfigKey(reviewed)).not.toBe(reviewedConfigKey(changed));
    }
    expect(
      reviewedConfigKey(
        parseReviewedLaunchConfig({ ...config, launchPolicy: config.launchPolicy }),
      ),
    ).toBe(reviewedConfigKey(reviewed));
  });
  it("describes a minimum interval with exact familiar units", () => {
    expect(formatPolicyInterval("3600")).toBe("1 hour");
    expect(formatPolicyInterval("86400")).toBe("1 day");
    expect(formatPolicyInterval("90")).toBe("90 seconds");
  });
});
