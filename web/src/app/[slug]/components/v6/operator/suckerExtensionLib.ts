import { isTestnetChain, MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "@/app/constants";
import { isNativeToken } from "@/lib/tokenUtils";
import {
  JBChainId,
  MappableAsset,
  parseSuckerDeployerConfig,
  revDeployerAbi,
  RevnetCoreContracts,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import { Abi } from "viem";
import { ChainProjectRow, ChainWrite, v6ContractAddress } from "./operatorLib";

/**
 * The chains a sucker group could extend to: the group's own environment
 * (production or testnet — suckers never bridge across them), minus the
 * chains the group already spans.
 */
export function extensionCandidateChains(groupRows: readonly ChainProjectRow[]): JBChainId[] {
  const member = new Set(groupRows.map((row) => Number(row.chainId)));
  const environment = groupRows.some((row) => isTestnetChain(row.chainId))
    ? TESTNET_CHAIN_IDS
    : MAINNET_CHAIN_IDS;
  return environment.filter((chainId) => !member.has(chainId));
}

/**
 * The bridgeable assets for new sucker token mappings, derived from the
 * revnet's accounting contexts (JBMultiTerminal.accountingContextsOf on a
 * chain it's already deployed on): the native token and the chain's canonical
 * USDC bridge; custom reserve tokens have no canonical bridge mapping, so
 * they're excluded — the suckers still map the project token itself.
 */
export function assetsFromAccountingContexts(
  contexts: readonly { token: string }[],
  chainId: number,
): MappableAsset[] {
  const assets: MappableAsset[] = [];
  const usdc = USDC_ADDRESSES[chainId as JBChainId]?.toLowerCase();
  for (const context of contexts) {
    if (isNativeToken(context.token)) {
      if (!assets.includes(MappableAsset.NATIVE)) assets.push(MappableAsset.NATIVE);
    } else if (usdc && context.token.toLowerCase() === usdc) {
      if (!assets.includes(MappableAsset.USDC)) assets.push(MappableAsset.USDC);
    }
  }
  return assets;
}

/**
 * One `REVDeployer.deploySuckersFor` write per chain in the extended group:
 * the target chain deploys a sucker toward every existing peer, and every
 * existing chain deploys a sucker toward the target.
 *
 * What the contract dictates (REVDeployer.sol):
 * - Only the revnet's OPERATOR may call (`_checkIfIsOperatorOf`), and the
 *   current ruleset must allow deploying suckers (metadata bit 2). Both are
 *   enforced on-chain and caught by the simulate-first pipeline.
 * - The revnet must already be deployed on the target chain with the
 *   byte-identical configuration: each sucker's CREATE2 salt is
 *   keccak(hashedEncodedConfigurationOf[revnetId], salt, caller), so the two
 *   ends of an edge only land at the same address — which is what pairs them
 *   — when the config hashes match, the user salt matches, and the SAME
 *   operator address calls on both chains.
 */
export function buildSuckerExtensionWrites({
  groupRows,
  targetChainId,
  targetProjectId,
  assets,
  salt,
}: {
  groupRows: readonly ChainProjectRow[];
  targetChainId: JBChainId;
  targetProjectId: number | bigint;
  assets: MappableAsset[];
  salt: `0x${string}`;
}): ChainWrite[] {
  if (groupRows.some((row) => Number(row.chainId) === Number(targetChainId))) {
    throw new Error("The revnet is already connected on that chain.");
  }
  if (groupRows.length === 0) {
    throw new Error("The sucker group has no existing chains to link.");
  }

  const writeFor = (
    chainId: JBChainId,
    projectId: number | bigint,
    peerChains: JBChainId[],
  ): ChainWrite => {
    const address = v6ContractAddress(RevnetCoreContracts.REVDeployer, chainId);
    if (!address) {
      throw new Error(`REVDeployer isn't deployed on chain ${chainId}.`);
    }
    const { deployerConfigurations } = parseSuckerDeployerConfig(
      chainId,
      [chainId, ...peerChains],
      assets,
      { version: 6 },
    );
    return {
      chainId,
      address,
      abi: revDeployerAbi as Abi,
      functionName: "deploySuckersFor",
      args: [BigInt(projectId), { deployerConfigurations, salt }],
    };
  };

  return [
    writeFor(
      targetChainId,
      targetProjectId,
      groupRows.map((row) => row.chainId),
    ),
    ...groupRows.map((row) => writeFor(row.chainId, row.projectId, [targetChainId])),
  ];
}
