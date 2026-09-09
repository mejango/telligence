import type { LaunchPolicy } from "./launch";
import { assertLaunchDeploymentConfig, type ComputeDeploymentConfig } from "./transactions";

export type ReviewedLaunchConfig = ComputeDeploymentConfig & {
  policyVersion: "2";
  launchPolicy: LaunchPolicy;
};
const policyFields = [
  "conversionCadence",
  "minBatchTokens",
  "maxBatchTokens",
  "minVVVPerProjectToken",
  "minDiemPerVVV",
  "maxPrincipal",
  "initialIssuance",
] as const;

export function parseReviewedLaunchConfig(value: unknown): ReviewedLaunchConfig {
  assertLaunchDeploymentConfig(value);
  const policy = (value as ReviewedLaunchConfig).launchPolicy;
  if (!policy || typeof policy !== "object")
    throw new Error("The deployment has no published compute policy.");
  for (const key of policyFields) {
    const amount = policy[key];
    const bits = key === "conversionCadence" ? 48 : key === "initialIssuance" ? 112 : 128;
    if (
      typeof amount !== "string" ||
      !/^[1-9]\d{0,40}$/.test(amount) ||
      BigInt(amount) >= 2n ** BigInt(bits)
    )
      throw new Error("The published compute policy contains an invalid bound.");
  }
  if (BigInt(policy.minBatchTokens) > BigInt(policy.maxBatchTokens))
    throw new Error("The published compute batch bounds are inconsistent.");
  if (BigInt(policy.conversionCadence) < 3600n || BigInt(policy.conversionCadence) > 2592000n)
    throw new Error("The conversion interval must be between one hour and 30 days.");
  return {
    ready: value.ready,
    policyVersion: value.policyVersion,
    chainId: value.chainId,
    factoryAddress: value.factoryAddress,
    canonicalTerminal: value.canonicalTerminal,
    vvvAddress: value.vvvAddress,
    launchPolicy: Object.fromEntries(policyFields.map((key) => [key, policy[key]])) as LaunchPolicy,
  };
}

/** A stable comparison of every address and immutable value a creator accepted. */
export function reviewedConfigKey(config: ReviewedLaunchConfig) {
  return JSON.stringify([
    config.ready,
    config.policyVersion,
    config.chainId,
    config.factoryAddress.toLowerCase(),
    config.canonicalTerminal.toLowerCase(),
    config.vvvAddress.toLowerCase(),
    ...policyFields.map((key) => config.launchPolicy[key]),
  ]);
}

export function formatPolicyInterval(seconds: string) {
  const value = BigInt(seconds);
  for (const [unit, width] of [
    ["day", 86400n],
    ["hour", 3600n],
    ["minute", 60n],
  ] as const) {
    if (value % width === 0n) {
      const count = value / width;
      return `${count} ${unit}${count === 1n ? "" : "s"}`;
    }
  }
  return `${value} second${value === 1n ? "" : "s"}`;
}
