import {
  getJBContractAddress,
  JBChainId,
  JBCoreContracts,
  jbMultiTerminalAbi,
} from "@bananapus/nana-sdk-core";
import { buildBridgePrepareTx, cashOutProtocolFee } from "@bananapus/nana-sdk-core/v6";
import { Address, getAddress, isAddressEqual, PublicClient } from "viem";

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

/**
 * `JBMultiTerminal._cashOutTokensOf`'s standard 2.5% fee, from the SDK: taken
 * from the whole reclaim when the cash-out tax is nonzero, and only from the
 * fee-free-surplus portion otherwise.
 */
export { cashOutProtocolFee };

/** Derive a minimum output using floor rounding, and refuse a zero floor. */
export function protectedOutputFloor(amount: bigint, slippageBps: bigint) {
  if (amount <= 0n) throw new Error("The live quote has no backing to protect.");
  if (slippageBps < 0n || slippageBps >= BASIS_POINTS) {
    throw new Error("Slippage must be at least 0% and less than 100%.");
  }

  const floor = (amount * (BASIS_POINTS - slippageBps)) / BASIS_POINTS;
  if (floor <= 0n) throw new Error("The protected minimum rounds to zero.");
  return floor;
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
  {
    chainId,
    projectId,
    sucker,
    projectTokenCount,
    terminalToken,
    slippageBps,
  }: {
    chainId: JBChainId;
    projectId: bigint;
    sucker: Address;
    projectTokenCount: bigint;
    terminalToken: Address;
    slippageBps: bigint;
  },
): Promise<BridgePrepareQuote> {
  if (projectTokenCount <= 0n) throw new Error("Enter project tokens to move.");

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
    minTokensReclaimed: protectedOutputFloor(netReclaimAmount, slippageBps),
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
  if (minTokensReclaimed <= 0n) {
    throw new Error("A bridge movement must protect a nonzero backing-token minimum.");
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
