import { REVNET_CASHOUT_FEE_PERCENT } from "@/app/constants";
import { cashOutProtocolFee } from "@/lib/bridgePrepare";
export { netLoanProceeds } from "@bananapus/nana-sdk-core/v6/loan-math";

// REVLoans.sol:1339-1343 rejects prepaid fee percents outside this range. Both are permil:
// the denominator is JBConstants.MAX_FEE = 1000 (REVLoansSourceFees.sol:47-53), not basis
// points.
const MIN_PREPAID_FEE_PERMIL = 25; // REVLoans.MIN_PREPAID_FEE_PERCENT, 2.5%
const MAX_PREPAID_FEE_PERMIL = 500; // REVLoans.MAX_PREPAID_FEE_PERCENT, 50%
// `JBConstants.MAX_FEE`. Kept as a number because this chart is float math; the
// SDK exports the same value as a bigint (`v6/fees.MAX_FEE`).
const MAX_FEE = 1000;
const MAX_PREPAYMENT_MONTHS = 120;

export function generateFeeData({
  grossBorrowedEth,
  prepaidPercent,
}: {
  grossBorrowedEth: number;
  prepaidPercent: string;
}) {
  // Safety check for invalid inputs
  if (!grossBorrowedEth || grossBorrowedEth <= 0 || isNaN(grossBorrowedEth)) {
    return [
      { year: 0, totalCost: 0 },
      { year: 10, totalCost: 0 },
    ];
  }

  const MAX_YEARS = 10;

  // The tx path sends `round(prepaidPercent * 10)` permil (useBorrowDialog.tsx), and the
  // contract clamps the legal range, so the chart models the same value the loan will carry.
  const feePermil = Math.min(
    Math.max(Math.round(parseFloat(prepaidPercent) * 10), MIN_PREPAID_FEE_PERMIL),
    MAX_PREPAID_FEE_PERMIL,
  );

  // REVLoans.sol:1367-1368 — the prepaid window is the fee's share of the max, scaled over
  // the 10-year liquidation duration.
  const monthsToPrepay = (feePermil / MAX_PREPAID_FEE_PERMIL) * MAX_PREPAYMENT_MONTHS;
  const prepaidDuration = monthsToPrepay / 12;

  // Prepaid fee is applied to the gross borrowed amount, out of MAX_FEE = 1000
  // (JBFees.feeAmountFrom).
  const prepaidFee = (grossBorrowedEth * feePermil) / MAX_FEE;

  // Amount user must repay to unlock collateral (the full borrowed amount)
  const borrowedAmount = grossBorrowedEth;

  // The ramp base is the BORROWED amount less the prepaid fee — not the amount the user
  // receives. `REVLoansSourceFees.sourceFeeAmountFrom` ramps over `loan.amount - prepaid`
  // (:43-53) and never subtracts the 3.5% fixed fee, which is taken from the payout at
  // origination and is not part of the loan balance. Subtracting it here understated the max
  // unlock cost by ~3.5% at the chart's right edge.
  const decayingPortion = borrowedAmount - prepaidFee;

  const data = [];

  // Generate data points every 0.25 years, but ensure we reach exactly 10 years
  for (let year = 0; year < MAX_YEARS; year += 0.25) {
    let variableFee = 0;

    if (year > prepaidDuration && year <= MAX_YEARS) {
      const elapsedAfterPrepaid = year - prepaidDuration;
      const remainingTime = MAX_YEARS - prepaidDuration;
      // Safety check for division by zero
      const percentElapsed = remainingTime > 0 ? elapsedAfterPrepaid / remainingTime : 0;
      variableFee = decayingPortion * percentElapsed;
    } else if (year > MAX_YEARS) {
      variableFee = decayingPortion;
    }

    const clampedVariableFee = Math.min(variableFee, decayingPortion);

    // Total cost to unlock = full borrowed amount + variable fees
    // (Fixed fees and prepaid fees are already "paid" by receiving less)
    const totalCostToUnlock = borrowedAmount + clampedVariableFee;

    data.push({ year, totalCost: totalCostToUnlock });
  }

  // Add the final point at exactly 10 years with maximum value
  const maxVariableFee = decayingPortion;
  const maxCostToUnlock = borrowedAmount + maxVariableFee;
  data.push({ year: MAX_YEARS, totalCost: maxCostToUnlock });

  return data;
}

export function applyRevFee(tokenAmount: bigint) {
  return (tokenAmount * BigInt((1 - REVNET_CASHOUT_FEE_PERCENT) * 1000)) / 1000n;
}

/**
 * Whether a cash-out actually pays the revnet fee.
 *
 * REVOwner is what charges it, so a plain project never does; and REVOwner skips it entirely
 * when the cash-out tax is zero — "Zero-tax ordinary cash-outs do not add the revnet fee
 * hook" (REVOwner.sol:303). Quoting the fee unconditionally under-reports every zero-tax
 * revnet and every non-revnet by 2.5%. Undefined inputs mean "still loading": suppress the
 * fee rather than guess, since a quote that is too HIGH is the safer error for a holder
 * deciding whether to cash out.
 */
export function revFeeApplies(
  isRevnet: boolean | undefined,
  cashOutTaxRate: bigint | undefined,
): boolean {
  return isRevnet === true && cashOutTaxRate !== undefined && cashOutTaxRate !== 0n;
}

/**
 * The flat 2.5% protocol fee with the contract's floor division:
 * `amount - amount / 40`. Used where the ruleset's cash-out tax is unknown.
 */
export function applyNanaFee(reclaimableAmount: bigint) {
  return reclaimableAmount - reclaimableAmount / 40n;
}

/**
 * Net cash-out value after the protocol fee, mirroring
 * `JBMultiTerminal._cashOutTokensOf`: a nonzero cash-out tax makes the whole
 * reclaim feeable; a zero tax charges the fee only up to `feeFreeSurplusOf`.
 */
export function netCashOutValue({
  reclaimAmount,
  cashOutTaxRate,
  feeFreeSurplus,
}: {
  reclaimAmount: bigint;
  cashOutTaxRate: bigint;
  feeFreeSurplus: bigint;
}) {
  const fee = cashOutProtocolFee({
    reclaimAmount,
    cashOutTaxRate,
    beneficiaryIsFeeless: false,
    feeFreeSurplus,
  });
  return reclaimAmount - fee;
}
