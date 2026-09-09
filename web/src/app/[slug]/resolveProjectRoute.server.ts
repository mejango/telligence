import "server-only";

import { readCrossChainHandleAuthority } from "@/lib/cross-chain-authority";
import { getEnsPublicClient } from "@/lib/ensPublicClient.server";
import {
  ENS_REGISTRY_ADDRESS,
  ensRegistryAbi,
  parseProjectHandleInput,
  parseProjectHandleRecord,
  readExactEnsText,
  readExactProjectHandle,
} from "@/lib/projectHandles";
import {
  findCurrentRevnetOperator,
  findRevnetOperatorFromPermissionHistory,
} from "@/lib/revnetOperator";
import { decodeProjectRouteSlug, parseDecodedSlug, parseSlug } from "@/lib/slug";
import { COMPUTE_CHAIN_ID } from "@/lib/telligence/transactions";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  getJBContractAddress,
  JBCoreContracts,
  jbProjectsAbi,
  RevnetCoreContracts,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { cache } from "react";
import { namehash, zeroAddress, type Address } from "viem";
import { getIndexedProjectOperatorAddresses } from "./getProjectOperator";

export type ResolvedProjectRoute = ReturnType<typeof parseSlug> & {
  /** Present only when an @handle route live-verified this exact setter. */
  verifiedOperator?: Address;
};

/**
 * Resolve either a numeric project slug or a bidirectionally verified ENS
 * handle. Handle lookups deliberately remain live: ENS records and revnet
 * operators can both change, so a durable route cache would preserve stale
 * authority.
 */
export async function resolveProjectRouteUncached(
  slug: string,
): Promise<ResolvedProjectRoute | null> {
  const decodedSlug = decodeProjectRouteSlug(slug);
  if (decodedSlug === null) return null;

  try {
    const route = parseDecodedSlug(decodedSlug);
    return route.chainId === COMPUTE_CHAIN_ID && route.projectId <= BigInt(Number.MAX_SAFE_INTEGER)
      ? route
      : null;
  } catch {
    // Continue only for the explicit pretty-route syntax below.
  }

  if (!decodedSlug.startsWith("@")) return null;

  let requested;
  try {
    requested = parseProjectHandleInput(decodedSlug);
  } catch {
    return null;
  }

  try {
    const client = getEnsPublicClient();
    const node = namehash(requested.ensName);
    const blockNumber = await client.getBlockNumber();
    const resolver = await client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
      blockNumber,
    });
    if (resolver === zeroAddress) return null;
    const record = parseProjectHandleRecord(
      await readExactEnsText(client, resolver, node, blockNumber),
    );
    // ENS remains on Ethereum, but a mutable handle must never route this
    // Base-only product to another chain. Check before selecting its client.
    if (
      !record ||
      record.chainId !== COMPUTE_CHAIN_ID ||
      record.projectId > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return null;

    // Revnet operators are the callable authority shown by this client's
    // Operator tab. An arbitrary permissionless setter must never make a
    // handle canonical here.
    const projectClient = getViemPublicClient(record.chainId);
    const projectBlock = await projectClient.getBlockNumber();
    const revOwnerAddress = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, record.chainId);
    const projectOwner = await projectClient.readContract({
      address: getJBContractAddress(JBCoreContracts.JBProjects, 6, record.chainId),
      abi: jbProjectsAbi,
      functionName: "ownerOf",
      args: [record.projectId],
      blockNumber: projectBlock,
    });
    if (projectOwner.toLowerCase() !== revOwnerAddress.toLowerCase()) return null;
    const candidateIsCurrent = (candidate: Address) =>
      projectClient.readContract({
        address: revOwnerAddress,
        abi: revOwnerAbi,
        functionName: "isOperatorOf",
        args: [record.projectId, candidate],
        blockNumber: projectBlock,
      });
    const candidateVerifies = async (candidate: Address) => {
      // The reverse claim is written on Ethereum even for L2 revnets. Address
      // equality alone is not proof that a contract operator has the same
      // controller on both chains.
      const authority = await readCrossChainHandleAuthority({
        sourceChainId: record.chainId,
        sourceClient: projectClient,
        mainnetClient: client,
        authority: candidate,
        sourceBlockNumber: projectBlock,
        mainnetBlockNumber: blockNumber,
      });
      if (!authority.allowed) return false;

      const verified = await readExactProjectHandle(
        client,
        record.chainId,
        record.projectId,
        candidate,
        blockNumber,
      );
      return verified === requested.handle;
    };

    // Bendystraw is a fast candidate source, not a routing dependency. A
    // newly published handle must route immediately even while its operator
    // row is stale or the indexer is unavailable.
    let operator = null;
    try {
      operator = await findCurrentRevnetOperator(
        await getIndexedProjectOperatorAddresses(Number(record.projectId), record.chainId),
        candidateIsCurrent,
      );
    } catch {
      // Fall back to canonical target-chain permission history below.
    }
    if (operator) {
      // isOperatorOf represents the complete operator permission set and
      // REVOwner rotation revokes it before granting the replacement. Once a
      // live indexed operator is known, a bad identity/handle is a definitive
      // mismatch — do not turn arbitrary invalid ENS aliases into historical
      // log scans.
      if (!(await candidateVerifies(operator))) return null;
      return { chainId: record.chainId, projectId: record.projectId, verifiedOperator: operator };
    }

    // Continue through canonical history only if Bendystraw was stale or
    // unavailable. Discovery stops at the first live REVOwner operator; the
    // comparatively expensive cross-chain identity and handle checks run once.
    {
      operator = await findRevnetOperatorFromPermissionHistory({
        client: projectClient,
        chainId: record.chainId,
        permissions: getJBContractAddress(JBCoreContracts.JBPermissions, 6, record.chainId),
        revOwner: revOwnerAddress,
        projectId: record.projectId,
        throughBlock: projectBlock,
        accept: candidateIsCurrent,
      });
    }
    if (!operator || !(await candidateVerifies(operator))) return null;
    return { chainId: record.chainId, projectId: record.projectId, verifiedOperator: operator };
  } catch {
    // ENS, the resolver, Bendystraw, and RPC are all upstream route
    // dependencies. Fail closed instead of accepting one side of the link.
    return null;
  }
}

export const resolveProjectRoute = cache(resolveProjectRouteUncached);
