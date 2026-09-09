import {
  ipfsAssetPath,
  isIpfsCid,
  jbControllerAbi,
  jbDirectoryAbi,
  jbPermissionsAbi,
  jbProjectsAbi,
} from "@bananapus/nana-sdk-core";
import { JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import { isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { isRecord } from "./formValidation";
import { ipfsUriToAppUrl } from "./ipfs";

type MetadataClient = Pick<PublicClient, "readContract">;

/** The source pointer and permission contracts used when preparing a metadata edit. */
export type MetadataSourceGuard = {
  chainId: number;
  projectId: string;
  directory: Address;
  projects: Address;
  permissions: Address;
  controller: Address;
  uri: string;
};

export type MetadataDestination = {
  source: MetadataSourceGuard;
  metadata: Record<string, unknown>;
};

export async function requireMetadataPermission(
  client: MetadataClient,
  source: Pick<MetadataSourceGuard, "projectId" | "projects" | "permissions" | "chainId">,
  account: Address,
): Promise<void> {
  const projectId = BigInt(source.projectId);
  const owner = await client.readContract({
    address: source.projects,
    abi: jbProjectsAbi,
    functionName: "ownerOf",
    args: [projectId],
  });
  if (owner.toLowerCase() === account.toLowerCase()) return;
  const permitted = await client.readContract({
    address: source.permissions,
    abi: jbPermissionsAbi,
    functionName: "hasPermission",
    args: [account, owner, projectId, BigInt(JBPermissionIdsV6.SET_PROJECT_URI), true, true],
  });
  if (!permitted)
    throw new Error(
      `The connected account cannot update project ${source.projectId}'s metadata on chain ${source.chainId}.`,
    );
}

/** Reads the active controller and immutable document; a failed read never becomes an empty document. */
export async function readMetadataDestination(
  client: MetadataClient,
  identity: Omit<MetadataSourceGuard, "controller" | "uri">,
  account?: Address,
): Promise<MetadataDestination> {
  if (account) await requireMetadataPermission(client, identity, account);
  const controller = await client.readContract({
    address: identity.directory,
    abi: jbDirectoryAbi,
    functionName: "controllerOf",
    args: [BigInt(identity.projectId)],
  });
  if (!isAddress(controller) || controller === zeroAddress)
    throw new Error(
      `Project ${identity.projectId} has no active controller on chain ${identity.chainId}.`,
    );
  const uri = await client.readContract({
    address: controller,
    abi: jbControllerAbi,
    functionName: "uriOf",
    args: [BigInt(identity.projectId)],
  });
  const source = { ...identity, controller, uri };
  if (!uri.trim()) return { source, metadata: {} };
  const asset = ipfsAssetPath(uri.trim()) ?? (isIpfsCid(uri.trim()) ? uri.trim() : undefined);
  const url = asset ? ipfsUriToAppUrl(`ipfs://${asset}`) : undefined;
  if (!url)
    throw new Error(
      `The metadata URI on chain ${identity.chainId} is not a readable content-addressed document. It cannot be safely overwritten.`,
    );
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error(`Could not load metadata on chain ${identity.chainId} (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Metadata on chain ${identity.chainId} has no readable body.`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 512 * 1024) {
        await reader.cancel();
        throw new Error("Project metadata exceeds the supported size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(metadata))
    throw new Error(`Metadata on chain ${identity.chainId} must be a JSON object.`);
  return { source, metadata };
}

/** Rechecked before each wallet action so a changed URI/controller cannot receive a stale merge. */
export async function verifyMetadataSource(
  client: MetadataClient,
  source: MetadataSourceGuard,
  account: Address,
): Promise<void> {
  await requireMetadataPermission(client, source, account);
  const controller = await client.readContract({
    address: source.directory,
    abi: jbDirectoryAbi,
    functionName: "controllerOf",
    args: [BigInt(source.projectId)],
  });
  if (controller.toLowerCase() !== source.controller.toLowerCase())
    throw new Error(
      `The active controller changed on chain ${source.chainId}. Reopen the metadata editor before continuing.`,
    );
  const uri = await client.readContract({
    address: source.controller,
    abi: jbControllerAbi,
    functionName: "uriOf",
    args: [BigInt(source.projectId)],
  });
  if (uri !== source.uri)
    throw new Error(
      `The source metadata changed on chain ${source.chainId}. Reopen the metadata editor before continuing.`,
    );
}
