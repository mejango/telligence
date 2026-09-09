import { getViemPublicClient } from "@/lib/wagmiTransports";
import { JBChainId, jbSuckerRegistryAbi } from "@bananapus/nana-sdk-core";
import {
  assertSuckerTransportValue,
  buildBridgeClaimTx,
  buildToRemoteTx,
  CCIP_SUCKER_TRANSPORT_VALUES,
  classifySuckerTransport,
  findSuckerTransportValue,
  getAccountingContexts,
  getAllV6SuckerPairs,
  getSuckerMovements,
  SUCKER_MERKLE_DEPTH,
  suckerAccountingContextKey,
  suckerBytes32ToAddress,
  v6Address,
  type JBLeafProof,
  type JBSuckerMovementStatus,
  type JBSuckerTransport,
} from "@bananapus/nana-sdk-core/v6";
import { Address, encodeFunctionData, Hex, PublicClient } from "viem";

/**
 * App row built from the SDK's root-verified sucker movements. Display-only
 * accounting context and timestamp fields remain local to revnet-money.
 */
type V6BridgeRowStatus = JBSuckerMovementStatus;

export interface V6BridgeRow {
  createdAt?: number;
  chainId: JBChainId;
  peerChainId: JBChainId;
  beneficiary: Address;
  beneficiary32: Hex;
  projectTokenCount: bigint;
  terminalTokenAmount: bigint;
  status: V6BridgeRowStatus;
  index: number;
  sourceSucker: Address;
  peerSucker: Address;
  metadata: Hex;
  /** SDK-verified 32-element sibling path, only for claimable movements. */
  proof: JBLeafProof | null;
  /** True for pending leaves not yet shipped by `toRemote`. */
  canExecute: boolean;
  token: Address;
  remoteToken: Address;
  tokenDecimals: number;
  infra: JBSuckerTransport;
}

/**
 * Reconstruct every cross-chain token movement for a v6 project group. The
 * SDK verifies event preimages, the complete outbox root, destination inbox,
 * executed leaves, and every claim proof before a row is returned.
 */
export async function fetchV6BridgeRows(
  chains: { chainId: JBChainId; projectId: bigint }[],
): Promise<V6BridgeRow[]> {
  const rows: V6BridgeRow[] = [];
  const projectIdByChain = new Map(
    chains.map(({ chainId, projectId }) => [Number(chainId), projectId]),
  );

  await Promise.all(
    chains.map(async ({ chainId, projectId }) => {
      const client = getViemPublicClient(chainId) as PublicClient;
      const [sourceContexts, pairs] = await Promise.all([
        getAccountingContexts(client, { chainId, projectId }),
        getAllV6SuckerPairs(client, { chainId, projectId }),
      ]);

      await Promise.all(
        pairs.map(async (pair) => {
          const peerChainId = Number(pair.remoteChainId) as JBChainId;
          const peerProjectId = projectIdByChain.get(Number(peerChainId));
          if (peerProjectId === undefined) return;

          const peerClient = getViemPublicClient(peerChainId) as PublicClient;
          const [infra, peerContexts] = await Promise.all([
            classifySuckerTransport(client, pair.local),
            getAccountingContexts(peerClient, {
              chainId: peerChainId,
              projectId: peerProjectId,
            }),
          ]);

          await Promise.all(
            sourceContexts.map(async (accountingContext) => {
              const token = accountingContext.token as Address;
              // A cleared historical mapping may be supplied only when one
              // destination accounting context has the same canonical asset
              // identity. A live mapping always wins and the SDK verifies an
              // override agrees with it.
              const candidates = peerContexts.filter(
                (candidate) =>
                  candidate.decimals === accountingContext.decimals &&
                  suckerAccountingContextKey(
                    candidate.token as Address,
                    peerChainId,
                    candidate.decimals,
                  ) === suckerAccountingContextKey(token, chainId, accountingContext.decimals),
              );
              const historicalRemoteToken =
                candidates.length === 1 ? (candidates[0].token as Address) : undefined;

              const movements = await getSuckerMovements(client, peerClient, {
                sourceSucker: pair.local,
                destinationSucker: pair.remote,
                sourceToken: token,
                remoteToken: historicalRemoteToken,
              });
              if (!movements.length) return;

              const remoteToken = movements[0].remoteToken;
              if (
                movements.some(
                  (movement) => movement.remoteToken.toLowerCase() !== remoteToken.toLowerCase(),
                )
              ) {
                throw new Error("The bridge returned inconsistent destination tokens.");
              }
              const peerContext = peerContexts.find(
                (candidate) =>
                  (candidate.token as Address).toLowerCase() === remoteToken.toLowerCase(),
              );
              if (!peerContext || peerContext.decimals !== accountingContext.decimals) {
                throw new Error(
                  "The bridge token mapping does not match a verified destination accounting context.",
                );
              }
              const blockTimestamps = new Map<bigint, number>();
              await Promise.all(
                [...new Set(movements.map(({ blockNumber }) => blockNumber))].map(
                  async (blockNumber) => {
                    const block = await client.getBlock({ blockNumber });
                    blockTimestamps.set(blockNumber, Number(block.timestamp));
                  },
                ),
              );

              for (const movement of movements) {
                const index = Number(movement.leaf.index);
                if (!Number.isSafeInteger(index)) {
                  throw new Error("The bridge leaf index is outside JavaScript's safe range.");
                }
                rows.push({
                  createdAt: blockTimestamps.get(movement.blockNumber),
                  chainId,
                  peerChainId,
                  beneficiary: suckerBytes32ToAddress(movement.leaf.beneficiary),
                  beneficiary32: movement.leaf.beneficiary,
                  projectTokenCount: movement.leaf.projectTokenCount,
                  terminalTokenAmount: movement.leaf.terminalTokenAmount,
                  status: movement.status,
                  index,
                  sourceSucker: pair.local,
                  peerSucker: pair.remote,
                  metadata: movement.leaf.metadata,
                  proof: movement.proof,
                  canExecute: movement.canExecute,
                  token,
                  remoteToken: movement.remoteToken,
                  tokenDecimals: accountingContext.decimals,
                  infra,
                });
              }
            }),
          );
        }),
      );
    }),
  );

  rows.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  return rows;
}

