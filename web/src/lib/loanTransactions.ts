import {
  getRevnetLoanContract,
  JBChainId,
  jbMultiTerminalAbi,
  revLoansAbi,
} from "@bananapus/nana-sdk-core";
import { buildBorrowTx, buildReallocateCollateralTx } from "@bananapus/nana-sdk-core/v6";
import { Address, getAddress, isAddressEqual, PublicClient } from "viem";
import { protectedOutputFloor } from "./bridgePrepare";

const DEFAULT_BORROW_SLIPPAGE_BPS = 100n;

/** What REVLoans prices a loan in: the revnet, its source token and that token's accounting context. */
export const LOAN_SOURCE_UNREADABLE = "Couldn't read this network's loan token onchain. Try again.";
export const LOAN_SOURCE_CHANGED =
  "This network's loan token changed. Check the terms and confirm again.";

/** `REVLoans._generateLoanId`: a loan id is `revnetId * 1e18 + loanNumber`. */
export function loanNumberOf(loanId: bigint | number | string): bigint {
  return BigInt(loanId) % 10n ** 18n;
}

export type LoanSource = { revnetId: bigint; token: Address; decimals: number; currency: number };

/**
 * Reads the loan source as REVLoans does: the context its `TERMINAL` returns from
 * `accountingContextForTokenOf(revnetId, token)`, which the contract requires to name the
 * token. An existing loan fixes the revnet (`revnetIdOfLoanWith`) and the token
 * (`loanOf(...).sourceToken`). A new loan takes `preferredToken` when the revnet accounts
 * for it, else the revnet's first accounting context. Any failed or mismatched read throws:
 * never a default token, decimal or currency.
 */
export async function readLoanSource(
  client: PublicClient,
  {
    chainId,
    revnetId,
    loanId,
    preferredToken,
  }: { chainId: JBChainId; revnetId: bigint; loanId?: bigint; preferredToken?: Address },
): Promise<LoanSource> {
  const loans = getRevnetLoanContract(6, chainId);
  const terminal = await client.readContract({
    address: loans,
    abi: revLoansAbi,
    functionName: "TERMINAL",
  });
  let token: Address;
  if (loanId !== undefined) {
    const [loanRevnetId, loan] = await Promise.all([
      client.readContract({
        address: loans,
        abi: revLoansAbi,
        functionName: "revnetIdOfLoanWith",
        args: [loanId],
      }),
      client.readContract({
        address: loans,
        abi: revLoansAbi,
        functionName: "loanOf",
        args: [loanId],
      }),
    ]);
    revnetId = loanRevnetId;
    token = loan.sourceToken;
  } else {
    const contexts = await client.readContract({
      address: terminal,
      abi: jbMultiTerminalAbi,
      functionName: "accountingContextsOf",
      args: [revnetId],
    });
    const context =
      (preferredToken && contexts.find((c) => isAddressEqual(c.token, preferredToken))) ||
      contexts[0];
    if (!context) throw new Error("This revnet has no loan token on this network.");
    token = context.token;
  }
  const context = await client.readContract({
    address: terminal,
    abi: jbMultiTerminalAbi,
    functionName: "accountingContextForTokenOf",
    args: [revnetId, token],
  });
  if (!isAddressEqual(context.token, token)) {
    throw new Error("The revnet doesn't account for this loan token on this network.");
  }
  return {
    revnetId,
    token: getAddress(token),
    decimals: Number(context.decimals),
    currency: Number(context.currency),
  };
}

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

/** Whether two reads of a loan source agree on everything a loan is priced and sent in. */
export const sameLoanSource = (a: LoanSource, b: LoanSource) =>
  a.revnetId === b.revnetId &&
  isAddressEqual(a.token, b.token) &&
  a.decimals === b.decimals &&
  a.currency === b.currency;
