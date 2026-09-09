import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  http,
  getAddress,
  parseAbi,
  keccak256,
  zeroAddress,
} from "viem";
import { base } from "viem/chains";
import { ApiError } from "./policy.mjs";
import {
  factoryAbi,
  vaultAbi,
  factoryPolicyVersion,
  isSupportedPolicyVersion,
} from "../contracts.mjs";
const hashShape = (value) =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const deploymentUnavailable = (message) =>
  new ApiError(503, "deployment_unavailable", message);
export const VVV = "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf";
const projectsAbi = parseAbi([
  "function MULTI_TERMINAL() view returns(address)",
  "function PROJECTS() view returns(address)",
  "function creationFee() view returns(uint256)",
]);
export async function loadManifest(path) {
  if (!path) return null;
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (
    manifest.chainId !== 8453 ||
    getAddress(manifest.vvvAddress) !== VVV ||
    !manifest.factoryAddress ||
    !manifest.canonicalTerminal ||
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.factoryRuntimeHash)
  )
    throw new Error("A pinned Base deployment manifest is required.");
  getAddress(manifest.factoryAddress);
  getAddress(manifest.canonicalTerminal);
  if (
    manifest.policyVersion !== undefined &&
    !isSupportedPolicyVersion(manifest.policyVersion)
  )
    throw new Error("Unsupported manifest policy version.");
  validateLaunchPolicy(manifest.launchPolicy);
  return manifest;
}
export function validateLaunchPolicy(policy) {
  if (!policy || typeof policy !== "object")
    throw new Error("An explicit launchPolicy economic preset is required.");
  for (const [key, bits] of [
    ["conversionCadence", 48],
    ["minBatchTokens", 128],
    ["maxBatchTokens", 128],
    ["minVVVPerProjectToken", 128],
    ["minDiemPerVVV", 128],
    ["maxPrincipal", 128],
    ["initialIssuance", 112],
  ]) {
    if (
      typeof policy[key] !== "string" ||
      !/^[1-9][0-9]*$/.test(policy[key]) ||
      BigInt(policy[key]) >= 1n << BigInt(bits)
    )
      throw new Error(`Invalid launchPolicy.${key}.`);
  }
  if (BigInt(policy.maxBatchTokens) < BigInt(policy.minBatchTokens))
    throw new Error("Invalid launch policy batch bounds.");
  return policy;
}
export class ProjectRegistry {
  constructor({ rpcUrl, manifest, publicClient }) {
    this.manifest = manifest;
    this.client =
      publicClient ??
      (rpcUrl
        ? createPublicClient({
            chain: base,
            transport: http(rpcUrl, { retryCount: 0, timeout: 10000 }),
          })
        : null);
  }
  async assertDeployment() {
    if (!this.client || !this.manifest)
      throw deploymentUnavailable(
        "Project deployment has not been configured.",
      );
    if ((await this.client.getChainId()) !== 8453)
      throw deploymentUnavailable("Base deployment verification failed.");
    const block = await this.client.getBlock({ blockTag: "safe" });
    if (
      typeof block?.number !== "bigint" ||
      block.number <= 0n ||
      !hashShape(block.hash)
    )
      throw deploymentUnavailable("An identified safe Base block is required.");
    const blockNumber = block.number;
    const code = await this.client.getCode({
      address: this.manifest.factoryAddress,
      blockNumber,
    });
    if (
      !code ||
      keccak256(code).toLowerCase() !==
        this.manifest.factoryRuntimeHash.toLowerCase()
    )
      throw deploymentUnavailable("Factory runtime verification failed.");
    const [rev, rawVersion] = await Promise.all(
      ["REV_DEPLOYER", "POLICY_VERSION"].map((functionName) =>
        this.client.readContract({
          address: this.manifest.factoryAddress,
          abi: factoryAbi,
          functionName,
          blockNumber,
        }),
      ),
    );
    let policyVersion;
    try {
      policyVersion = factoryPolicyVersion(rawVersion);
    } catch {
      throw deploymentUnavailable(
        "Factory policy version verification failed.",
      );
    }
    if (
      this.manifest.policyVersion !== undefined &&
      this.manifest.policyVersion !== policyVersion
    )
      throw deploymentUnavailable(
        "Manifest policy version verification failed.",
      );
    const terminal = await this.client.readContract({
      address: rev,
      abi: projectsAbi,
      functionName: "MULTI_TERMINAL",
      blockNumber,
    });
    if (getAddress(terminal) !== getAddress(this.manifest.canonicalTerminal))
      throw deploymentUnavailable("Canonical terminal verification failed.");
    const proof = {
      blockNumber,
      blockHash: block.hash,
      revnetDeployer: rev,
      policyVersion,
    };
    await this.assertBlockUnchanged(proof);
    return proof;
  }
  async assertBlockUnchanged({ blockNumber, blockHash }) {
    const block = await this.client.getBlock({ blockNumber });
    if (
      block?.number !== blockNumber ||
      !hashShape(block.hash) ||
      block.hash.toLowerCase() !== blockHash.toLowerCase()
    )
      throw deploymentUnavailable("The Base verification block changed.");
  }
  async config(apiBaseUrl) {
    const minimal = {
      chainId: 8453,
      vvvAddress: VVV,
      factoryAddress: this.manifest?.factoryAddress ?? null,
      canonicalTerminal: this.manifest?.canonicalTerminal ?? null,
      creationFee: null,
      ready: false,
      policyVersion: null,
      launchPolicy: this.manifest?.launchPolicy ?? null,
      apiBaseUrl,
    };
    if (!this.manifest || !this.client) return minimal;
    try {
      const proof = await this.assertDeployment();
      const projects = await this.client.readContract({
        address: proof.revnetDeployer,
        abi: projectsAbi,
        functionName: "PROJECTS",
        blockNumber: proof.blockNumber,
      });
      const fee = await this.client.readContract({
        address: projects,
        abi: projectsAbi,
        functionName: "creationFee",
        blockNumber: proof.blockNumber,
      });
      await this.assertBlockUnchanged(proof);
      return {
        ...minimal,
        ready: true,
        creationFee: fee.toString(),
        policyVersion: proof.policyVersion,
      };
    } catch {
      return minimal;
    }
  }
  async verifyProject({
    revnetId,
    wrapperAddress,
    vaultAddress,
    creatorAddress,
    inferenceSigner,
  }) {
    const deployment = await this.assertDeployment();
    const { blockNumber, policyVersion } = deployment;
    const [wrapper, vault, creator, policyHash] = await Promise.all(
      ["policyOf", "vaultOf", "creatorOf", "policyHashOf"].map((functionName) =>
        this.client.readContract({
          address: this.manifest.factoryAddress,
          abi: factoryAbi,
          functionName,
          args: [BigInt(revnetId)],
          blockNumber,
        }),
      ),
    );
    if (
      vault === zeroAddress ||
      getAddress(wrapper) !== getAddress(wrapperAddress) ||
      getAddress(vault) !== getAddress(vaultAddress) ||
      getAddress(creator) !== getAddress(creatorAddress)
    )
      throw new ApiError(
        409,
        "unverified_project",
        "The confirmed factory registration does not match this creator and project.",
      );
    const signer = await this.client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "inferenceSigner",
      blockNumber,
    });
    if (getAddress(signer) !== getAddress(inferenceSigner))
      throw new ApiError(
        409,
        "unverified_signer",
        "The vault does not use the prepared inference signer.",
      );
    const [generation, enabled] = await Promise.all(
      ["signerGeneration", "authenticationEnabled"].map((functionName) =>
        this.client.readContract({
          address: vault,
          abi: vaultAbi,
          functionName,
          blockNumber,
        }),
      ),
    );
    const [latestSigner, latestGeneration, latestEnabled] = await Promise.all(
      ["inferenceSigner", "signerGeneration", "authenticationEnabled"].map(
        (functionName) =>
          this.client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName,
            blockTag: "latest",
          }),
      ),
    );
    if (
      getAddress(latestSigner) !== getAddress(signer) ||
      latestGeneration !== generation ||
      latestEnabled !== enabled ||
      generation < 1n ||
      generation > 2147483647n
    )
      throw new ApiError(
        409,
        "authentication_pending",
        "Wait for the confirmed vault authentication state before synchronizing.",
      );
    await this.assertBlockUnchanged(deployment);
    return {
      policyHash,
      policyVersion,
      blockNumber,
      signerGeneration: Number(generation),
      authenticationEnabled: enabled,
    };
  }
}