/** Build the destination-chain claim tx from an SDK-verified row. */
export function buildV6ClaimTxFromRow(row: V6BridgeRow) {
  if (row.status !== "claimable" || !row.proof || row.proof.length !== SUCKER_MERKLE_DEPTH) {
    throw new Error("Only claimable movements carry a verified proof.");
  }
  return buildBridgeClaimTx({
    chainId: row.peerChainId,
    sucker: row.peerSucker,
    claim: {
      token: row.remoteToken,
      leaf: {
        index: BigInt(row.index),
        beneficiary: row.beneficiary32,
        projectTokenCount: row.projectTokenCount,
        terminalTokenAmount: row.terminalTokenAmount,
        metadata: row.metadata,
      },
      proof: row.proof,
    },
  });
}

/**
 * Find an exact, simulation-verified native value for `toRemote`. Unknown
 * bridge families fail closed; a failed CCIP probe is never treated as native.
 */
export async function findToRemoteValue(
  chainId: JBChainId,
  sucker: Address,
  token: Address,
  account: Address | undefined,
): Promise<bigint | null> {
  if (!account) return null;
  const client = getViemPublicClient(chainId) as PublicClient;
  let baseFee: bigint;
  try {
    baseFee = await client.readContract({
      address: v6Address("JBSuckerRegistry", chainId),
      abi: jbSuckerRegistryAbi,
      functionName: "toRemoteFee",
    });
  } catch {
    return null;
  }

  const transport = await classifySuckerTransport(client, sucker);
  if (transport === "unknown") return null;
  const values =
    transport === "ccip"
      ? CCIP_SUCKER_TRANSPORT_VALUES.map((budget) => baseFee + budget)
      : [baseFee];
  const value = await findSuckerTransportValue(values, async (candidate) => {
    const request = buildToRemoteTx({
      chainId,
      sucker,
      token,
      value: candidate,
    });
    const data = encodeFunctionData({
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
    });
    return client.call({
      account,
      to: sucker,
      data,
      value: candidate,
      stateOverride: [{ address: account, balance: 10n ** 21n }],
    });
  });
  if (value === null) return null;
  assertSuckerTransportValue(transport, value, baseFee);
  return value;
}
