import type { ProjectQuery } from "@/lib/bendystraw/types";
import { revertedNonexistentToken } from "@/lib/contract-revert";
import type { IndexedReadStatus } from "@/lib/projectIndexStatus";
import { fetchIpfsMetadata } from "@/lib/projectMetadataFill.server";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  getJBContractAddress,
  JBChainId,
  jbControllerAbi,
  JBCoreContracts,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbProjectsAbi,
  NATIVE_TOKEN,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { cache } from "react";
import { erc20Abi, zeroAddress, type Address } from "viem";
import { getIndexedProject } from "./getProject";

type ProjectRow = NonNullable<ProjectQuery["project"]>;

/**
 * Build a minimal project row straight from the chain for projects that
 * Bendystraw doesn't know about yet (indexing window) or can't serve
 * (indexer outage).
 *
 * Returns null when the project genuinely doesn't exist on-chain, and
 * rethrows transport failures so an RPC outage surfaces as an error rather
 * than a false 404.
 */
const getOnchainProjectFallback = cache(
  async (projectId: number, chainId: JBChainId): Promise<ProjectRow | null> => {
    const client = getViemPublicClient(chainId);
    const id = BigInt(projectId);

    let owner: Address;
    try {
      owner = await client.readContract({
        address: getJBContractAddress(JBCoreContracts.JBProjects, 6, chainId),
        abi: jbProjectsAbi,
        functionName: "ownerOf",
        args: [id],
      });
    } catch (err) {
      // ownerOf reverts with ERC721NonexistentToken for a project that was
      // never minted. Any other failure, a node's -32603 included, rethrows.
      if (revertedNonexistentToken(err)) return null;
      throw err;
    }

    const directory = getJBContractAddress(JBCoreContracts.JBDirectory, 6, chainId);
    const [controller, terminals] = await Promise.all([
      client
        .readContract({
          address: directory,
          abi: jbDirectoryAbi,
          functionName: "controllerOf",
          args: [id],
        })
        .catch(() => zeroAddress),
      client
        .readContract({
          address: directory,
          abi: jbDirectoryAbi,
          functionName: "terminalsOf",
          args: [id],
        })
        .catch(() => [] as readonly Address[]),
    ]);

    // The row's token/decimals/currency fields are the ACCOUNTING CONTEXT —
    // what the project is paid in — sourced from the primary terminal. The
    // project's own ERC-20 is a different token and must not fill them.
    const primaryTerminal = terminals[0];
    const context = primaryTerminal
      ? await client
          .readContract({
            address: primaryTerminal,
            abi: jbMultiTerminalAbi,
            functionName: "accountingContextsOf",
            args: [id],
          })
          .then((contexts) => contexts[0] ?? null)
          .catch(() => null)
      : null;

    const metadataUri =
      controller === zeroAddress
        ? null
        : await client
            .readContract({
              address: controller,
              abi: jbControllerAbi,
              functionName: "uriOf",
              args: [id],
            })
            .catch(() => null);

    const [metadata, tokenSymbol] = await Promise.all([
      fetchIpfsMetadata(metadataUri || null),
      !context
        ? null
        : context.token.toLowerCase() === NATIVE_TOKEN.toLowerCase()
          ? "ETH"
          : client
              .readContract({ address: context.token, abi: erc20Abi, functionName: "symbol" })
              .catch(() => null),
    ]);

    let revOwner: string | null = null;
    try {
      revOwner = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, chainId);
    } catch {
      // No REVOwner deployment known for this chain.
    }

    return {
      projectId,
      metadataUri: metadataUri || null,
      handle: null,
      createdAt: 0,
      suckerGroupId: "",
      logoUri: typeof metadata?.logoUri === "string" ? metadata.logoUri : null,
      name: typeof metadata?.name === "string" ? metadata.name : null,
      version: 6,
      token: context?.token ?? null,
      decimals: context?.decimals ?? null,
      currency: context ? Number(context.currency) : null,
      tokenSymbol: typeof tokenSymbol === "string" ? tokenSymbol : null,
      isRevnet: revOwner ? owner.toLowerCase() === revOwner.toLowerCase() : null,
    };
  },
);

/**
 * Resolve a project row for the page, preferring the indexed Bendystraw row
 * and falling back to on-chain data when the row is missing or incomplete.
 *
 * `degraded: true` signals that indexed data was unavailable so the page
 * should render with reduced stats and the observed availability reason.
 */
export const getProjectWithFallback = cache(
  async (
    projectId: number | bigint,
    chainId: JBChainId,
  ): Promise<{ project: ProjectRow; degraded: boolean; indexStatus: IndexedReadStatus } | null> => {
    const { data: indexed, status: indexStatus } = await getIndexedProject(
      Number(projectId),
      chainId,
    );
    if (indexed && indexStatus === "available")
      return { project: indexed, degraded: false, indexStatus };

    const fallback = await getOnchainProjectFallback(Number(projectId), chainId);
    if (!fallback) return null;

    if (!indexed) return { project: fallback, degraded: true, indexStatus };

    // Keep every indexed field that is populated; fill the gaps on-chain.
    const merged = { ...fallback } as Record<string, unknown>;
    for (const [key, value] of Object.entries(indexed)) {
      if (value !== null && value !== undefined) merged[key] = value;
    }
    return { project: merged as ProjectRow, degraded: true, indexStatus };
  },
);
