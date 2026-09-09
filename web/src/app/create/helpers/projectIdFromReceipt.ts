import {
  getJBContractAddress,
  JBChainId,
  JBCoreContracts,
  revDeployerAbi,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { getAbiItem, toEventSelector, type AbiEvent } from "viem";

const DEPLOY_REVNET_TOPIC = toEventSelector(
  getAbiItem({ abi: revDeployerAbi, name: "DeployRevnet" }) as AbiEvent,
);
const ERC721_TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
const ZERO_WORD = `0x${"0".repeat(64)}`;

type ReceiptLog = {
  address: string;
  topics: readonly string[];
};

function jbAddress(
  contract: JBCoreContracts.JBProjects | RevnetCoreContracts.REVDeployer,
  chainId: JBChainId,
): string | undefined {
  try {
    return getJBContractAddress(contract, 6, chainId).toLowerCase();
  } catch {
    return undefined;
  }
}

function asProjectId(word: string | undefined): number | undefined {
  if (!word) return undefined;
  try {
    const id = Number(BigInt(word));
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract the deployed project id from a deployment receipt's logs.
 *
 * Works for both a direct `REVDeployer.deployFor` receipt and a Relayr
 * forwarder receipt: the relevant log can sit at any index, so every log is
 * scanned and filtered by emitting address and event signature. Prefers the
 * REVDeployer `DeployRevnet` event (indexed `revnetId`), and falls back to the
 * JBProjects ERC-721 mint (`Transfer` with `from == 0x0`, `tokenId` topic).
 */
export function projectIdFromDeployLogs(
  logs: readonly ReceiptLog[],
  chainId: JBChainId,
): number | undefined {
  const revDeployer = jbAddress(RevnetCoreContracts.REVDeployer, chainId);
  for (const log of logs) {
    if (
      log.topics[0]?.toLowerCase() === DEPLOY_REVNET_TOPIC &&
      log.address.toLowerCase() === revDeployer
    ) {
      const id = asProjectId(log.topics[1]);
      if (id) return id;
    }
  }

  const jbProjects = jbAddress(JBCoreContracts.JBProjects, chainId);
  for (const log of logs) {
    if (
      log.address.toLowerCase() === jbProjects &&
      log.topics[0]?.toLowerCase() === ERC721_TRANSFER_TOPIC &&
      log.topics[1] === ZERO_WORD
    ) {
      const id = asProjectId(log.topics[3]);
      if (id) return id;
    }
  }

  return undefined;
}
