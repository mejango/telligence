import { buildPayTx } from "@bananapus/nana-sdk-core/v6";
import { isAddress, parseUnits, zeroAddress, type Address } from "viem";

export const COMPUTE_CHAIN_ID = 8453 as const;
export const VVV_ADDRESS = "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf" as const;
export const VVV_STAKING_ADDRESS = "0x321b7ff75154472B18EDb199033fF4D116F340Ff" as const;

export type ComputeDeploymentConfig = {
  ready: boolean;
  policyVersion: "1" | "2";
  chainId: number;
  factoryAddress: Address;
  canonicalTerminal: Address;
  vvvAddress: Address;
};

/** No float parsing or rounding at the wallet boundary. */
export function parseVvvAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error("Enter a positive VVV amount with at most 18 decimal places.");
  }
  const amount = parseUnits(value, 18);
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error("Enter a positive VVV amount.");
  return amount;
}

/** Server configuration enables a route; chain reads still verify its binding. */
export function assertDeploymentConfig(value: unknown): asserts value is ComputeDeploymentConfig {
  if (!value || typeof value !== "object") throw new Error("Compute deployment is not available.");
  const config = value as Record<string, unknown>;
  if (config.ready !== true) throw new Error("Compute deployment is not available yet.");
  if (config.chainId !== COMPUTE_CHAIN_ID) throw new Error("Telligence uses Base only.");
  if (config.policyVersion !== "1" && config.policyVersion !== "2")
    throw new Error("The compute deployment has an unsupported policy version.");
  if (
    typeof config.vvvAddress !== "string" ||
    config.vvvAddress.toLowerCase() !== VVV_ADDRESS.toLowerCase()
  ) {
    throw new Error("The deployment does not use canonical VVV.");
  }
  for (const field of ["factoryAddress", "canonicalTerminal"]) {
    const address = config[field];
    if (
      typeof address !== "string" ||
      !isAddress(address) ||
      address.toLowerCase() === zeroAddress
    ) {
      throw new Error("The compute deployment is incomplete.");
    }
  }
}

/** Version 2 appends the operator share to the factory's deployment calldata. */
export function assertLaunchDeploymentConfig(
  value: unknown,
): asserts value is ComputeDeploymentConfig & { policyVersion: "2" } {
  assertDeploymentConfig(value);
  if (value.policyVersion !== "2")
    throw new Error("New projects require compute policy version 2.");
}

export function buildComputePayment({
  projectId,
  terminal,
  beneficiary,
  amount,
  quotedTokens,
  slippageBps,
}: {
  projectId: bigint;
  terminal: Address;
  beneficiary: Address;
  amount: bigint;
  quotedTokens: bigint;
  slippageBps: number;
}) {
  if (
    typeof projectId !== "bigint" ||
    typeof amount !== "bigint" ||
    typeof quotedTokens !== "bigint" ||
    projectId <= 0n ||
    amount <= 0n ||
    quotedTokens <= 0n
  )
    throw new Error("A positive payment and fresh quote are required.");
  if (projectId >= 2n ** 256n || amount >= 2n ** 256n || quotedTokens >= 2n ** 256n)
    throw new Error("Payment values exceed their uint256 contract bound.");
  for (const address of [terminal, beneficiary]) {
    if (typeof address !== "string" || !isAddress(address) || address.toLowerCase() === zeroAddress)
      throw new Error("Use a nonzero terminal and beneficiary address.");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500)
    throw new Error("Invalid payment slippage.");
  const minimum = (quotedTokens * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minimum === 0n) throw new Error("The payment quote is too small.");
  return buildPayTx({
    chainId: COMPUTE_CHAIN_ID,
    terminal,
    projectId,
    token: VVV_ADDRESS,
    amount,
    beneficiary,
    minReturnedTokens: minimum,
    memo: "Support compute",
    // Empty metadata retains stock routing and its production splits.
    metadata: "0x",
  });
}
