import {
  getJBContractAddress,
  JBChainId,
  JBCoreContracts,
  jbMultiTerminalAbi,
} from "@bananapus/nana-sdk-core";
import {
  buildBridgePrepareTx,
  cashOutProtocolFee,
  getV6SuckerPairs,
  jbSuckerV6ViewAbi,
  suckerBytes32ToAddress,
  verifySuckerDestinationMint,
} from "@bananapus/nana-sdk-core/v6";
import { Address, getAddress, Hex, isAddressEqual, PublicClient } from "viem";

const BASIS_POINTS = 10_000n;

const feelessAddressesAbi = [
  {
    type: "function",
    name: "isFeelessFor",
    stateMutability: "view",
    inputs: [
      { name: "addr", type: "address" },
      { name: "projectId", type: "uint256" },
      { name: "caller", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface BridgePrepareQuote {
  grossReclaimAmount: bigint;
  netReclaimAmount: bigint;
  minTokensReclaimed: bigint;
  tokenDecimals: number;
}

interface BridgePrepareRoute {
  chainId: JBChainId;
  projectId: bigint;
  sucker: Address;
  projectTokenCount: bigint;
  beneficiary: Address;
  destinationClient: PublicClient;
  destinationChainId: JBChainId;
  destinationProjectId: bigint;
  destinationSucker: Hex;
}

/** Verify the selected registered peer can mint this exact transfer now. */
export async function verifyBridgePrepareDestination(
  client: PublicClient,
  args: BridgePrepareRoute,
) {
  if ((await client.getChainId()) !== args.chainId) {
    throw new Error("The source RPC is connected to a different network. Nothing was submitted.");
  }
  const pair = (await getV6SuckerPairs(client, args)).find(
    (candidate) =>
      isAddressEqual(candidate.local, args.sucker) &&
      candidate.remoteChainId === BigInt(args.destinationChainId) &&
      isAddressEqual(candidate.remote, suckerBytes32ToAddress(args.destinationSucker)),
  );
  if (!pair) throw new Error("The bridge route changed. Review the transfer again.");

  const projectId = await args.destinationClient.readContract({
    address: pair.remote,
    abi: jbSuckerV6ViewAbi,
    functionName: "projectId",
  });
  if (projectId !== args.destinationProjectId) {
    throw new Error("The destination project changed. Review the transfer again.");
  }
  const destinationPairs = await getV6SuckerPairs(args.destinationClient, {
    chainId: args.destinationChainId,
    projectId,
  });
  if (
    !destinationPairs.some(
      (candidate) =>
        isAddressEqual(candidate.local, pair.remote) &&
        isAddressEqual(candidate.remote, args.sucker) &&
        candidate.remoteChainId === BigInt(args.chainId),
    )
  ) {
    throw new Error("The destination bridge no longer matches this transfer.");
  }
  await verifySuckerDestinationMint(args.destinationClient, {
    chainId: args.destinationChainId,
    projectId,
    sucker: pair.remote,
    beneficiary: args.beneficiary,
    tokenCount: args.projectTokenCount,
  });
}

/**
 * `JBMultiTerminal._cashOutTokensOf`'s standard 2.5% fee, from the SDK: taken
 * from the whole reclaim when the cash-out tax is nonzero, and only from the
 * fee-free-surplus portion otherwise.
 */
export { cashOutProtocolFee };

function floorAfterSlippage(amount: bigint, slippageBps: bigint) {
  if (slippageBps < 0n || slippageBps >= BASIS_POINTS) {
    throw new Error("Slippage must be at least 0% and less than 100%.");
  }
  return (amount * (BASIS_POINTS - slippageBps)) / BASIS_POINTS;
}

/** Derive a minimum output using floor rounding, and refuse a zero floor. */
export function protectedOutputFloor(amount: bigint, slippageBps: bigint) {
  if (amount <= 0n) throw new Error("The live quote has no backing to protect.");
  const floor = floorAfterSlippage(amount, slippageBps);
  if (floor <= 0n) throw new Error("The protected minimum rounds to zero.");
  return floor;
}

/**
 * A move's minimum. A chain with no surplus still moves the tokens, with no backing, because
 * `JBSucker.prepare` burns them here and mints the same count on the peer whatever is reclaimed.
 * Any real quote keeps a nonzero minimum, so it is never sent unprotected.
 */
export function bridgeReclaimMinimum(amount: bigint, slippageBps: bigint) {
  const floor = floorAfterSlippage(amount, slippageBps);
  return amount > 0n && floor === 0n ? 1n : floor;
}

/** Parse a user-entered percentage without allowing unsafe or ambiguous input. */
export function slippagePercentToBps(percent: string) {
  if (!/^\d+(?:\.\d{0,2})?$/u.test(percent)) {
    throw new Error("Enter slippage as a percentage with at most two decimal places.");
  }
  const [whole, fraction = ""] = percent.split(".");
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (bps > 500n) throw new Error("Slippage cannot exceed 5%.");
  return bps;
}

/**
 * Read the exact source-chain cash-out context used by `JBSucker.prepare`.
 * The caller is set to the sucker so caller-aware feeless hooks see the same
 * context they will see in the transaction.
 */
export async function quoteBridgePrepare(
  client: PublicClient,
  args: BridgePrepareRoute & {
    terminalToken: Address;
    slippageBps: bigint;
  },
): Promise<BridgePrepareQuote> {
  const { chainId, projectId, sucker, projectTokenCount, terminalToken, slippageBps } = args;
  if (projectTokenCount <= 0n) throw new Error("Enter project tokens to move.");
  await verifyBridgePrepareDestination(client, args);

  const terminal = getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId);
  const [preview, feeFreeSurplus, feelessAddresses, accountingContext] = await Promise.all([
    client.readContract({
      account: sucker,
      address: terminal,
      abi: jbMultiTerminalAbi,
      functionName: "previewCashOutFrom",
      args: [sucker, projectId, projectTokenCount, terminalToken, sucker, "0x"],
    }),
    client.readContract({
      address: terminal,
      abi: jbMultiTerminalAbi,
      functionName: "feeFreeSurplusOf",
      args: [projectId, terminalToken],
    }),
    client.readContract({
      address: terminal,
      abi: jbMultiTerminalAbi,
      functionName: "FEELESS_ADDRESSES",
    }),
    client.readContract({
      address: terminal,
      abi: jbMultiTerminalAbi,
      functionName: "accountingContextForTokenOf",
      args: [projectId, terminalToken],
    }),
  ]);

  if (!isAddressEqual(accountingContext.token, terminalToken)) {
    throw new Error("The selected backing token is not accepted by this project.");
  }

  const beneficiaryIsFeeless = await client.readContract({
    address: feelessAddresses,
    abi: feelessAddressesAbi,
    functionName: "isFeelessFor",
    args: [sucker, projectId, sucker],
  });

  const grossReclaimAmount = preview[1];
  const protocolFee = cashOutProtocolFee({
    reclaimAmount: grossReclaimAmount,
    cashOutTaxRate: preview[2],
    beneficiaryIsFeeless,
    feeFreeSurplus,
  });
  const netReclaimAmount = grossReclaimAmount - protocolFee;

  return {
    grossReclaimAmount,
    netReclaimAmount,
    minTokensReclaimed: bridgeReclaimMinimum(netReclaimAmount, slippageBps),
    tokenDecimals: accountingContext.decimals,
  };
}

export function buildProtectedBridgePrepareTx({
  chainId,
  sucker,
  projectTokenCount,
  beneficiary,
  minTokensReclaimed,
  token,
}: {
  chainId: JBChainId;
  sucker: Address;
  projectTokenCount: bigint;
  beneficiary: Address;
  minTokensReclaimed: bigint;
  token: Address;
}) {
  if (projectTokenCount <= 0n) throw new Error("A bridge movement must include project tokens.");
  if (minTokensReclaimed < 0n) {
    throw new Error("A bridge movement's minimum cannot be negative.");
  }

  return buildBridgePrepareTx({
    chainId,
    sucker: getAddress(sucker),
    projectTokenCount,
    beneficiary: getAddress(beneficiary),
    minTokensReclaimed,
    token: getAddress(token),
  });
}
