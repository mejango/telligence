import { RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import type { MultichainCall } from "@/lib/multichain-batch";
import type { JBChainId } from "@/lib/nana/types";
import { isStickyHook, stickyRecipientLabel } from "@/lib/sticky";
import {
  jbControllerAbi,
  jbDirectoryAbi,
  jbProjectsAbi,
  jbSplitsAbi,
  jbTokensAbi,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { buildAutoIssueTx } from "@bananapus/nana-sdk-core/v6";
import {
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  isAddress,
  toEventSelector,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export type DistributionProject = { chainId: JBChainId; projectId: bigint };
export type DistributionClient = Pick<
  PublicClient,
  "readContract" | "simulateContract" | "getBlock"
>;
type DistributionPrecondition = { address: Address; data: Hex; expected: Hex };
export type DistributionSnapshot = {
  id: string;
  chainId: JBChainId;
  projectId: bigint;
  amount: bigint;
  details: Array<{ label: string; value: string }>;
  call: MultichainCall & { preconditions: DistributionPrecondition[] };
};

export function distributionProjectKey(project: DistributionProject) {
  return `${project.chainId}:${project.projectId}`;
}

function requireAddress(value: Address, name: string): Address {
  if (!isAddress(value) || value.toLowerCase() === zeroAddress)
    throw new Error(`${name} is unavailable. Reload and try again.`);
  return value;
}

/** Encoded read results remain usable after reload and at every wallet boundary. */
function recordedReads(client: DistributionClient, preconditions: DistributionPrecondition[]) {
  return async <T>(
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ) => {
    const result = await client.readContract({ address, abi, functionName, args });
    preconditions.push({
      address,
      data: encodeFunctionData({ abi, functionName, args }),
      expected: encodeFunctionResult({ abi, functionName, result }),
    });
    return result as T;
  };
}

type DistributionIdentity = DistributionProject & { directory: Address; projects: Address };
type ReservedSplit = {
  percent: number;
  projectId: bigint;
  beneficiary: Address;
  preferAddToBalance: boolean;
  lockedUntil: number;
  hook: Address;
};

export async function prepareReservedDistribution(
  client: DistributionClient,
  identity: DistributionIdentity,
  account: Address,
): Promise<DistributionSnapshot> {
  const { chainId, projectId } = identity;
  const preconditions: DistributionPrecondition[] = [];
  const read = recordedReads(client, preconditions);
  const controller = requireAddress(
    await read<Address>(identity.directory, jbDirectoryAbi, "controllerOf", [projectId]),
    "The active controller",
  );
  const amount = await read<bigint>(controller, jbControllerAbi, "pendingReservedTokenBalanceOf", [
    projectId,
  ]);
  if (amount <= 0n) throw new Error(`There are no pending reserved tokens on chain ${chainId}.`);
  const [ruleset] = await read<readonly [{ id: bigint; cycleNumber: number }, unknown]>(
    controller,
    jbControllerAbi,
    "currentRulesetOf",
    [projectId],
  );
  const splitsAddress = requireAddress(
    await read<Address>(controller, jbControllerAbi, "SPLITS"),
    "The splits contract",
  );
  const splits = await read<readonly ReservedSplit[]>(splitsAddress, jbSplitsAbi, "splitsOf", [
    projectId,
    BigInt(ruleset.id),
    RESERVED_TOKEN_SPLIT_GROUP_ID,
  ]);
  const owner = await read<Address>(identity.projects, jbProjectsAbi, "ownerOf", [projectId]);
  const tokenRegistry = requireAddress(
    await read<Address>(controller, jbControllerAbi, "TOKENS"),
    "The token registry",
  );
  // Token deployment changes hook delivery from credits to an ERC-20 allowance.
  await read<Address>(tokenRegistry, jbTokensAbi, "tokenOf", [projectId]);
  const call: DistributionSnapshot["call"] = {
    chainId,
    address: controller,
    abi: jbControllerAbi,
    functionName: "sendReservedTokensToSplitsOf",
    args: [projectId],
    contractName: "JBController",
    preconditions,
    rejectEvents: ["ReservedDistributionReverted", "SplitHookReverted"].map((name) => ({
      address: controller,
      topic: toEventSelector(
        getAbiItem({
          abi: jbControllerAbi,
          name: name as "ReservedDistributionReverted" | "SplitHookReverted",
        }),
      ),
    })),
    // The reviewed count and splits the receipt is checked against (verifyActionReceipt). Kept
    // JSON-safe, since the journal saves it with the submitted call.
    reservedReceipt: {
      controller,
      tokens: tokenRegistry,
      projectId: String(projectId),
      rulesetId: String(ruleset.id),
      cycleNumber: String(ruleset.cycleNumber),
      owner,
      caller: account,
      tokenCount: String(amount),
      splits: splits.map((split) => ({
        percent: Number(split.percent),
        projectId: String(split.projectId),
        beneficiary: split.beneficiary,
        preferAddToBalance: split.preferAddToBalance,
        lockedUntil: Number(split.lockedUntil),
        hook: split.hook,
      })),
    },
  };
  await client.simulateContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    account,
  });
  return {
    id: distributionProjectKey(identity),
    chainId,
    projectId,
    amount,
    call,
    details: [
      { label: "Current ruleset", value: String(ruleset.id) },
      ...splits.map((split, index) => ({
        label: `Recipient ${index + 1}`,
        value: `${Number(split.percent) / 10_000_000}% → ${isStickyHook(split.hook, identity.chainId) ? stickyRecipientLabel(split, split.beneficiary) : split.hook !== zeroAddress ? `hook ${split.hook}` : split.projectId > 0n ? `project ${split.projectId} (${split.beneficiary === zeroAddress ? account : split.beneficiary})` : split.beneficiary === zeroAddress ? account : split.beneficiary}`,
      })),
      { label: "Remainder recipient", value: owner },
    ],
  };
}

export type AutoIssuanceSelection = DistributionProject & { stageId: bigint; beneficiary: Address };

export function autoIssuanceKey(row: AutoIssuanceSelection) {
  return `${distributionProjectKey(row)}:${row.stageId}:${row.beneficiary.toLowerCase()}`;
}

export async function prepareAutoIssuance(
  client: DistributionClient,
  identity: AutoIssuanceSelection & { directory: Address; projects: Address },
  account: Address,
): Promise<DistributionSnapshot> {
  const { chainId, projectId, stageId, beneficiary } = identity;
  const tx = buildAutoIssueTx({ chainId, revnetId: projectId, stageId, beneficiary });
  const preconditions: DistributionPrecondition[] = [];
  const read = recordedReads(client, preconditions);
  const owner = await read<Address>(identity.projects, jbProjectsAbi, "ownerOf", [projectId]);
  if (owner.toLowerCase() !== tx.address.toLowerCase())
    throw new Error(
      `Project ${projectId} is no longer owned by this revnet contract on chain ${chainId}.`,
    );
  const controller = requireAddress(
    await read<Address>(identity.directory, jbDirectoryAbi, "controllerOf", [projectId]),
    "The active controller",
  );
  const revnetController = await read<Address>(tx.address, revOwnerAbi, "CONTROLLER");
  if (revnetController.toLowerCase() !== controller.toLowerCase())
    throw new Error(`The revnet controller changed on chain ${chainId}.`);
  const [ruleset] = await read<readonly [{ id: bigint; start: bigint }, unknown]>(
    controller,
    jbControllerAbi,
    "getRulesetOf",
    [projectId, stageId],
  );
  if (BigInt(ruleset.id) !== stageId || stageId === 0n)
    throw new Error(`The selected stage is unavailable on chain ${chainId}.`);
  const block = await client.getBlock({ blockTag: "latest" });
  if (BigInt(ruleset.start) > block.timestamp)
    throw new Error(`This auto issuance is still locked on chain ${chainId}.`);
  const amount = await read<bigint>(tx.address, revOwnerAbi, "amountToAutoIssue", [
    projectId,
    stageId,
    beneficiary,
  ]);
  if (amount <= 0n)
    throw new Error(`This allocation has already been distributed on chain ${chainId}.`);
  const call: DistributionSnapshot["call"] = {
    ...tx,
    abi: tx.abi as Abi,
    contractName: "REVOwner",
    preconditions,
  };
  await client.simulateContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    account,
  });
  return {
    id: autoIssuanceKey(identity),
    chainId,
    projectId,
    amount,
    call,
    details: [
      { label: "Stage ID", value: String(stageId) },
      { label: "To", value: beneficiary },
    ],
  };
}
