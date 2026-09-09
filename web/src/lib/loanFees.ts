// `JBConstants.MAX_FEE` (1000), the permil denominator REVLoans fees use — NOT
// the root export's `MAX_FEE_PER_BILLION`.
import { MAX_FEE } from "@bananapus/nana-sdk-core/v6";

export const LOAN_LIQUIDATION_DURATION = 3_650 * 24 * 60 * 60;

/**
 * Exact mirror of REVLoansSourceFees.sourceFeeAmountFrom for repaying all
 * outstanding principal. The fee is zero through the prepaid window, then
 * ramps linearly until the ten-year liquidation boundary.
 */
export function currentOutstandingLoanFee({
  amount,
  prepaidFeePercent,
  prepaidDuration,
  createdAt,
  now,
}: {
  amount: bigint;
  prepaidFeePercent: number;
  prepaidDuration: number;
  createdAt: number;
  now: number;
}): bigint | null {
  const elapsed = Math.max(0, now - createdAt);
  if (elapsed <= prepaidDuration) return 0n;
  if (elapsed > LOAN_LIQUIDATION_DURATION) return null;

  const prepaid = (amount * BigInt(prepaidFeePercent)) / MAX_FEE;
  const feePercent =
    (BigInt(elapsed - prepaidDuration) * MAX_FEE) /
    BigInt(LOAN_LIQUIDATION_DURATION - prepaidDuration);
  return ((amount - prepaid) * feePercent) / MAX_FEE;
}

/**
 * How much `repayLoan` may pull, as its `maxRepayBorrowAmount` argument.
 *
 * The contract adds the accrued source fee ON TOP of the principal and reverts when the sum exceeds
 * this ceiling (REVLoans.sol:984-987, :1004-1008), so the principal alone is not a ceiling once the
 * prepaid window lapses — it is the one value guaranteed to be too small. The fee also keeps accruing
 * between quoting and inclusion, so add a buffer: the ramp reaches 100% over the ten-year liquidation
 * window, which makes a 0.1% slice of principal worth roughly 3.6 days of accrual. Anything unused is
 * refunded (REVLoans.sol:1023-1031), so overshooting only costs balance and allowance headroom.
 */
export function repayCeilingFor(principal: bigint, accruedSourceFee: bigint): bigint {
  return principal + accruedSourceFee + principal / 1_000n;
}

/**
 * The principal a repay will actually pay off, mirroring `REVLoans.repayLoan`.
 *
 * The contract re-values the collateral being KEPT and repays the difference:
 *   `newBorrowAmount = borrowableAmountFrom(revnetId, collateral - returned).capacity`
 *   `repayBorrowAmount = loan.amount - newBorrowAmount`      (REVLoans.sol:951-970)
 * Zero remaining capacity is treated as a full repay, and all collateral is returned (:957-960).
 *
 * Deriving this from chain views rather than from a `repayLoan` simulation is what lets the
 * ceiling be scaled to a PARTIAL repay: the simulation takes the ceiling as an input, so
 * reading the amount back out of it is circular.
 */
export function repayPrincipalFor(loanAmount: bigint, remainingBorrowCapacity: bigint): bigint {
  if (remainingBorrowCapacity === 0n) return loanAmount;
  if (remainingBorrowCapacity >= loanAmount) return 0n;
  return loanAmount - remainingBorrowCapacity;
}
