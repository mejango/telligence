// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBPayoutTerminal} from "@bananapus/core-v6/src/interfaces/IJBPayoutTerminal.sol";
import {IJBPrices} from "@bananapus/core-v6/src/interfaces/IJBPrices.sol";
import {IJBTokenUriResolver} from "@bananapus/core-v6/src/interfaces/IJBTokenUriResolver.sol";
import {JBSingleAllowance} from "@bananapus/core-v6/src/structs/JBSingleAllowance.sol";
import {IJBSuckerRegistry} from "@bananapus/suckers-v6/src/interfaces/IJBSuckerRegistry.sol";
import {IPermit2} from "@uniswap/permit2/src/interfaces/IPermit2.sol";
import {REVLoan} from "../structs/REVLoan.sol";

/// @notice Manages loans against revnet token collateral.
interface IREVLoans {
    /// @notice Emitted when a loan is created by borrowing from a revnet.
    /// @param loanId The ID of the newly created loan.
    /// @param revnetId The ID of the revnet being borrowed from.
    /// @param loan The loan data.
    /// @param token The token borrowed from the revnet's canonical multi terminal.
    /// @param borrowAmount The amount borrowed.
    /// @param collateralCount The amount of collateral tokens locked.
    /// @param sourceFeeAmount The fee amount charged by the source.
    /// @param beneficiary The address receiving the borrowed funds.
    /// @param caller The address that created the loan.
    event Borrow(
        uint256 indexed loanId,
        uint256 indexed revnetId,
        REVLoan loan,
        address token,
        uint256 borrowAmount,
        uint256 collateralCount,
        uint256 sourceFeeAmount,
        address payable beneficiary,
        address caller
    );

    /// @notice Emitted when a loan is liquidated after exceeding the liquidation duration.
    /// @param loanId The ID of the liquidated loan.
    /// @param revnetId The ID of the revnet the loan was from.
    /// @param loan The liquidated loan data.
    /// @param caller The address that triggered the liquidation.
    event Liquidate(uint256 indexed loanId, uint256 indexed revnetId, REVLoan loan, address caller);

    /// @notice Emitted when collateral is reallocated from one loan to a new loan.
    /// @param loanId The ID of the original loan.
    /// @param revnetId The ID of the revnet.
    /// @param reallocatedLoanId The ID of the loan after reallocation.
    /// @param reallocatedLoan The reallocated loan data.
    /// @param removedCollateralCount The amount of collateral removed from the original loan.
    /// @param caller The address that triggered the reallocation.
    event ReallocateCollateral(
        uint256 indexed loanId,
        uint256 indexed revnetId,
        uint256 indexed reallocatedLoanId,
        REVLoan reallocatedLoan,
        uint256 removedCollateralCount,
        address caller
    );

    /// @notice Emitted when a loan is repaid.
    /// @param loanId The ID of the loan being repaid.
    /// @param revnetId The ID of the revnet.
    /// @param paidOffLoanId The ID of the loan after repayment.
    /// @param loan The original loan data.
    /// @param paidOffLoan The loan data after repayment.
    /// @param repayBorrowAmount The amount repaid.
    /// @param sourceFeeAmount The fee amount charged by the source.
    /// @param collateralCountToReturn The amount of collateral returned.
    /// @param beneficiary The address receiving the returned collateral.
    /// @param caller The address that repaid the loan.
    event RepayLoan(
        uint256 indexed loanId,
        uint256 indexed revnetId,
        uint256 indexed paidOffLoanId,
        REVLoan loan,
        REVLoan paidOffLoan,
        uint256 repayBorrowAmount,
        uint256 sourceFeeAmount,
        uint256 collateralCountToReturn,
        address payable beneficiary,
        address caller
    );

    /// @notice Emitted when the token URI resolver is changed.
    /// @param resolver The new token URI resolver.
    /// @param caller The address that set the resolver.
    event SetTokenUriResolver(IJBTokenUriResolver indexed resolver, address caller);

    /// @notice The amount that can be borrowed from a revnet given a certain amount of collateral.
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param collateralCount The amount of collateral to secure the loan with.
    /// @param decimals The decimals to use for the resulting fixed point value.
    /// @param currency The currency to denominate the resulting amount in.
    /// @return borrowableNow The amount a borrow can execute right now — the smaller of the economic ceiling and the
    /// terminal's live balance. Opening a borrow draws from the terminal's live balance, so this never exceeds what the
    /// terminal can disburse in the current state.
    /// @return borrowableCapacity The economic ceiling for the collateral, including amounts already borrowed against
    /// this revnet. This matches the value used when valuing existing collateral while repaying or reallocating a loan.
    function borrowableAmountFrom(
        uint256 revnetId,
        uint256 collateralCount,
        uint256 decimals,
        uint256 currency
    )
        external
        view
        returns (uint256 borrowableNow, uint256 borrowableCapacity);

