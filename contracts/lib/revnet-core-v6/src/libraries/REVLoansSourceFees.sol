// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBFees} from "@bananapus/core-v6/src/libraries/JBFees.sol";
import {mulDiv} from "@prb/math/src/Common.sol";

import {REVLoan} from "../structs/REVLoan.sol";

/// @notice Source-fee arithmetic for REV loans.
library REVLoansSourceFees {
    /// @notice Thrown when computing the source fee for a loan whose elapsed time exceeds the liquidation duration.
    error REVLoans_LoanExpired(uint256 timeSinceLoanCreated, uint256 loanLiquidationDuration);

    /// @notice Determines the source fee amount for a loan when paying off a certain amount.
    /// @param loan The loan to determine the source fee for.
    /// @param amount The amount of principal being paid off.
    /// @param timeSinceLoanCreated The elapsed time since the loan was created.
    /// @param loanLiquidationDuration The duration after which loans are expired.
    /// @return sourceFeeAmount The source fee amount for the repayment.
    function sourceFeeAmountFrom(
        REVLoan memory loan,
        uint256 amount,
        uint256 timeSinceLoanCreated,
        uint256 loanLiquidationDuration
    )
        internal
        pure
        returns (uint256 sourceFeeAmount)
    {
        // Inside the prepaid window, the borrower already paid the source fee up front.
        if (timeSinceLoanCreated <= loan.prepaidDuration) return 0;

        // Expired loans cannot be managed through repay/reallocate paths. Uses `>` so the exact boundary second is
        // still repayable, matching the liquidation path's `<=` check.
        if (timeSinceLoanCreated > loanLiquidationDuration) {
            revert REVLoans_LoanExpired({
                timeSinceLoanCreated: timeSinceLoanCreated, loanLiquidationDuration: loanLiquidationDuration
            });
        }

        // The prepaid fee reduces the amount that can still accrue a time-based source fee.
        uint256 prepaid = JBFees.feeAmountFrom({amountBeforeFee: loan.amount, feePercent: loan.prepaidFeePercent});

        // Linearly ramp the remaining source fee from 0 after the prepaid window to 100% at liquidation.
        uint256 fullSourceFeeAmount = JBFees.feeAmountFrom({
            amountBeforeFee: loan.amount - prepaid,
            feePercent: mulDiv({
                x: timeSinceLoanCreated - loan.prepaidDuration,
                y: JBConstants.MAX_FEE,
                denominator: loanLiquidationDuration - loan.prepaidDuration
            })
        });

        // Charge only the pro-rata part of the full source fee for the principal being repaid.
        return mulDiv({x: fullSourceFeeAmount, y: amount, denominator: loan.amount});
    }
}
