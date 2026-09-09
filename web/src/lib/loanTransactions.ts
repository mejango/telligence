import { getRevnetLoanContract, JBChainId, revLoansAbi } from "@bananapus/nana-sdk-core";
import { buildBorrowTx, buildReallocateCollateralTx } from "@bananapus/nana-sdk-core/v6";
import { Address, getAddress, PublicClient } from "viem";
import { protectedOutputFloor } from "./bridgePrepare";

const DEFAULT_BORROW_SLIPPAGE_BPS = 100n;

export async function readFreshBorrowableAmount(
  client: PublicClient,
  {
    chainId,
    revnetId,
    collateralCount,
    decimals,
    currency,
  }: {
    chainId: JBChainId;
    revnetId: bigint;
    collateralCount: bigint;
    decimals: bigint;
    currency: bigint;
  },
) {
  if (collateralCount <= 0n) throw new Error("A loan must include collateral.");

  const quote = await client.readContract({
    address: getRevnetLoanContract(6, chainId),
    abi: revLoansAbi,
    functionName: "borrowableAmountFrom",
    args: [revnetId, collateralCount, decimals, currency],
  });
  const borrowableNow = quote[0];
  if (borrowableNow <= 0n) {
    throw new Error("Nothing is currently borrowable for this collateral and source token.");
  }
  return borrowableNow;
}

export function minimumBorrowAmount(
  borrowableAmount: bigint,
  slippageBps = DEFAULT_BORROW_SLIPPAGE_BPS,
) {
  return protectedOutputFloor(borrowableAmount, slippageBps);
}

export function buildProtectedBorrowTx({
  chainId,
  revnetId,
  token,
  quotedBorrowAmount,
  collateralCount,
  beneficiary,
  prepaidFeePercent,
  holder,
}: {
  chainId: JBChainId;
  revnetId: bigint;
  token: Address;
  quotedBorrowAmount: bigint;
  collateralCount: bigint;
  beneficiary: Address;
  prepaidFeePercent: bigint;
  holder: Address;
}) {
  const minBorrowAmount = minimumBorrowAmount(quotedBorrowAmount);
  return buildBorrowTx({
    chainId,
    revnetId,
    token: getAddress(token),
    minBorrowAmount,
    collateralCount,
    beneficiary: getAddress(beneficiary),
    prepaidFeePercent,
    holder: getAddress(holder),
  });
}

export function buildProtectedReallocateCollateralTx({
  chainId,
  loanId,
  collateralCountToTransfer,
  token,
  quotedBorrowAmount,
  collateralCountToAdd,
  beneficiary,
  prepaidFeePercent,
}: {
  chainId: JBChainId;
  loanId: bigint;
  collateralCountToTransfer: bigint;
  token: Address;
  quotedBorrowAmount: bigint;
  collateralCountToAdd: bigint;
  beneficiary: Address;
  prepaidFeePercent: bigint;
}) {
  if (collateralCountToTransfer < 0n || collateralCountToAdd < 0n) {
    throw new Error("Loan collateral counts cannot be negative.");
  }
  if (collateralCountToTransfer + collateralCountToAdd <= 0n) {
    throw new Error("The new loan must include collateral.");
  }

  const minBorrowAmount = minimumBorrowAmount(quotedBorrowAmount);
  return buildReallocateCollateralTx({
    chainId,
    loanId,
    collateralCountToTransfer,
    token: getAddress(token),
    minBorrowAmount,
    collateralCountToAdd,
    beneficiary: getAddress(beneficiary),
    prepaidFeePercent,
  });
}