    /// @notice The controller that manages revnets using this loans contract.
    /// @return The controller contract.
    function CONTROLLER() external view returns (IJBController);

    /// @notice Determines the source fee amount for a loan when paying off a certain amount.
    /// @param loan The loan to determine the source fee for.
    /// @param amount The amount to pay off.
    /// @return sourceFeeAmount The source fee amount for the loan.
    function determineSourceFeeAmount(
        REVLoan memory loan,
        uint256 amount
    )
        external
        view
        returns (uint256 sourceFeeAmount);

    /// @notice The directory of terminals and controllers for revnets.
    /// @return The directory contract.
    function DIRECTORY() external view returns (IJBDirectory);

    /// @notice Whether a revnet currently has outstanding loans from the specified token.
    /// @param revnetId The ID of the revnet to check.
    /// @param token The token to check.
    /// @return A flag indicating if the revnet has an active loan source.
    function isLoanSourceOf(uint256 revnetId, address token) external view returns (bool);

    /// @notice The duration after which a loan expires and its collateral is permanently lost.
    /// @return The loan liquidation duration in seconds.
    function LOAN_LIQUIDATION_DURATION() external view returns (uint256);

    /// @notice Get a loan's full details -- amount, collateral, creation time, prepaid fee, and source.
    /// @param loanId The ID of the loan to look up.
    /// @return The loan data.
    function loanOf(uint256 loanId) external view returns (REVLoan memory);

    /// @notice The token sources of each revnet's loans.
    /// @dev This array only grows -- sources are appended when a token is first used for borrowing, but are never
    /// removed. Gas cost scales linearly with the number of distinct sources, though this is practically bounded to the
    /// revnet's accepted accounting contexts.
    /// @param revnetId The ID of the revnet to get the loan sources for.
    /// @return The array of loan source tokens.
    function loanSourceTokensOf(uint256 revnetId) external view returns (address[] memory);

    /// @notice The maximum fee percent that can be prepaid when borrowing, in terms of `JBConstants.MAX_FEE`.
    /// @return The maximum prepaid fee percent.
    function MAX_PREPAID_FEE_PERCENT() external view returns (uint256);

    /// @notice The minimum fee percent that must be prepaid when borrowing, in terms of `JBConstants.MAX_FEE`.
    /// @return The minimum prepaid fee percent.
    function MIN_PREPAID_FEE_PERCENT() external view returns (uint256);

    /// @notice The permit2 utility used for token transfers.
    /// @return The permit2 contract.
    function PERMIT2() external view returns (IPermit2);

    /// @notice The contract that stores prices for each revnet.
    /// @return The prices contract.
    function PRICES() external view returns (IJBPrices);

    /// @notice The ID of the REV revnet that receives protocol fees from loans.
    /// @return The REV revnet ID.
    function REV_ID() external view returns (uint256);

    /// @notice The fee percent charged by the REV revnet on each loan, in terms of `JBConstants.MAX_FEE`.
    /// @return The REV prepaid fee percent.
    function REV_PREPAID_FEE_PERCENT() external view returns (uint256);

    /// @notice The sucker registry used to discover peer chain suckers for cross-chain supply/surplus awareness.
    /// @return The sucker registry.
    function SUCKER_REGISTRY() external view returns (IJBSuckerRegistry);

    /// @notice The canonical payout terminal that holds revnet treasury balances and sources all revnet loans.
    /// @return The canonical payout terminal.
    function TERMINAL() external view returns (IJBPayoutTerminal);

    /// @notice The revnet ID for a given loan ID.
    /// @param loanId The loan ID to look up.
    /// @return The ID of the revnet.
    function revnetIdOfLoanWith(uint256 loanId) external view returns (uint256);

    /// @notice The contract resolving each loan ID to its ERC-721 URI.
    /// @return The token URI resolver.
    function tokenUriResolver() external view returns (IJBTokenUriResolver);

    /// @notice The total amount loaned out by a revnet from a specified token.
    /// @param revnetId The ID of the revnet to check.
    /// @param token The token loaned.
    /// @return The total amount borrowed.
    function totalBorrowedFrom(uint256 revnetId, address token) external view returns (uint256);

