import { decodeEventLog, isAddress, zeroAddress, type Address, type Hex, type Log } from "viem";
import { computeFactoryAbi } from "./factory";
import { validateComputeDraft } from "./presentation";
import { assertLaunchDeploymentConfig, COMPUTE_CHAIN_ID } from "./transactions";
import type { ComputeDeployment, ComputeProjectDraft } from "./types";

export type LaunchPolicy = {
  conversionCadence: string;
  minBatchTokens: string;
  maxBatchTokens: string;
  minVVVPerProjectToken: string;
  minDiemPerVVV: string;
  maxPrincipal: string;
  initialIssuance: string;
};

function positive(value: unknown, bits: number): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
    throw new Error("Launch policy values must be positive integers.");
  if (value.length > Math.ceil(bits * Math.LOG10E * Math.LN2))
    throw new Error("Launch policy value exceeds its contract bound.");
  const number = BigInt(value);
  if (number >= 2n ** BigInt(bits))
    throw new Error("Launch policy value exceeds its contract bound.");
  return number;
}

export function buildComputeLaunch({
  config,
  draft,
  metadataUri,
  salt,
  creator,
  inferenceSigner,
  timestamp,
  creationFee,
}: {
  config: unknown;
  draft: ComputeProjectDraft;
  metadataUri: string;
  salt: Hex;
  creator: Address;
  inferenceSigner: Address;
  timestamp: number;
  creationFee: bigint;
}) {
  assertLaunchDeploymentConfig(config);
  const policy = (config as typeof config & { launchPolicy?: LaunchPolicy }).launchPolicy;
  if (!policy) throw new Error("The deployment has no reviewed launch policy.");
  if (
    !Number.isInteger(draft.productionSplitBps) ||
    draft.productionSplitBps <= 0 ||
    draft.productionSplitBps >= 10_000
  )
    throw new Error("Invalid compute production split.");
  if (
    !Number.isInteger(draft.cashOutTaxBps) ||
    draft.cashOutTaxBps < 0 ||
    draft.cashOutTaxBps >= 10_000
  )
    throw new Error("Invalid cash-out tax.");
  // Recovery must be independent of the creator: if that wallet is lost, the
  // recovery wallet is the only authority left to start the wind-down.
  const errors = validateComputeDraft(draft, creator);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const recovery = draft.recoveryAddress;
  if (!recovery || recovery.toLowerCase() === creator.toLowerCase())
    throw new Error("Choose a separate recovery wallet.");
  if (!/^ipfs:\/\/[a-zA-Z0-9]+$/.test(metadataUri))
    throw new Error("Pin project metadata before launching.");
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(salt) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    timestamp + 600 >= 2 ** 48 ||
    typeof creationFee !== "bigint" ||
    creationFee < 0n ||
    creationFee >= 2n ** 256n
  )
    throw new Error("Invalid deployment context.");
  for (const address of [creator, inferenceSigner, recovery]) {
    if (!isAddress(address) || address.toLowerCase() === zeroAddress)
      throw new Error("Invalid project authority.");
  }
  const policyConfig = {
    conversionCadence: Number(positive(policy.conversionCadence, 48)),
    minBatchTokens: positive(policy.minBatchTokens, 128),
    maxBatchTokens: positive(policy.maxBatchTokens, 128),
    minVVVPerProjectToken: positive(policy.minVVVPerProjectToken, 128),
    minDiemPerVVV: positive(policy.minDiemPerVVV, 128),
    maxPrincipal: positive(policy.maxPrincipal, 128),
  };
  if (policyConfig.conversionCadence < 3_600 || policyConfig.conversionCadence > 30 * 86_400)
    throw new Error("The conversion cadence must be between one hour and 30 days.");
  if (policyConfig.minBatchTokens > policyConfig.maxBatchTokens)
    throw new Error("Invalid launch policy batch bounds.");
  return {
    chainId: COMPUTE_CHAIN_ID,
    address: config.factoryAddress,
    abi: computeFactoryAbi,
    functionName: "deployFor" as const,
    value: creationFee,
    args: [
      { name: draft.name.trim(), ticker: "COMPUTE", uri: metadataUri, salt },
      [
        {
          startsAtOrAfter: timestamp + 600,
          splitPercent: draft.productionSplitBps,
          initialIssuance: positive(policy.initialIssuance, 112),
          issuanceCutFrequency: 0,
          issuanceCutPercent: 0,
          cashOutTaxRate: draft.cashOutTaxBps,
          operatorSplitPercent: draft.operatorSplitBps,
        },
      ],
      policyConfig,
      recovery,
      inferenceSigner,
    ] as const,
  };
}

/** A receipt from another contract or creator can never register this launch. */
export function decodeComputeDeployment(
  receipt: { status: string; logs: readonly Pick<Log, "address" | "data" | "topics">[] },
  factory: Address,
  creator: Address,
): ComputeDeployment {
  if (receipt.status !== "success") throw new Error("The launch transaction reverted.");
  const deployments: ComputeDeployment[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: computeFactoryAbi,
        eventName: "DeployProject",
        data: log.data,
        topics: log.topics,
      });
      if (event.args.creator.toLowerCase() !== creator.toLowerCase()) continue;
      deployments.push({
        revnetId: event.args.revnetId.toString(),
        wrapperAddress: event.args.policy,
        vaultAddress: event.args.vault,
      });
    } catch {
      /* Other factory events are not a deployment. */
    }
  }
  if (deployments.length !== 1)
    throw new Error(
      "A unique matching deployment event was not found. Keep the transaction hash and resume registration.",
    );
  return deployments[0];
}
