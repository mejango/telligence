import { projectIdFromDeployLogs } from "@/app/create/helpers/projectIdFromReceipt";
import { getJBContractAddress, JBCoreContracts, revDeployerAbi } from "@bananapus/nana-sdk-core";
import { getAbiItem, pad, toEventSelector, toHex, type AbiEvent } from "viem";
import { sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { SEPOLIA_REV_DEPLOYER } from "./fixtures/revnet";

const DEPLOY_REVNET_TOPIC = toEventSelector(
  getAbiItem({ abi: revDeployerAbi, name: "DeployRevnet" }) as AbiEvent,
);
const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");

const JB_PROJECTS = getJBContractAddress(JBCoreContracts.JBProjects, 6, sepolia.id);
const REV_DEPLOYER = SEPOLIA_REV_DEPLOYER as `0x${string}`;

const OTHER_CONTRACT = "0x00000000000000000000000000000000000000cc";
const SOME_ACCOUNT = "0x000000000000000000000000000000000000bEEF";

const word = (value: bigint | number) => pad(toHex(BigInt(value)), { size: 32 });
const addressWord = (address: string) => pad(address.toLowerCase() as `0x${string}`, { size: 32 });
const ZERO_WORD = word(0);

/** JBProjects ERC-721 mint: Transfer(from = 0x0, to, tokenId). */
const projectMintLog = (tokenId: number, emitter: string = JB_PROJECTS) => ({
  address: emitter,
  topics: [TRANSFER_TOPIC, ZERO_WORD, addressWord(REV_DEPLOYER), word(tokenId)],
  data: "0x",
});

/** REVDeployer DeployRevnet(revnetId indexed, ...). Data payload is irrelevant to topic parsing. */
const deployRevnetLog = (revnetId: number, emitter: string = REV_DEPLOYER) => ({
  address: emitter,
  topics: [DEPLOY_REVNET_TOPIC, word(revnetId)],
  data: "0x",
});

/** An unrelated ERC-20 style Transfer whose topics[1] is an address, not a project id. */
const erc20TransferLog = () => ({
  address: OTHER_CONTRACT,
  topics: [TRANSFER_TOPIC, addressWord(SOME_ACCOUNT), addressWord(REV_DEPLOYER), word(1)],
  data: "0x",
});

describe("projectIdFromDeployLogs", () => {
  it("decodes the project id from a direct deployFor receipt where logs[0] is the ERC-721 mint", () => {
    const logs = [projectMintLog(42), erc20TransferLog(), deployRevnetLog(42)];

    // Regression guard: the old implementation read logs[0].topics[1], the
    // Transfer `from` address, which is zero for a mint.
    expect(Number(logs[0].topics[1])).toBe(0);

    expect(projectIdFromDeployLogs(logs, sepolia.id)).toBe(42);
  });

  it("decodes the project id from a forwarder receipt with leading unrelated logs", () => {
    const logs = [
      erc20TransferLog(),
      erc20TransferLog(),
      projectMintLog(7),
      deployRevnetLog(7),
      erc20TransferLog(),
    ];

    // Regression guard: the old implementation would have read an
    // address-shaped topic as a garbage project id.
    expect(Number(logs[0].topics[1])).not.toBe(7);

    expect(projectIdFromDeployLogs(logs, sepolia.id)).toBe(7);
  });

  it("ignores a DeployRevnet-shaped log from the wrong emitter", () => {
    const logs = [deployRevnetLog(999, OTHER_CONTRACT), projectMintLog(7)];

    expect(projectIdFromDeployLogs(logs, sepolia.id)).toBe(7);
  });

  it("falls back to the JBProjects mint when no DeployRevnet log is present", () => {
    const logs = [
      // Decoy: a mint from an unrelated ERC-721 collection.
      projectMintLog(999, OTHER_CONTRACT),
      erc20TransferLog(),
      projectMintLog(12),
    ];

    expect(projectIdFromDeployLogs(logs, sepolia.id)).toBe(12);
  });

  it("ignores non-mint JBProjects transfers", () => {
    const handoff = {
      address: JB_PROJECTS,
      topics: [TRANSFER_TOPIC, addressWord(SOME_ACCOUNT), addressWord(REV_DEPLOYER), word(55)],
      data: "0x",
    };

    expect(projectIdFromDeployLogs([erc20TransferLog(), handoff], sepolia.id)).toBeUndefined();
  });

  it("returns undefined when no relevant log exists", () => {
    expect(projectIdFromDeployLogs([erc20TransferLog()], sepolia.id)).toBeUndefined();
    expect(projectIdFromDeployLogs([], sepolia.id)).toBeUndefined();
  });
});