    /// @notice The total amount of collateral supporting a revnet's loans.
    /// @param revnetId The ID of the revnet.
    /// @return The total collateral count.
    function totalCollateralOf(uint256 revnetId) external view returns (uint256);

    /// @notice The cumulative number of loans ever created for a revnet, used as a loan ID sequence counter.
    /// @dev This counter only increments and never decrements. It does NOT represent the count of currently active
    /// loans -- repaid and liquidated loans leave permanent gaps in the sequence. Do not use this value to determine
    /// how many loans are currently outstanding.
    /// @param revnetId The ID of the revnet to get the cumulative loan count for.
    /// @return The cumulative number of loans ever created.
    function totalLoansBorrowedFor(uint256 revnetId) external view returns (uint256);

    /// @notice Open a loan by borrowing from a revnet. Collateral tokens are burned and only re-minted upon repayment.
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param token The token to borrow from the revnet's canonical multi terminal.
    /// @param minBorrowAmount The minimum amount to borrow, denominated in `token`.
    /// @param collateralCount The amount of tokens to use as collateral for the loan.
    /// @param beneficiary The address that will receive the borrowed funds and fee payment tokens.
    /// @param prepaidFeePercent The fee percent to charge upfront, in terms of `JBConstants.MAX_FEE`.
    /// @param holder The address whose tokens to use as collateral and who receives the loan NFT.
    /// @return loanId The ID of the loan created.
    /// @return The loan created.
    function borrowFrom(
        uint256 revnetId,
        address token,
        uint256 minBorrowAmount,
        uint256 collateralCount,
        address payable beneficiary,
        uint256 prepaidFeePercent,
        address holder
    )
        external
        returns (uint256 loanId, REVLoan memory);

    /// @notice Liquidate loans that have exceeded the liquidation duration, permanently destroying their collateral.
    /// @param revnetId The ID of the revnet to liquidate loans from.
    /// @param startingLoanId The loan number to start iterating from.
    /// @param count The number of loans to iterate over.
    function liquidateExpiredLoansFrom(uint256 revnetId, uint256 startingLoanId, uint256 count) external;

    /// @notice Refinance a loan by transferring extra collateral from an existing loan to a new loan.
    /// @param loanId The ID of the loan to reallocate collateral from.
    /// @param collateralCountToTransfer The amount of collateral to transfer from the original loan.
    /// @param token The token of the new loan. Must match the existing loan's source token.
    /// @param minBorrowAmount The minimum amount to borrow for the new loan.
    /// @param collateralCountToAdd Additional collateral to add to the new loan from your balance.
    /// @param beneficiary The address that will receive the borrowed funds and fee payment tokens.
    /// @param prepaidFeePercent The fee percent to charge upfront for the new loan.
    /// @return reallocatedLoanId The ID of the reallocated (reduced) loan.
    /// @return newLoanId The ID of the newly created loan.
    /// @return reallocatedLoan The reallocated loan data.
    /// @return newLoan The new loan data.
    function reallocateCollateralFromLoan(
        uint256 loanId,
        uint256 collateralCountToTransfer,
        address token,
        uint256 minBorrowAmount,
        uint256 collateralCountToAdd,
        address payable beneficiary,
        uint256 prepaidFeePercent
    )
        external
        returns (uint256 reallocatedLoanId, uint256 newLoanId, REVLoan memory reallocatedLoan, REVLoan memory newLoan);

    /// @notice Repay a loan or return excess collateral no longer needed to support the loan.
    /// @param loanId The ID of the loan to repay.
    /// @param maxRepayBorrowAmount The maximum amount to repay, denominated in the source's token.
    /// @param collateralCountToReturn The amount of collateral to return from the loan.
    /// @param beneficiary The address to receive the returned collateral and fee payment tokens.
    /// @param allowance A permit2 allowance to facilitate the repayment transfer.
    /// @return paidOffLoanId The ID of the loan after repayment.
    /// @return paidOffloan The loan after repayment.
    function repayLoan(
        uint256 loanId,
        uint256 maxRepayBorrowAmount,
        uint256 collateralCountToReturn,
        address payable beneficiary,
        JBSingleAllowance calldata allowance
    )
        external
        payable
        returns (uint256 paidOffLoanId, REVLoan memory paidOffloan);

    /// @notice Set the address of the resolver used to retrieve the token URI of loans.
    /// @param resolver The new token URI resolver.
    function setTokenUriResolver(IJBTokenUriResolver resolver) external;
}
