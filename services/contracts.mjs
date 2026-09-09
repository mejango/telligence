import factoryAbi from "../packages/contracts/TelligenceFactory.json" with { type: "json" };
import vaultAbi from "../packages/contracts/TelligenceComputeVault.json" with { type: "json" };

export { factoryAbi, vaultAbi };

const supportedPolicyVersions = new Set(["1", "2"]);
export function isSupportedPolicyVersion(value) {
  return typeof value === "string" && supportedPolicyVersions.has(value);
}
export function factoryPolicyVersion(value) {
  if (
    typeof value !== "bigint" ||
    value <= 0n ||
    value >= 1n << 256n ||
    !isSupportedPolicyVersion(value.toString())
  ) {
    const error = new Error("Unsupported factory policy version.");
    error.code = "UNSUPPORTED_POLICY_VERSION";
    throw error;
  }
  return value.toString();
}
