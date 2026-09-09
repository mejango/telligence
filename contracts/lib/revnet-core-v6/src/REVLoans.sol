// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {JBPermissioned} from "@bananapus/core-v6/src/abstract/JBPermissioned.sol";
import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBMultiTerminal} from "@bananapus/core-v6/src/interfaces/IJBMultiTerminal.sol";
import {IJBPayoutTerminal} from "@bananapus/core-v6/src/interfaces/IJBPayoutTerminal.sol";
import {IJBPermissioned} from "@bananapus/core-v6/src/interfaces/IJBPermissioned.sol";
import {IJBPrices} from "@bananapus/core-v6/src/interfaces/IJBPrices.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {IJBTokenUriResolver} from "@bananapus/core-v6/src/interfaces/IJBTokenUriResolver.sol";
import {JBCashOuts} from "@bananapus/core-v6/src/libraries/JBCashOuts.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBFees} from "@bananapus/core-v6/src/libraries/JBFees.sol";
import {JBRulesetMetadataResolver} from "@bananapus/core-v6/src/libraries/JBRulesetMetadataResolver.sol";
import {JBSurplus} from "@bananapus/core-v6/src/libraries/JBSurplus.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JBSingleAllowance} from "@bananapus/core-v6/src/structs/JBSingleAllowance.sol";
import {JBPermissionIds} from "@bananapus/permission-ids-v6/src/JBPermissionIds.sol";
import {IJBSuckerRegistry} from "@bananapus/suckers-v6/src/interfaces/IJBSuckerRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {mulDiv} from "@prb/math/src/Common.sol";
import {IAllowanceTransfer} from "@uniswap/permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPermit2} from "@uniswap/permit2/src/interfaces/IPermit2.sol";

import {IREVLoans} from "./interfaces/IREVLoans.sol";
import {IREVOwner} from "./interfaces/IREVOwner.sol";
import {REVLoansSourceFees} from "./libraries/REVLoansSourceFees.sol";
import {REVLoan} from "./structs/REVLoan.sol";

/// @notice Allows revnet token holders to borrow against their tokens instead of cashing out. The borrowable amount
/// equals what a cash-out would return. Collateral tokens are burned on borrow and re-minted on repayment, keeping the
/// revnet's token structure orderly. Each loan is represented as an ERC-721 NFT that can be transferred.
/// @dev Fee structure: an upfront fee is taken at borrow time. 2.5% goes to the source revnet
/// (MIN_PREPAID_FEE_PERCENT), 1% goes to the $REV revnet (REV_PREPAID_FEE_PERCENT), and a variable amount chosen by the
/// borrower determines the prepaid duration. More upfront payment extends the zero-additional-cost period; once the
/// prepaid duration expires, the repayment cost increases linearly until the loan liquidates at 10 years
/// (LOAN_LIQUIDATION_DURATION), at which point the collateral is permanently lost.
/// @dev The loaned amounts include the fees taken, meaning the amount paid back is the amount borrowed plus the fees.
contract REVLoans is ERC721, ERC2771Context, JBPermissioned, Ownable, IREVLoans {
    // A library that parses the packed ruleset metadata into a friendlier format.
    using JBRulesetMetadataResolver for JBRuleset;

    // A library that adds default safety checks to ERC20 functionality.
    using SafeERC20 for IERC20;

    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice Thrown when opening a loan before the revnet's cash-out delay has elapsed.
    error REVLoans_CashOutDelayNotFinished(uint256 cashOutDelay, uint256 blockTimestamp);

    /// @notice Thrown when the collateral requested to return exceeds the loan's collateral.
    error REVLoans_CollateralExceedsLoan(uint256 collateralToReturn, uint256 loanCollateral);

    /// @notice Thrown when total borrow fees exceed the amount paid out by the terminal.
    error REVLoans_FeeAmountExceedsNetPayout(uint256 netAmountPaidOut, uint256 revFeeAmount, uint256 sourceFeeAmount);

    /// @notice Thrown when a repayment credits a different amount than expected, indicating a fee-on-transfer token.
    error REVLoans_FeeOnTransferSourceUnsupported(address token, uint256 expectedAmount, uint256 creditedAmount);

    /// @notice Thrown when the loan source token has no matching accounting context on the terminal.
    error REVLoans_InvalidAccountingContext(uint256 revnetId, address token);

    /// @notice Thrown when the prepaid fee percent is outside the allowed minimum and maximum.
    error REVLoans_InvalidPrepaidFeePercent(uint256 prepaidFeePercent, uint256 min, uint256 max);

    /// @notice Thrown when acting on a loan whose elapsed time exceeds the liquidation duration.
    error REVLoans_LoanExpired(uint256 timeSinceLoanCreated, uint256 loanLiquidationDuration);

    /// @notice Thrown when a loan ID would exceed the revnet's loan ID namespace.
    error REVLoans_LoanIdOverflow(uint256 revnetId, uint256 loanNumber, uint256 maxLoanNumber);

    /// @notice Thrown when the loan's owner changed during execution, such as via a reentrant token transfer.
    error REVLoans_LoanOwnerChanged(uint256 loanId, address expectedOwner, address actualOwner);

    /// @notice Thrown when the recalculated borrow amount for remaining collateral exceeds the loan's amount.
    error REVLoans_NewBorrowAmountGreaterThanLoanAmount(uint256 newBorrowAmount, uint256 loanAmount);

    /// @notice Thrown when native value is sent for a loan source token that is not the native token.
    error REVLoans_NoMsgValueAllowed(uint256 msgValue, address token);

    /// @notice Thrown when the collateral requested to remove exceeds the loan's collateral.
    error REVLoans_NotEnoughCollateral(uint256 collateralCountToRemove, uint256 loanCollateral);

    /// @notice Thrown when a repayment would repay no borrow amount and return no collateral.
    error REVLoans_NothingToRepay(uint256 repayBorrowAmount, uint256 collateralCountToReturn);

    /// @notice Thrown when the required repay amount exceeds the caller's maximum repay amount.
    error REVLoans_OverMaxRepayBorrowAmount(uint256 maxRepayBorrowAmount, uint256 repayBorrowAmount);

    /// @notice Thrown when a value exceeds the storage or permit2 type limit it must fit within.
    error REVLoans_OverflowAlert(uint256 value, uint256 limit);

    /// @notice Thrown when the permit2 allowance is less than the amount required for the payment.
    error REVLoans_PermitAllowanceNotEnough(uint256 allowanceAmount, uint256 requiredAmount);

    /// @notice Thrown when reallocating more collateral than the loan's outstanding borrow amount allows.
    error REVLoans_ReallocatingMoreCollateralThanBorrowedAmountAllows(uint256 newBorrowAmount, uint256 loanAmount);

    /// @notice Thrown when a loan action is re-entered while another loan action is in progress.
    error REVLoans_ReentrantLoanAction();

    /// @notice Thrown when a new loan's source token does not match the existing loan's source token.
    error REVLoans_SourceMismatch(address expectedToken, address actualToken);

    /// @notice Thrown when the borrowable amount is below the caller's minimum borrow amount.
    error REVLoans_UnderMinBorrowAmount(uint256 minBorrowAmount, uint256 borrowAmount);

    /// @notice Thrown when the borrowable amount for the given collateral evaluates to zero.
    error REVLoans_ZeroBorrowAmount(uint256 revnetId, uint256 collateralCount);

    /// @notice Thrown when opening a loan with zero collateral.
    error REVLoans_ZeroCollateralLoanIsInvalid(uint256 collateralCount);

    /// @notice Thrown when a cross-currency loan source returns a zero price per unit.
    error REVLoans_ZeroPrice(uint256 revnetId, uint256 pricingCurrency, uint256 unitCurrency);

    //*********************************************************************//
    // ------------------------- public constants ------------------------ //
    //*********************************************************************//

    /// @notice The duration after which an unrepaid loan expires and its collateral is permanently lost (10 years).
    /// @dev After the prepaid duration, the loan will cost more to pay off. Paying 50% upfront covers access to the
    /// remaining 50% for 10 years. Paying 0% upfront costs 100% after 10 years. Both loans liquidate at 10 years.
    uint256 public constant override LOAN_LIQUIDATION_DURATION = 3650 days;

    /// @notice The maximum fee percent that can be prepaid when borrowing (50%), in terms of JBConstants.MAX_FEE.
    uint256 public constant override MAX_PREPAID_FEE_PERCENT = 500;

    /// @notice The fee percent charged by the $REV revnet on each loan (1%), in terms of JBConstants.MAX_FEE.
    uint256 public constant override REV_PREPAID_FEE_PERCENT = 10; // 1%

    /// @notice The minimum fee percent that must be prepaid when borrowing (2.5%), in terms of JBConstants.MAX_FEE.
    uint256 public constant override MIN_PREPAID_FEE_PERCENT = 25; // 2.5%

    //*********************************************************************//
    // ------------------------ private constants ------------------------ //
    //*********************************************************************//

    /// @notice The number of loan IDs reserved for each revnet.
    /// @dev Loan IDs are encoded as `revnetId * _LOAN_ID_NAMESPACE_SIZE + loanNumber`.
    uint256 private constant _LOAN_ID_NAMESPACE_SIZE = 1_000_000_000_000_000_000;

    /// @notice The largest loan number that stays within a single revnet's ID namespace.
    /// @dev This is the largest loan number that stays in the current revnet's ID namespace.
    uint256 private constant _MAX_LOAN_NUMBER = _LOAN_ID_NAMESPACE_SIZE - 1;

    //*********************************************************************//
    // --------------- public immutable stored properties ---------------- //
    //*********************************************************************//

    /// @notice The controller of revnets that use this loans contract.
    IJBController public immutable override CONTROLLER;

    /// @notice The directory of terminals and controllers for revnets.
    IJBDirectory public immutable override DIRECTORY;

    /// @notice The Permit2 contract used for token approvals and transfers.
    IPermit2 public immutable override PERMIT2;

    /// @notice A contract that stores prices for each revnet.
    IJBPrices public immutable override PRICES;

    /// @notice The ID of the REV revnet that will receive the fees.
    uint256 public immutable override REV_ID;

    /// @notice The sucker registry used to discover peer chain suckers for cross-chain awareness.
    IJBSuckerRegistry public immutable override SUCKER_REGISTRY;

    /// @notice The canonical payout terminal that holds revnet treasury balances and sources all revnet loans.
    IJBPayoutTerminal public immutable override TERMINAL;

    //*********************************************************************//
    // --------------------- public stored properties -------------------- //
    //*********************************************************************//

    /// @notice An indication if a revnet currently has outstanding loans from the specified token source.
    /// @custom:param revnetId The ID of the revnet to check.
    /// @custom:param token The token source to check.
    mapping(uint256 revnetId => mapping(address token => bool)) public override isLoanSourceOf;

    /// @notice The contract resolving each project ID to its ERC721 URI.
    IJBTokenUriResolver public override tokenUriResolver;

    /// @notice The total amount loaned out by a revnet from a specified token source.
    /// @custom:param revnetId The ID of the revnet to check.
    /// @custom:param token The token source to check.
    mapping(uint256 revnetId => mapping(address token => uint256)) public override totalBorrowedFrom;

    /// @notice The total amount of collateral supporting a revnet's loans.
    /// @custom:param revnetId The ID of the revnet to check.
    mapping(uint256 revnetId => uint256) public override totalCollateralOf;

    /// @notice The cumulative number of loans ever created for a revnet, used as a loan ID sequence counter.
    /// @dev This counter only increments (on borrow, repay-with-new-loan, and reallocation) and never decrements.
    /// It does NOT represent the number of currently active loans. Repaid and liquidated loans leave permanent gaps
    /// in the ID sequence. Integrators should not use this to count active loans.
    /// @custom:param revnetId The ID of the revnet to check.
    mapping(uint256 revnetId => uint256) public override totalLoansBorrowedFor;

    //*********************************************************************//
    // --------------------- internal stored properties ------------------ //
    //*********************************************************************//

    /// @notice The loan state for each loan ID.
    /// @custom:param loanId The ID of the loan.
    mapping(uint256 loanId => REVLoan) internal _loanOf;

    /// @notice The sources of each revnet's loan.
    /// @dev This array grows monotonically -- entries are appended when a token is first used for borrowing, but are
    /// never removed. The `isLoanSourceOf` mapping tracks whether a source has been registered. Since sources are
    /// bounded to the revnet's accepted accounting contexts on the canonical multi terminal, iteration remains
    /// manageable.
    /// @custom:member revnetId The ID of the revnet to look up.
    mapping(uint256 revnetId => address[]) internal _loanSourceTokensOf;

    //*********************************************************************//
    // ------------------- transient stored properties ------------------- //
    //*********************************************************************//

    /// @notice Whether a loan-changing entrypoint is currently executing.
    bool transient _loanActionEntered;

    //*********************************************************************//
    // -------------------------- constructor ---------------------------- //
    //*********************************************************************//

    /// @param controller The controller that manages revnets using this loans contract.
    /// @param terminal The canonical payout terminal that holds revnet treasury balances and sources loans.
    /// @param suckerRegistry The registry used to discover peer chain suckers for cross-chain supply/surplus awareness.
    /// @param revId The ID of the REV revnet that will receive the fees.
    /// @param owner The owner of the contract that can set the URI resolver.
    /// @param permit2 A permit2 utility.
    /// @param trustedForwarder A trusted forwarder of transactions to this contract.
    constructor(
        IJBController controller,
        IJBPayoutTerminal terminal,
        IJBSuckerRegistry suckerRegistry,
        uint256 revId,
        address owner,
        IPermit2 permit2,
        address trustedForwarder
    )
        ERC721("REV Loans", "$REVLOAN")
        ERC2771Context(trustedForwarder)
        JBPermissioned(IJBPermissioned(address(controller)).PERMISSIONS())
        Ownable(owner)
    {
        CONTROLLER = controller;
        DIRECTORY = controller.DIRECTORY();
        TERMINAL = terminal;
        PRICES = controller.PRICES();
        REV_ID = revId;
        PERMIT2 = permit2;
        SUCKER_REGISTRY = suckerRegistry;
    }

    //*********************************************************************//
    // ---------------------------- modifiers ---------------------------- //
    //*********************************************************************//

    /// @notice Prevent nested loan-changing calls while an external callback is in progress.
    modifier nonReentrantLoanAction() {
        if (_loanActionEntered) revert REVLoans_ReentrantLoanAction();

        _loanActionEntered = true;
        _;
        _loanActionEntered = false;
    }

    //*********************************************************************//
    // ------------------------- external views -------------------------- //
    //*********************************************************************//

    /// @notice The amount that can be borrowed from a revnet.
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param collateralCount The amount of collateral to secure the loan with.
    /// @param decimals The decimals to use for the resulting fixed point value.
    /// @param currency The currency to denominate the resulting amount in.
    /// @return borrowableNow The amount a borrow can execute right now — the smaller of the economic ceiling and the
    /// terminal's live balance. Opening a borrow draws from the terminal's live balance, so this never exceeds what the
    /// terminal can disburse in the current state.
    /// @return borrowableCapacity The economic ceiling for the collateral, including amounts already borrowed against
    /// this revnet. This is the value used when valuing existing collateral while repaying or reallocating a loan.
    function borrowableAmountFrom(
        uint256 revnetId,
        uint256 collateralCount,
        uint256 decimals,
        uint256 currency
    )
        external
        view
        returns (uint256 borrowableNow, uint256 borrowableCapacity)
    {
        // Cache the current ruleset once — used by both _cashOutDelayOf and _borrowableAmountFrom.
        JBRuleset memory currentRuleset = _currentRulesetOf(revnetId);

        // If the cash out delay hasn't passed yet, no amount is borrowable.
        // forge-lint: disable-next-line(block-timestamp)
        if (_cashOutDelayOf({revnetId: revnetId, currentRuleset: currentRuleset}) > block.timestamp) return (0, 0);

        // Get the economic ceiling and the terminal's live balance.
        uint256 liveTreasurySurplus;
        (borrowableCapacity, liveTreasurySurplus) = _borrowableAmountFrom({
            revnetId: revnetId,
            collateralCount: collateralCount,
            decimals: decimals,
            currency: currency,
            multiTerminal: TERMINAL,
            currentStage: currentRuleset
        });

        // What a borrow can execute right now is capped at the terminal's live balance — opening a borrow draws from
        // it.
        borrowableNow = borrowableCapacity > liveTreasurySurplus ? liveTreasurySurplus : borrowableCapacity;
    }

    /// @notice Get a loan's full details -- amount, collateral, creation time, prepaid fee, and source.
    /// @param loanId The ID of the loan to look up.
    function loanOf(uint256 loanId) external view override returns (REVLoan memory) {
        return _loanOf[loanId];
    }

    /// @notice The source tokens of each revnet's loans.
    /// @dev This array only grows -- sources are never removed. The number of distinct sources is practically bounded
    /// by the number of accepted token accounting contexts, which is typically small.
    /// @param revnetId The ID of the revnet to look up.
    function loanSourceTokensOf(uint256 revnetId) external view override returns (address[] memory) {
        return _loanSourceTokensOf[revnetId];
    }

    //*********************************************************************//
    // -------------------------- public views --------------------------- //
    //*********************************************************************//

    /// @notice Determines the source fee amount for a loan when paying off a certain amount.
    /// @param loan The loan to determine the source fee for.
    /// @param amount The amount to pay off.
    /// @return sourceFeeAmount The source fee amount for the loan.
    function determineSourceFeeAmount(REVLoan memory loan, uint256 amount) public view returns (uint256) {
        return _determineSourceFeeAmount({loan: loan, amount: amount});
    }

    /// @notice The revnet ID for a given loan ID.
    /// @param loanId The loan ID to look up.
    /// @return The ID of the revnet.
    function revnetIdOfLoanWith(uint256 loanId) public pure override returns (uint256) {
        return loanId / _LOAN_ID_NAMESPACE_SIZE;
    }

    /// @notice Returns the URI where the ERC-721 standard JSON of a loan is hosted.
    /// @param loanId The ID of the loan to get the URI for.
    /// @return The token URI for the provided `loanId`.
    function tokenURI(uint256 loanId) public view override returns (string memory) {
        // Keep a reference to the resolver.
        IJBTokenUriResolver resolver = tokenUriResolver;

        // If there's no resolver, there's no URI.
        if (resolver == IJBTokenUriResolver(address(0))) return "";

        // Return the resolved URI.
        return resolver.getUri(loanId);
    }

    //*********************************************************************//
    // -------------------------- internal views ------------------------- //
    //*********************************************************************//

    /// @notice Checks this contract's balance of a specific token.
    /// @param token The address of the token to check.
    /// @return This contract's balance.
    function _balanceOf(address token) internal view returns (uint256) {
        // If the `token` is native, get the native token balance.
        return token == JBConstants.NATIVE_TOKEN ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    /// @dev This function reads live surplus from the revnet's terminals. A potential concern is flash loan
    /// manipulation: an attacker could temporarily inflate surplus via `addToBalanceOf` or `pay`, borrow at the
    /// inflated rate, then repay the flash loan. However, this attack is economically irrational:
    ///
    /// - `addToBalanceOf` permanently donates funds to the project (no recovery mechanism). The attacker's extra
    ///   borrowable amount equals `donation * (collateralCount / totalSupply)`, which is always less than the
    ///   donation since `collateralCount < totalSupply`. The attacker loses more than they gain.
    /// - `pay` increases both surplus AND totalSupply (via newly minted tokens), so the net effect on the
    ///   borrowable-amount-per-token ratio is neutral — the increased surplus is offset by supply dilution.
    /// - With non-zero `cashOutTaxRate`, the bonding curve is concave, making the attack even less profitable.
    /// - Refinancing during inflated surplus (`reallocateCollateralFromLoan`) does not help either: the freed
    ///   collateral can only borrow a fraction of the donated amount, keeping the attack net-negative.
    ///
    /// In summary, any attempt to inflate surplus to increase borrowing power costs the attacker more than it yields,
    /// because the bonding curve ensures no individual can extract more than their proportional share of surplus.
    /// @dev The amount that can be borrowed from a revnet given a certain amount of collateral.
    /// @dev The system intentionally allows up to 100% LTV (loan-to-value) by design. The borrowable amount equals
    /// what the collateral tokens would receive if cashed out, computed via the bonding curve formula in
    /// `JBCashOuts.cashOutFrom`. The `cashOutTaxRate` configured for the current stage serves as an implicit margin
    /// buffer: a non-zero tax rate reduces the cash-out value below the pro-rata share of surplus, creating an
    /// effective collateralization margin. For example, a 20% `cashOutTaxRate` means borrowers can only extract ~80%
    /// of their pro-rata surplus, providing a ~20% buffer against collateral depreciation before liquidation.
    /// A `cashOutTaxRate` of 0 means the full pro-rata amount is borrowable (true 100% LTV with no margin).
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param collateralCount The amount of collateral to secure the loan with.
    /// @param decimals The decimals to use for the resulting fixed point value.
    /// @param currency The currency to denominate the resulting amount in.
    /// @param multiTerminal The canonical multi terminal to borrow from.
    /// @param currentStage The pre-fetched current ruleset.
    /// @return borrowableCapacity The economic ceiling for the collateral — the smaller of the bonding-curve cash-out
    /// value and the local surplus (which includes both the live treasury surplus and the amounts already borrowed
    /// against this revnet). Callers that only value existing collateral without drawing fresh funds (repaying or
    /// reallocating a loan) use this directly.
    /// @return liveTreasurySurplus The amount the terminal can actually disburse right now. Callers that draw fresh
    /// funds (the borrowable-amount preview and opening a new borrow) cap the borrow at this so the figure never
    /// exceeds what a borrow can execute in the current state.
    function _borrowableAmountFrom(
        uint256 revnetId,
        uint256 collateralCount,
        uint256 decimals,
        uint256 currency,
        IJBTerminal multiTerminal,
        JBRuleset memory currentStage
    )
        internal
        view
        returns (uint256 borrowableCapacity, uint256 liveTreasurySurplus)
    {
        // Get the surplus of the revnet's canonical multi terminal in terms of the requested currency. This is the
        // amount the terminal can actually disburse right now, surfaced to callers as `liveTreasurySurplus`.
        liveTreasurySurplus = JBSurplus.currentSurplusOf({
            projectId: revnetId,
            terminals: _singleTerminalArray(multiTerminal),
            tokens: new address[](0),
            decimals: decimals,
            currency: currency
        });

        // Get the total amount the revnet currently has loaned out, denominated in the requested currency and
        // decimals.
        uint256 totalBorrowed = _totalBorrowedFrom({
            revnetId: revnetId, decimals: decimals, currency: currency, multiTerminal: multiTerminal
        });

        // Get the total amount of tokens in circulation.
        uint256 totalSupply = CONTROLLER.totalTokenSupplyWithReservedTokensOf(revnetId);

        // Get a reference to the collateral being used to secure loans.
        uint256 totalCollateral = totalCollateralOf[revnetId];

        // Only live token supply is counted here, then loan collateral is added back because loans burn collateral
        // while borrowers still have a repayable claim on it. Ordinary voluntary burns are not tracked as hidden
        // supply in v6; they destroy the holder's claim and do not need to be added back.
        uint256 localSupply = totalSupply + totalCollateral;

        // The local surplus includes both the treasury surplus and the outstanding borrowed amounts.
        uint256 localSurplus = liveTreasurySurplus + totalBorrowed;

        // Proportional — uses the CURRENT stage's cashOutTaxRate.
        // NOTE: When a revnet transitions between stages with different cashOutTaxRate values, the borrowable amount
        // for the same collateral changes. A lower cashOutTaxRate in a later stage means more borrowable value per
        // collateral. This is by design: loan value tracks the current bonding curve parameters, just as cash-out
        // value does. Borrowers benefit from decreasing tax rates and are constrained by increasing ones.
        // Start with local values. If the ruleset aggregates cross-chain state, add remote supply and surplus.
        uint256 effectiveSurplus = localSurplus;
        uint256 effectiveSupply = localSupply;
        if (!currentStage.scopeCashOutsToLocalBalances()) {
            effectiveSurplus += SUCKER_REGISTRY.totalRemoteSurplusOf({
                projectId: revnetId, decimals: decimals, currency: currency
            });
            effectiveSupply += SUCKER_REGISTRY.remoteTotalSupplyOf(revnetId);
        }
        uint256 reclaimable = JBCashOuts.cashOutFrom({
            surplus: effectiveSurplus,
            cashOutCount: collateralCount,
            totalSupply: effectiveSupply,
            cashOutTaxRate: currentStage.cashOutTaxRate()
        });

        // Cap at the local surplus — the economic ceiling, which includes both the live treasury surplus and the
        // amounts already borrowed against this revnet. Callers that draw fresh funds (the borrowable-amount preview
        // and opening a new borrow) further cap this at `liveTreasurySurplus` at the call site, since prior borrows
        // have already drawn their amounts out of the terminal (those amounts live in `totalBorrowed`, part of
        // `localSurplus`, but are no longer in the terminal). Callers that only value existing collateral (repaying or
        // reallocating a loan) use this ceiling directly, since no fresh funds are drawn.
        borrowableCapacity = reclaimable > localSurplus ? localSurplus : reclaimable;
    }

    /// @notice The amount of the loan that should be borrowed for the given collateral amount.
    /// @param loan The loan to determine the borrow amount for.
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param collateralCount The amount of collateral to secure the loan with.
    /// @param currentRuleset The pre-fetched current ruleset.
    /// @return borrowableCapacity The economic ceiling for the collateral. See `_borrowableAmountFrom`.
    /// @return liveTreasurySurplus The amount the terminal can actually disburse right now. See
    /// `_borrowableAmountFrom`.
    function _borrowAmountFrom(
        REVLoan storage loan,
        uint256 revnetId,
        uint256 collateralCount,
        JBRuleset memory currentRuleset
    )
        internal
        view
        returns (uint256 borrowableCapacity, uint256 liveTreasurySurplus)
    {
        // If there's no collateral, there's no loan.
        if (collateralCount == 0) return (0, 0);

        // Keep a reference to the token's accounting context from the canonical treasury terminal.
        JBAccountingContext memory context =
            TERMINAL.accountingContextForTokenOf({projectId: revnetId, token: loan.sourceToken});

        return _borrowableAmountFrom({
            revnetId: revnetId,
            collateralCount: collateralCount,
            decimals: context.decimals,
            currency: context.currency,
            multiTerminal: TERMINAL,
            currentStage: currentRuleset
        });
    }

    /// @notice Returns the cash out delay timestamp using a pre-fetched ruleset.
    /// @param revnetId The ID of the revnet.
    /// @param currentRuleset The pre-fetched current ruleset.
    /// @return The cash out delay timestamp. Returns 0 if no data hook is set or no delay exists.
    function _cashOutDelayOf(uint256 revnetId, JBRuleset memory currentRuleset) internal view returns (uint256) {
        // Extract the data hook address from the ruleset's packed metadata.
        address dataHook = currentRuleset.dataHook();

        // If there's no data hook, this isn't a revnet — no cash out delay applies.
        if (dataHook == address(0)) return 0;

        // Read the cash out delay from the REVOwner contract (the data hook).
        return IREVOwner(dataHook).cashOutDelayOf(revnetId);
    }

    /// @dev `ERC-2771` specifies the context as being a single address (20 bytes).
    function _contextSuffixLength() internal view override(ERC2771Context, Context) returns (uint256) {
        return super._contextSuffixLength();
    }

    /// @notice Returns the current ruleset for a revnet. Consolidates ABI encode/decode to a single site.
    /// @param revnetId The ID of the revnet.
    /// @return currentRuleset The current ruleset.
    function _currentRulesetOf(uint256 revnetId) internal view returns (JBRuleset memory currentRuleset) {
        (currentRuleset,) = CONTROLLER.currentRulesetOf(revnetId);
    }

    /// @notice Determines the source fee amount for a loan when paying off a certain amount.
    /// @param loan The loan to determine the source fee for.
    /// @param amount The amount to pay off.
    /// @return The source fee amount for the loan.
    function _determineSourceFeeAmount(REVLoan memory loan, uint256 amount) internal view returns (uint256) {
        // Keep a reference to the loan age here because production uses the live block timestamp while formal proofs
        // pass explicit elapsed-time values into the same source-fee library.
        uint256 timeSinceLoanCreated = block.timestamp - loan.createdAt;

        // Delegate the arithmetic so Halmos can prove the exact fee schedule without loading the full loan contract.
        return REVLoansSourceFees.sourceFeeAmountFrom({
            loan: loan,
            amount: amount,
            timeSinceLoanCreated: timeSinceLoanCreated,
            loanLiquidationDuration: LOAN_LIQUIDATION_DURATION
        });
    }

    /// @notice Generate an ID for a loan given a revnet ID and a loan number within that revnet.
    /// @dev The multiplication and addition can theoretically overflow a uint256 if revnetId or loanNumber are
    /// astronomically large. In practice this is infeasible — it would require 2^256 loans or project IDs, far
    /// beyond any realistic usage. No overflow check is needed.
    /// @param revnetId The ID of the revnet to generate a loan ID for.
    /// @param loanNumber The loan number within the revnet.
    /// @return The token ID of the 721.
    function _generateLoanId(uint256 revnetId, uint256 loanNumber) internal pure returns (uint256) {
        return (revnetId * _LOAN_ID_NAMESPACE_SIZE) + loanNumber;
    }

    /// @notice The calldata. Preferred to use over `msg.data`.
    /// @return calldata The `msg.data` of this call.
    function _msgData() internal view override(ERC2771Context, Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    /// @notice The message's sender. Preferred to use over `msg.sender`.
    /// @return sender The address which sent this call.
    function _msgSender() internal view override(ERC2771Context, Context) returns (address sender) {
        return ERC2771Context._msgSender();
    }

    /// @notice Returns a single-terminal array for surplus calculations.
    /// @param terminal The terminal to place in the array.
    /// @return terminals The one-item terminal array.
    function _singleTerminalArray(IJBTerminal terminal) internal pure returns (IJBTerminal[] memory terminals) {
        terminals = new IJBTerminal[](1);
        terminals[0] = terminal;
    }

    /// @notice The total borrowed amount from a revnet, aggregated across all loan sources.
    /// @dev Each source's `totalBorrowedFrom` is stored in the source token's native decimals (e.g. 6 for USDC,
    /// 18 for ETH). Before aggregation, each amount is normalized to the target `decimals` to prevent mixed-decimal
    /// arithmetic errors. For cross-currency sources, the normalized amount is then converted via the price feed.
    /// @dev Cross-currency sources fail closed if the price is zero. Core `JBPrices` reverts before returning zero;
    /// the local zero check below covers mocked or nonconforming price modules so a source is never silently ignored.
    /// @param revnetId The ID of the revnet to check.
    /// @param decimals The decimals to use for the resulting fixed point value.
    /// @param currency The currency to denominate the resulting value in.
    /// @return borrowedAmount The total amount borrowed.
    function _totalBorrowedFrom(
        uint256 revnetId,
        uint256 decimals,
        uint256 currency,
        IJBTerminal multiTerminal
    )
        internal
        view
        returns (uint256 borrowedAmount)
    {
        // Keep a reference to all sources being used to loan out from this revnet.
        // Use storage ref to avoid bulk-copying the entire array to memory.
        address[] storage sources = _loanSourceTokensOf[revnetId];

        // Iterate over all sources being used to loan out.
        for (uint256 i; i < sources.length; i++) {
            // Get a reference to the token being iterated on.
            address sourceToken = sources[i];

            // Get a reference to the amount of tokens loaned out.
            uint256 tokensLoaned = totalBorrowedFrom[revnetId][sourceToken];

            // Skip if no tokens are loaned from this source.
            if (tokensLoaned == 0) continue;

            // Get the current accounting context for the source token from the terminal being evaluated.
            JBAccountingContext memory context =
                multiTerminal.accountingContextForTokenOf({projectId: revnetId, token: sourceToken});

            // Normalize the token amount from the source's decimals to the target decimals.
            uint256 normalizedTokens;
            if (context.decimals > decimals) {
                normalizedTokens = tokensLoaned / (10 ** (context.decimals - decimals));
            } else if (context.decimals < decimals) {
                normalizedTokens = tokensLoaned * (10 ** (decimals - context.decimals));
            } else {
                normalizedTokens = tokensLoaned;
            }

            // If the currency matches, add the normalized amount directly.
            if (context.currency == currency) {
                borrowedAmount += normalizedTokens;
            } else {
                // Otherwise, convert via the price feed. `JBPrices` itself rejects a zero price, but the explicit
                // local check keeps the fail-closed behavior whenever a source returns 0 directly.
                uint256 pricePerUnit = PRICES.pricePerUnitOf({
                    projectId: revnetId, pricingCurrency: context.currency, unitCurrency: currency, decimals: decimals
                });

                // A zero denominator would either panic below or, if skipped, hide outstanding debt. Revert instead
                // so misconfigured cross-currency sources cannot make borrowers appear safer than they are.
                if (pricePerUnit == 0) {
                    revert REVLoans_ZeroPrice({
                        revnetId: revnetId, pricingCurrency: context.currency, unitCurrency: currency
                    });
                }

                borrowedAmount += mulDiv({x: normalizedTokens, y: 10 ** decimals, denominator: pricePerUnit});
            }
        }
    }

    //*********************************************************************//
    // ---------------------- external transactions ---------------------- //
    //*********************************************************************//

    /// @notice Open a loan by borrowing from a revnet.
    /// @dev The caller must first grant BURN_TOKENS permission to this contract via JBPermissions.setPermissionsFor().
    /// This is required because collateral posting burns the caller's tokens through the controller.
    /// @dev Collateral tokens are permanently burned when the loan is created. They are re-minted to the borrower
    /// only upon repayment. If the loan expires (after LOAN_LIQUIDATION_DURATION), the collateral is permanently
    /// lost and cannot be recovered.
    /// @dev A delegated operator (with OPEN_LOAN permission) can set `beneficiary` to any address, directing borrowed
    /// funds away from the holder. Holders should only grant OPEN_LOAN to fully trusted operators.
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param token The token to borrow from the revnet's canonical multi terminal.
    /// @param minBorrowAmount The minimum amount to borrow, denominated in `token`.
    /// @param collateralCount The amount of tokens to use as collateral for the loan.
    /// @param beneficiary The address that will receive the borrowed funds and the tokens resulting from fee payments.
    /// @param prepaidFeePercent The fee percent to charge upfront. Prepaying a fee is cheaper than paying later.
    /// @return loanId The ID of the loan created.
    /// @return loan The loan created.
    function borrowFrom(
        uint256 revnetId,
        address token,
        uint256 minBorrowAmount,
        uint256 collateralCount,
        address payable beneficiary,
        uint256 prepaidFeePercent,
        address holder
    )
        public
        override
        nonReentrantLoanAction
        returns (uint256 loanId, REVLoan memory)
    {
        // Only the holder or a permissioned operator can open a loan on the holder's behalf.
        // Note: the operator controls `beneficiary`, so they can direct borrowed funds to any address.
        _requirePermissionFrom({account: holder, projectId: revnetId, permissionId: JBPermissionIds.OPEN_LOAN});

        return _borrowFrom({
            revnetId: revnetId,
            token: token,
            minBorrowAmount: minBorrowAmount,
            collateralCount: collateralCount,
            beneficiary: beneficiary,
            prepaidFeePercent: prepaidFeePercent,
            holder: holder
        });
    }

    /// @notice Liquidate loans that have exceeded the 10-year liquidation duration.
    /// @dev Liquidation permanently destroys the collateral backing expired loans. Since collateral tokens were burned
    /// at deposit time (not held in escrow), there is nothing to return upon liquidation -- the collateral count is
    /// simply removed from tracking. The borrower retains whatever funds they received from the loan, but the
    /// collateral tokens that were burned to secure the loan are permanently lost.
    /// @dev This is an intentional design choice to keep the protocol simple and to incentivize timely repayment or
    /// refinancing. Borrowers have the full LOAN_LIQUIDATION_DURATION (10 years) to repay their loan and recover
    /// their collateral via re-minting.
    /// @dev Since some loans may be reallocated or paid off, loans within startingLoanId and startingLoanId + count
    /// may be skipped, so choose these parameters carefully to avoid extra gas usage.
    /// @param revnetId The ID of the revnet to liquidate loans from.
    /// @param startingLoanId The loan number to start iterating from.
    /// @param count The number of loans to iterate over.
    function liquidateExpiredLoansFrom(
        uint256 revnetId,
        uint256 startingLoanId,
        uint256 count
    )
        external
        override
        nonReentrantLoanAction
    {
        // No loans are checked when count is zero.
        if (count == 0) return;

        // Prevent cross-revnet accounting corruption: every iterated loan number must stay within the revnet's ID
        // namespace.
        if (startingLoanId > _MAX_LOAN_NUMBER) {
            revert REVLoans_LoanIdOverflow({
                revnetId: revnetId, loanNumber: startingLoanId, maxLoanNumber: _MAX_LOAN_NUMBER
            });
        }
        uint256 maxCount = _MAX_LOAN_NUMBER - startingLoanId + 1;
        if (count > maxCount) {
            revert REVLoans_LoanIdOverflow({
                revnetId: revnetId, loanNumber: _LOAN_ID_NAMESPACE_SIZE, maxLoanNumber: _MAX_LOAN_NUMBER
            });
        }

        // Cache the sender to avoid repeated ERC2771 context reads inside the loop.
        address sender = _msgSender();

        // Iterate over the desired number of loans to check for liquidation.
        for (uint256 i; i < count; i++) {
            // Get a reference to the next loan ID.
            uint256 loanId = _generateLoanId({revnetId: revnetId, loanNumber: startingLoanId + i});

            // Check createdAt via storage ref first to avoid loading the full struct for empty slots.
            if (_loanOf[loanId].createdAt == 0) continue;

            // Get a reference to the loan being iterated on.
            REVLoan memory loan = _loanOf[loanId];

            // Keep a reference to the loan's owner.
            address owner = _ownerOf(loanId);

            // If the loan is already burned, or if it hasn't passed its liquidation duration, continue.
            // forge-lint: disable-next-line(block-timestamp)
            if (owner == address(0) || (block.timestamp <= loan.createdAt + LOAN_LIQUIDATION_DURATION)) continue;

            // Burn the loan.
            _burn(loanId);

            // Clear stale loan data for gas refund.
            delete _loanOf[loanId];

            if (loan.collateral > 0) {
                // The collateral was burned at deposit time -- there is nothing to return. This bookkeeping
                // removal means the collateral tokens are permanently lost.
                // Decrement the total amount of collateral tokens supporting loans from this revnet.
                totalCollateralOf[revnetId] -= loan.collateral;
            }

            if (loan.amount > 0) {
                // Decrement the amount loaned.
                totalBorrowedFrom[revnetId][loan.sourceToken] -= loan.amount;
            }

            emit Liquidate({loanId: loanId, revnetId: revnetId, loan: loan, caller: sender});
        }
    }

    /// @notice Refinance a loan by transferring extra collateral from an existing loan to a new loan.
    /// @dev Useful if a loan's collateral has gone up in value since the loan was created.
    /// @dev Refinancing a loan will burn the original and create two new loans.
    /// @dev This function is intentionally not payable — it only moves existing collateral between loans and does
    /// not accept new funds. Any ETH sent with the call will be rejected by the EVM.
    /// @dev A delegated operator (with REALLOCATE_LOAN permission) can set `beneficiary` to any address, directing
    /// borrowed funds from the new loan away from the loan owner. Grant this permission only to trusted operators.
    /// @param loanId The ID of the loan to reallocate collateral from.
    /// @param collateralCountToTransfer The amount of collateral to transfer from the original loan.
    /// @param token The token of the new loan. Must match the existing loan's source token.
    /// @param minBorrowAmount The minimum amount to borrow, denominated in `token`.
    /// @param collateralCountToAdd The amount of collateral to add to the new loan from your balance.
    /// @param beneficiary The address that will receive the borrowed funds and the tokens resulting from fee payments.
    /// @param prepaidFeePercent The fee percent to charge upfront for the new loan.
    /// @return reallocatedLoanId The ID of the reallocated (reduced) loan.
    /// @return newLoanId The ID of the new loan.
    /// @return reallocatedLoan The reallocated loan data.
    /// @return newLoan The new loan created from reallocating collateral.
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
        override
        nonReentrantLoanAction
        returns (uint256 reallocatedLoanId, uint256 newLoanId, REVLoan memory reallocatedLoan, REVLoan memory newLoan)
    {
        // Keep a reference to the revnet ID of the loan being reallocated.
        uint256 revnetId = revnetIdOfLoanWith(loanId);

        // Only the loan owner or a permissioned operator can reallocate.
        // Note: the operator controls `beneficiary`, so they can direct new loan proceeds to any address.
        address loanOwner = _ownerOf(loanId);
        _requirePermissionFrom({account: loanOwner, projectId: revnetId, permissionId: JBPermissionIds.REALLOCATE_LOAN});

        // If the caller is adding fresh holder collateral on top of the reallocated amount, they must also have
        // OPEN_LOAN permission for the loan owner: that fresh collateral comes from the owner's project-token
        // balance and would otherwise let a REALLOCATE_LOAN-only operator open a brand-new loan against the owner's
        // tokens through this entry point, bypassing the OPEN_LOAN gate that `borrowFrom` enforces.
        if (collateralCountToAdd != 0) {
            _requirePermissionFrom({account: loanOwner, projectId: revnetId, permissionId: JBPermissionIds.OPEN_LOAN});
        }

        // Make sure the loan hasn't expired.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - _loanOf[loanId].createdAt > LOAN_LIQUIDATION_DURATION) {
            revert REVLoans_LoanExpired({
                timeSinceLoanCreated: block.timestamp - _loanOf[loanId].createdAt,
                loanLiquidationDuration: LOAN_LIQUIDATION_DURATION
            });
        }

        // Make sure the new loan's source matches the existing loan's source to prevent cross-source value extraction.
        {
            address existingToken = _loanOf[loanId].sourceToken;
            if (token != existingToken) {
                revert REVLoans_SourceMismatch({expectedToken: existingToken, actualToken: token});
            }
        }

        // Note: this function is not payable, so the EVM prevents sending ETH at the call level.

        // Refinance the loan.
        (reallocatedLoanId, reallocatedLoan) = _reallocateCollateralFromLoan({
            loanId: loanId, revnetId: revnetId, collateralCountToRemove: collateralCountToTransfer, loanOwner: loanOwner
        });

        // Make a new loan with the leftover collateral from reallocating.
        // The loan owner is the holder for the new loan (their tokens are used as collateral).
        // Uses _borrowFrom to skip the OPEN_LOAN permission check — the caller already proved REALLOCATE_LOAN
        // permission above, and requiring OPEN_LOAN here would block operators with only REALLOCATE_LOAN.
        (newLoanId, newLoan) = _borrowFrom({
            revnetId: revnetId,
            token: token,
            minBorrowAmount: minBorrowAmount,
            collateralCount: collateralCountToTransfer + collateralCountToAdd,
            beneficiary: beneficiary,
            prepaidFeePercent: prepaidFeePercent,
            holder: loanOwner
        });
    }

    /// @notice Repay a loan or return excess collateral no longer needed to support the loan.
    /// @dev A delegated operator (with REPAY_LOAN permission) can set `beneficiary` to any address, directing returned
    /// collateral tokens away from the loan owner. Grant this permission only to trusted operators.
    /// @param loanId The ID of the loan to repay.
    /// @param maxRepayBorrowAmount The maximum amount to repay, denominated in the token of the source's
    /// accounting context.
    /// @param collateralCountToReturn The amount of collateral to return from the loan.
    /// @param beneficiary The address to receive the returned collateral and any tokens resulting from paying fees.
    /// @param allowance An allowance to facilitate permit2 interactions.
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
        override
        nonReentrantLoanAction
        returns (uint256 paidOffLoanId, REVLoan memory paidOffloan)
    {
        // Cache the sender to avoid repeated ERC2771 context reads.
        address sender = _msgSender();

        // Only the loan owner or a permissioned operator can repay.
        // Note: the operator controls `beneficiary`, so they can direct returned collateral to any address.
        address loanOwner = _ownerOf(loanId);
        _requirePermissionFrom({
            account: loanOwner, projectId: revnetIdOfLoanWith(loanId), permissionId: JBPermissionIds.REPAY_LOAN
        });

        // Keep a reference to the loan being repaid.
        REVLoan storage loan = _loanOf[loanId];

        if (collateralCountToReturn > loan.collateral) {
            revert REVLoans_CollateralExceedsLoan({
                collateralToReturn: collateralCountToReturn, loanCollateral: loan.collateral
            });
        }

        // Get a reference to the revnet ID of the loan being repaid.
        uint256 revnetId = revnetIdOfLoanWith(loanId);

        // Cache the current ruleset once for borrow amount calculation.
        JBRuleset memory currentRuleset = _currentRulesetOf(revnetId);

        // Scope to limit newBorrowAmount's stack lifetime.
        uint256 repayBorrowAmount;
        {
            // Get the new borrow amount. This only re-values the remaining collateral to determine how much debt
            // stays outstanding — no fresh funds are drawn from the terminal — so it uses the economic ceiling and
            // ignores the live treasury surplus.
            (uint256 newBorrowAmount,) = _borrowAmountFrom({
                loan: loan,
                revnetId: revnetId,
                collateralCount: loan.collateral - collateralCountToReturn,
                currentRuleset: currentRuleset
            });

            // If the remaining collateral yields zero borrow amount, treat as full repay.
            if (newBorrowAmount == 0) {
                collateralCountToReturn = loan.collateral;
            }

            // Make sure the new borrow amount is less than the loan's amount.
            if (newBorrowAmount > loan.amount) {
                revert REVLoans_NewBorrowAmountGreaterThanLoanAmount({
                    newBorrowAmount: newBorrowAmount, loanAmount: loan.amount
                });
            }

            // Get the amount of the loan being repaid.
            repayBorrowAmount = loan.amount - newBorrowAmount;
        }

        // Revert if this repayment would do nothing — no borrow amount repaid and no collateral returned.
        // Without this check, a zero-amount repayment would burn the old loan NFT and mint a new one,
        // incrementing totalLoansBorrowedFor without limit.
        if (repayBorrowAmount == 0 && collateralCountToReturn == 0) {
            revert REVLoans_NothingToRepay({
                repayBorrowAmount: repayBorrowAmount, collateralCountToReturn: collateralCountToReturn
            });
        }

        // Keep a reference to the fee that'll be taken.
        uint256 sourceFeeAmount = _determineSourceFeeAmount({loan: loan, amount: repayBorrowAmount});

        // Add the fee to the repay amount.
        repayBorrowAmount += sourceFeeAmount;

        // Accept the funds that'll be used to pay off loans.
        maxRepayBorrowAmount =
            _acceptFundsFor({token: loan.sourceToken, amount: maxRepayBorrowAmount, allowance: allowance});

        // Re-check ownership: an ERC-777/ERC-1363 source token can reenter during the transfer above and transfer
        // the loan NFT to another account. Without this check, `_repayLoan` would burn the new owner's NFT while
        // returning collateral to the stale cached owner.
        {
            address currentOwner = _ownerOf(loanId);
            if (currentOwner != loanOwner) {
                revert REVLoans_LoanOwnerChanged({loanId: loanId, expectedOwner: loanOwner, actualOwner: currentOwner});
            }
        }

        // Make sure the minimum borrow amount is met.
        if (repayBorrowAmount > maxRepayBorrowAmount) {
            revert REVLoans_OverMaxRepayBorrowAmount({
                maxRepayBorrowAmount: maxRepayBorrowAmount, repayBorrowAmount: repayBorrowAmount
            });
        }

        // Cache the source token before _repayLoan deletes the loan storage.
        address sourceToken = loan.sourceToken;

        (paidOffLoanId, paidOffloan) = _repayLoan({
            loanId: loanId,
            loan: loan,
            revnetId: revnetId,
            repayBorrowAmount: repayBorrowAmount,
            sourceFeeAmount: sourceFeeAmount,
            collateralCountToReturn: collateralCountToReturn,
            beneficiary: beneficiary,
            loanOwner: loanOwner
        });

        // If the max repay amount is greater than the repay amount, return the difference back to the payer.
        if (maxRepayBorrowAmount > repayBorrowAmount) {
            _transferFrom({
                from: address(this),
                to: payable(sender),
                token: sourceToken,
                amount: maxRepayBorrowAmount - repayBorrowAmount
            });
        }
    }

    /// @notice Set the address of the resolver used to retrieve the tokenURI of loans.
    /// @param resolver The address of the new resolver.
    function setTokenUriResolver(IJBTokenUriResolver resolver) external override onlyOwner {
        // Store the new resolver.
        tokenUriResolver = resolver;

        emit SetTokenUriResolver({resolver: resolver, caller: _msgSender()});
    }

    //*********************************************************************//
    // --------------------- internal transactions ----------------------- //
    //*********************************************************************//

    /// @notice Accept an incoming token.
    /// @param token The token to accept.
    /// @param amount The number of tokens to accept.
    /// @param allowance The permit2 context.
    /// @return amount The number of tokens accepted.
    function _acceptFundsFor(
        address token,
        uint256 amount,
        JBSingleAllowance calldata allowance
    )
        internal
        returns (uint256)
    {
        // If the token is the native token, override `amount` with `msg.value`.
        if (token == JBConstants.NATIVE_TOKEN) return msg.value;

        // If the token is not native, revert if there is a non-zero `msg.value`.
        if (msg.value != 0) revert REVLoans_NoMsgValueAllowed({msgValue: msg.value, token: token});

        // Check if the metadata contains permit data.
        if (allowance.amount != 0) {
            // Make sure the permit allowance is enough for this payment. If not we revert early.
            if (allowance.amount < amount) {
                revert REVLoans_PermitAllowanceNotEnough({allowanceAmount: allowance.amount, requiredAmount: amount});
            }

            // Keep a reference to the permit rules.
            IAllowanceTransfer.PermitSingle memory permitSingle = IAllowanceTransfer.PermitSingle({
                details: IAllowanceTransfer.PermitDetails({
                    token: token, amount: allowance.amount, expiration: allowance.expiration, nonce: allowance.nonce
                }),
                spender: address(this),
                sigDeadline: allowance.sigDeadline
            });

            // Set the allowance to `spend` tokens for the user.
            try PERMIT2.permit({owner: _msgSender(), permitSingle: permitSingle, signature: allowance.signature}) {}
                catch (bytes memory) {}
        }

        // Get a reference to the balance before receiving tokens.
        uint256 balanceBefore = _balanceOf(token);

        // Transfer tokens to this terminal from the msg sender.
        _transferFrom({from: _msgSender(), to: payable(address(this)), token: token, amount: amount});

        // The amount should reflect the change in balance.
        return _balanceOf(token) - balanceBefore;
    }

    /// @notice Add collateral to a loan by burning the collateral tokens permanently.
    /// @dev The collateral tokens are burned via the controller, not held in escrow. They are only re-minted if the
    /// loan is repaid. If the loan expires and is liquidated, the burned collateral is permanently lost.
    /// @param revnetId The ID of the revnet to add collateral in.
    /// @param amount The amount of collateral to add to the loan.
    function _addCollateralTo(uint256 revnetId, uint256 amount, address holder) internal {
        // Increment the total amount of collateral tokens.
        totalCollateralOf[revnetId] += amount;

        // Permanently burn the tokens that are tracked as collateral. These are only re-minted upon repayment.
        CONTROLLER.burnTokensOf({holder: holder, projectId: revnetId, tokenCount: amount, memo: ""});
    }

    /// @notice Add a new amount to the loan that is greater than the previous amount.
    /// @param loan The loan to add to.
    /// @param revnetId The ID of the revnet the loan is in.
    /// @param addedBorrowAmount The amount to add to the loan, denominated in the token of the source's
    /// accounting context.
    /// @param sourceFeeAmount The fee amount taken from the revnet acting as the source of the loan.
    /// @param beneficiary The address to receive the borrowed funds and any tokens resulting from paying fees.
    function _addTo(
        REVLoan memory loan,
        uint256 revnetId,
        uint256 addedBorrowAmount,
        uint256 sourceFeeAmount,
        address payable beneficiary
    )
        internal
    {
        address sourceToken = loan.sourceToken;

        // Register the source if this is the first time it's being used for this revnet.
        // Note: Sources are only appended, never removed. Gas accumulation from iteration is bounded by the revnet's
        // accepted accounting contexts.
        if (!isLoanSourceOf[revnetId][sourceToken]) {
            isLoanSourceOf[revnetId][sourceToken] = true;
            _loanSourceTokensOf[revnetId].push(sourceToken);
        }

        // Increment the amount of the token borrowed from the revnet.
        totalBorrowedFrom[revnetId][sourceToken] += addedBorrowAmount;

        uint256 netAmountPaidOut;
        {
            JBAccountingContext memory context =
                TERMINAL.accountingContextForTokenOf({projectId: revnetId, token: sourceToken});

            // Pull the amount to be loaned out of the revnet. This will incur the protocol fee.
            netAmountPaidOut = TERMINAL.useAllowanceOf({
                projectId: revnetId,
                token: sourceToken,
                amount: addedBorrowAmount,
                currency: context.currency,
                minTokensPaidOut: 0,
                beneficiary: payable(address(this)),
                feeBeneficiary: beneficiary,
                memo: ""
            });
        }

        // Keep a reference to the fee terminal.
        IJBTerminal feeTerminal = DIRECTORY.primaryTerminalOf({projectId: REV_ID, token: sourceToken});

        // Get the amount of additional fee to take for REV.
        uint256 revFeeAmount = address(feeTerminal) == address(0)
            ? 0
            : JBFees.feeAmountFrom({amountBeforeFee: addedBorrowAmount, feePercent: REV_PREPAID_FEE_PERCENT});

        // Try to pay the REV fee. If it fails, revFeeAmount is zeroed so the borrower receives it instead.
        if (revFeeAmount > 0) {
            if (!_tryPayFee({
                    terminal: feeTerminal,
                    projectId: REV_ID,
                    token: sourceToken,
                    amount: revFeeAmount,
                    beneficiary: beneficiary,
                    metadataProjectId: revnetId
                })) {
                revFeeAmount = 0;
            }
        }

        // Reserve fee amounts before transferring proceeds. The terminal payout must cover both fee buckets.
        uint256 totalFeeAmount = revFeeAmount + sourceFeeAmount;
        if (totalFeeAmount > netAmountPaidOut) {
            revert REVLoans_FeeAmountExceedsNetPayout({
                netAmountPaidOut: netAmountPaidOut, revFeeAmount: revFeeAmount, sourceFeeAmount: sourceFeeAmount
            });
        }

        // Transfer the remaining balance to the borrower.
        _transferFrom({
            from: address(this), to: beneficiary, token: sourceToken, amount: netAmountPaidOut - totalFeeAmount
        });
    }

    /// @notice Adjust a loan -- pay it back, add more, or return excess collateral.
    /// @dev `borrowFrom`, `reallocateCollateralFromLoan`, and `repayLoan` hold a transient lock across this function.
    /// External terminal, token, and beneficiary callbacks may observe in-progress loan state, but they cannot nest
    /// another loan-changing action before aggregate collateral and borrowed accounting have finished updating.
    /// @param loan The loan to adjust.
    /// @param revnetId The ID of the revnet the loan is in.
    /// @param newBorrowAmount The new amount of the loan, denominated in the token of the source's accounting
    /// context.
    /// @param newCollateralCount The new amount of collateral to back the loan with.
    /// @param sourceFeeAmount The fee amount taken from the revnet acting as the source of the loan.
    /// @param beneficiary The address to receive the returned collateral and any tokens resulting from paying fees.
    /// @param holder The address whose tokens to use as collateral (burned).
    function _adjust(
        REVLoan storage loan,
        uint256 revnetId,
        uint256 newBorrowAmount,
        uint256 newCollateralCount,
        uint256 sourceFeeAmount,
        address payable beneficiary,
        address holder
    )
        internal
    {
        // Cache frequently-read storage fields to avoid repeated SLOAD.
        address sourceToken = loan.sourceToken;

        // Snapshot deltas from current state before writing.
        uint256 addedBorrowAmount = newBorrowAmount > loan.amount ? newBorrowAmount - loan.amount : 0;
        uint256 repaidBorrowAmount = loan.amount > newBorrowAmount ? loan.amount - newBorrowAmount : 0;
        uint256 addedCollateralCount = newCollateralCount > loan.collateral ? newCollateralCount - loan.collateral : 0;
        uint256 returnedCollateralCount =
            loan.collateral > newCollateralCount ? loan.collateral - newCollateralCount : 0;

        // EFFECTS: Write loan state before any external calls (CEI pattern).
        // Any reentrant call will see the updated loan values, reverting on overflow.
        if (newBorrowAmount > type(uint112).max) revert REVLoans_OverflowAlert(newBorrowAmount, type(uint112).max);
        if (newCollateralCount > type(uint112).max) {
            revert REVLoans_OverflowAlert({value: newCollateralCount, limit: type(uint112).max});
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        loan.amount = uint112(newBorrowAmount);
        // forge-lint: disable-next-line(unsafe-typecast)
        loan.collateral = uint112(newCollateralCount);

        // INTERACTIONS: Execute external calls with pre-computed deltas.

        // Burn newly added collateral before pulling source funds so fee-project token mints from the borrow cannot
        // be used as same-transaction collateral.
        if (addedCollateralCount > 0) {
            _addCollateralTo({revnetId: revnetId, amount: addedCollateralCount, holder: holder});
        }

        // Add to the loan if needed...
        if (addedBorrowAmount > 0) {
            _addTo({
                loan: loan,
                revnetId: revnetId,
                addedBorrowAmount: addedBorrowAmount,
                sourceFeeAmount: sourceFeeAmount,
                beneficiary: beneficiary
            });
            // ... or pay off the loan if needed.
        } else if (repaidBorrowAmount > 0) {
            _removeFrom({loan: loan, revnetId: revnetId, repaidBorrowAmount: repaidBorrowAmount});
        }

        // Return collateral if needed.
        if (returnedCollateralCount > 0) {
            _returnCollateralFrom({
                revnetId: revnetId, collateralCount: returnedCollateralCount, beneficiary: beneficiary
            });
        }

        // Try to pay the source fee. If it fails, transfer the amount to the beneficiary instead.
        if (sourceFeeAmount > 0) {
            if (!_tryPayFee({
                    terminal: TERMINAL,
                    projectId: revnetId,
                    token: sourceToken,
                    amount: sourceFeeAmount,
                    beneficiary: beneficiary,
                    metadataProjectId: REV_ID
                })) {
                _transferFrom({from: address(this), to: beneficiary, token: sourceToken, amount: sourceFeeAmount});
            }
        }
    }

    /// @notice Logic to trigger before transferring tokens from this contract.
    /// @param to The address to transfer to.
    /// @param token The token to transfer.
    /// @param amount The number of tokens to transfer, as a fixed point number with the same number of decimals
    /// as the token specifies.
    /// @return payValue The value to attach to the transaction.
    function _beforeTransferTo(address to, address token, uint256 amount) internal returns (uint256) {
        // If the token is the native token, no allowance needed.
        if (token == JBConstants.NATIVE_TOKEN) return amount;
        IERC20(token).safeIncreaseAllowance({spender: to, value: amount});
        return 0;
    }

    /// @notice Clear any token allowance granted by `_beforeTransferTo`.
    /// @param to The address that was granted the allowance.
    /// @param token The token whose allowance to clear.
    function _afterTransferTo(address to, address token) internal {
        if (token == JBConstants.NATIVE_TOKEN) return;
        IERC20(token).forceApprove({spender: to, value: 0});
    }

    /// @notice Internal implementation of loan creation, without the OPEN_LOAN permission check.
    /// @dev Called by `borrowFrom` (after its own permission check) and by `reallocateCollateralFromLoan`
    /// (which only requires REALLOCATE_LOAN permission).
    /// @param revnetId The ID of the revnet to borrow from.
    /// @param token The token to borrow.
    /// @param minBorrowAmount The minimum amount to borrow.
    /// @param collateralCount The amount of tokens to use as collateral for the loan.
    /// @param beneficiary The address that will receive the borrowed funds and fee payment tokens.
    /// @param prepaidFeePercent The fee percent to charge upfront.
    /// @param holder The address whose tokens to use as collateral and who receives the loan NFT.
    /// @return loanId The ID of the loan created.
    /// @return loan The loan created.
    function _borrowFrom(
        uint256 revnetId,
        address token,
        uint256 minBorrowAmount,
        uint256 collateralCount,
        address payable beneficiary,
        uint256 prepaidFeePercent,
        address holder
    )
        internal
        returns (uint256 loanId, REVLoan memory)
    {
        // A loan needs to have collateral.
        if (collateralCount == 0) revert REVLoans_ZeroCollateralLoanIsInvalid({collateralCount: collateralCount});

        // Cache the current ruleset once — used by source validation, _cashOutDelayOf, and _borrowAmountFrom.
        JBRuleset memory currentRuleset = _currentRulesetOf(revnetId);

        // Make sure the token's accounting context exists on the canonical multi terminal for this revnet. An
        // unaccepted token reads as an empty accounting context from the terminal store, which must not be treated as
        // a valid zero-decimal/zero-currency loan source.
        JBAccountingContext memory context = TERMINAL.accountingContextForTokenOf({projectId: revnetId, token: token});
        if (context.token != token) revert REVLoans_InvalidAccountingContext({revnetId: revnetId, token: token});

        // Make sure the prepaid fee percent is between `MIN_PREPAID_FEE_PERCENT` and `MAX_PREPAID_FEE_PERCENT`.
        // The maximum prepaid fee covers the full 10-year liquidation duration with a 50% payment.
        if (prepaidFeePercent < MIN_PREPAID_FEE_PERCENT || prepaidFeePercent > MAX_PREPAID_FEE_PERCENT) {
            revert REVLoans_InvalidPrepaidFeePercent({
                prepaidFeePercent: prepaidFeePercent, min: MIN_PREPAID_FEE_PERCENT, max: MAX_PREPAID_FEE_PERCENT
            });
        }

        // Enforce the cash out delay.
        {
            uint256 cashOutDelay = _cashOutDelayOf({revnetId: revnetId, currentRuleset: currentRuleset});
            // forge-lint: disable-next-line(block-timestamp)
            if (cashOutDelay > block.timestamp) {
                revert REVLoans_CashOutDelayNotFinished({cashOutDelay: cashOutDelay, blockTimestamp: block.timestamp});
            }
        }

        // Get a reference to the loan ID.
        loanId = _nextLoanIdFor(revnetId);

        // Get a reference to the loan being created.
        REVLoan storage loan = _loanOf[loanId];

        // Set the loan's values.
        loan.sourceToken = token;
        loan.createdAt = uint48(block.timestamp);
        // forge-lint: disable-next-line(unsafe-typecast)
        loan.prepaidFeePercent = uint16(prepaidFeePercent);
        loan.prepaidDuration =
            uint32(mulDiv({x: prepaidFeePercent, y: LOAN_LIQUIDATION_DURATION, denominator: MAX_PREPAID_FEE_PERCENT}));

        // Get the amount of the loan, using the cached ruleset. Opening a borrow draws these funds from the terminal,
        // so cap the amount at the live treasury surplus to keep it executable in the current state.
        (uint256 borrowableCapacity, uint256 liveTreasurySurplus) = _borrowAmountFrom({
            loan: loan, revnetId: revnetId, collateralCount: collateralCount, currentRuleset: currentRuleset
        });
        uint256 borrowAmount = borrowableCapacity > liveTreasurySurplus ? liveTreasurySurplus : borrowableCapacity;

        // Revert if the bonding curve returns zero to prevent creating zero-amount loans.
        if (borrowAmount == 0) {
            revert REVLoans_ZeroBorrowAmount({revnetId: revnetId, collateralCount: collateralCount});
        }

        // Make sure the minimum borrow amount is met.
        if (borrowAmount < minBorrowAmount) revert REVLoans_UnderMinBorrowAmount(minBorrowAmount, borrowAmount);

        // Get the amount of additional fee to take for the revnet issuing the loan.
        uint256 sourceFeeAmount = JBFees.feeAmountFrom({amountBeforeFee: borrowAmount, feePercent: prepaidFeePercent});

        // Borrow the amount.
        _adjust({
            loan: loan,
            revnetId: revnetId,
            newBorrowAmount: borrowAmount,
            newCollateralCount: collateralCount,
            sourceFeeAmount: sourceFeeAmount,
            beneficiary: beneficiary,
            holder: holder
        });

        // Mint the loan NFT to the holder.
        _mint({to: holder, tokenId: loanId});

        emit Borrow({
            loanId: loanId,
            revnetId: revnetId,
            loan: loan,
            token: token,
            borrowAmount: borrowAmount,
            collateralCount: collateralCount,
            sourceFeeAmount: sourceFeeAmount,
            beneficiary: beneficiary,
            caller: _msgSender()
        });

        return (loanId, loan);
    }

    /// @notice Allocate the next loan ID for a revnet.
    /// @param revnetId The ID of the revnet.
    /// @return loanId The allocated loan ID.
    function _nextLoanIdFor(uint256 revnetId) internal returns (uint256 loanId) {
        uint256 loanNumber = totalLoansBorrowedFor[revnetId] + 1;
        if (loanNumber > _MAX_LOAN_NUMBER) {
            revert REVLoans_LoanIdOverflow({
                revnetId: revnetId, loanNumber: loanNumber, maxLoanNumber: _MAX_LOAN_NUMBER
            });
        }
        totalLoansBorrowedFor[revnetId] = loanNumber;
        return _generateLoanId({revnetId: revnetId, loanNumber: loanNumber});
    }

    /// @notice Reallocate collateral from a loan by making a new loan based on the original, with reduced collateral.
    /// @param loanId The ID of the loan to reallocate collateral from.
    /// @param revnetId The ID of the revnet the loan is from.
    /// @param collateralCountToRemove The amount of collateral to remove from the loan.
    /// @return reallocatedLoanId The ID of the reallocated loan.
    /// @return reallocatedLoan The reallocated loan.
    function _reallocateCollateralFromLoan(
        uint256 loanId,
        uint256 revnetId,
        uint256 collateralCountToRemove,
        address loanOwner
    )
        internal
        returns (uint256 reallocatedLoanId, REVLoan storage reallocatedLoan)
    {
        // Burn the original loan.
        _burn(loanId);

        // Keep a reference to loan having its collateral reduced.
        REVLoan storage loan = _loanOf[loanId];

        // Make sure there is enough collateral to transfer.
        if (collateralCountToRemove > loan.collateral) {
            revert REVLoans_NotEnoughCollateral({
                collateralCountToRemove: collateralCountToRemove, loanCollateral: loan.collateral
            });
        }

        // Keep a reference to the new collateral amount.
        uint256 newCollateralCount = loan.collateral - collateralCountToRemove;

        // Cache the current ruleset for borrow amount calculation.
        JBRuleset memory currentRuleset = _currentRulesetOf(revnetId);

        // Keep a reference to the new borrow amount. This is a solvency check on the reduced collateral against the
        // existing debt — the loan's amount is unchanged and no fresh funds are drawn — so it uses the economic
        // ceiling and ignores the live treasury surplus.
        (uint256 borrowAmount,) = _borrowAmountFrom({
            loan: loan, revnetId: revnetId, collateralCount: newCollateralCount, currentRuleset: currentRuleset
        });

        // Make sure the borrow amount is not less than the original loan's amount.
        if (borrowAmount < loan.amount) {
            revert REVLoans_ReallocatingMoreCollateralThanBorrowedAmountAllows({
                newBorrowAmount: borrowAmount, loanAmount: loan.amount
            });
        }

        // Get a reference to the replacement loan ID.
        reallocatedLoanId = _nextLoanIdFor(revnetId);

        // Get a reference to the loan being created.
        reallocatedLoan = _loanOf[reallocatedLoanId];

        // Set the reallocated loan's values the same as the original loan.
        reallocatedLoan.amount = loan.amount;
        reallocatedLoan.collateral = loan.collateral;
        reallocatedLoan.createdAt = loan.createdAt;
        reallocatedLoan.prepaidFeePercent = loan.prepaidFeePercent;
        reallocatedLoan.prepaidDuration = loan.prepaidDuration;
        reallocatedLoan.sourceToken = loan.sourceToken;

        // Reduce the collateral of the reallocated loan.
        _adjust({
            loan: reallocatedLoan,
            revnetId: revnetId,
            newBorrowAmount: reallocatedLoan.amount, // Don't change the borrow amount.
            newCollateralCount: newCollateralCount,
            sourceFeeAmount: 0,
            beneficiary: payable(loanOwner), // Return collateral to the loan owner, who will have the returned
            // collateral tokens debited from their balance for the new loan.
            holder: loanOwner // Only used if collateral is added (not the case here — collateral is being returned).
        });

        // Mint the replacement loan to the loan owner.
        _mint({to: loanOwner, tokenId: reallocatedLoanId});

        // Clear stale loan data for gas refund.
        delete _loanOf[loanId];

        emit ReallocateCollateral({
            loanId: loanId,
            revnetId: revnetId,
            reallocatedLoanId: reallocatedLoanId,
            reallocatedLoan: reallocatedLoan,
            removedCollateralCount: collateralCountToRemove,
            caller: _msgSender()
        });
    }

    /// @notice Pay off a loan.
    /// @param loan The loan to pay off.
    /// @param revnetId The ID of the revnet the loan is in.
    /// @param repaidBorrowAmount The amount to pay off, denominated in the token of the source's accounting
    /// context.
    function _removeFrom(REVLoan memory loan, uint256 revnetId, uint256 repaidBorrowAmount) internal {
        address sourceToken = loan.sourceToken;

        IJBMultiTerminal terminal = IJBMultiTerminal(address(TERMINAL));

        // Snapshot the credited terminal balance so fee-on-transfer source tokens cannot under-repay the revnet.
        uint256 balanceBefore = terminal.STORE().balanceOf(address(TERMINAL), revnetId, sourceToken);

        // Increase the allowance for the beneficiary.
        uint256 payValue = _beforeTransferTo({to: address(TERMINAL), token: sourceToken, amount: repaidBorrowAmount});

        // Add the loaned amount back to the revnet.
        TERMINAL.addToBalanceOf{value: payValue}({
            projectId: revnetId,
            token: sourceToken,
            amount: repaidBorrowAmount,
            shouldReturnHeldFees: false,
            memo: "",
            metadata: bytes(abi.encodePacked(REV_ID))
        });

        uint256 creditedAmount = terminal.STORE().balanceOf(address(TERMINAL), revnetId, sourceToken) - balanceBefore;

        if (creditedAmount != repaidBorrowAmount) {
            revert REVLoans_FeeOnTransferSourceUnsupported({
                token: sourceToken, expectedAmount: repaidBorrowAmount, creditedAmount: creditedAmount
            });
        }

        // Decrement the total amount of a token being loaned out by the revnet.
        totalBorrowedFrom[revnetId][sourceToken] -= repaidBorrowAmount;

        _afterTransferTo({to: address(TERMINAL), token: sourceToken});
    }

    /// @notice Pay down a loan.
    /// @param loanId The ID of the loan to pay down.
    /// @param loan The loan to pay down.
    /// @param repayBorrowAmount The amount to pay down, denominated in the token of the source's accounting context.
    /// @param sourceFeeAmount The fee amount taken from the revnet acting as the source of the loan.
    /// @param collateralCountToReturn The amount of collateral to return that the loan no longer requires.
    /// @param beneficiary The address to receive the returned collateral and any tokens resulting from paying fees.
    /// @param loanOwner The owner of the loan NFT (receives replacement loan if partial repay).
    function _repayLoan(
        uint256 loanId,
        REVLoan storage loan,
        uint256 revnetId,
        uint256 repayBorrowAmount,
        uint256 sourceFeeAmount,
        uint256 collateralCountToReturn,
        address payable beneficiary,
        address loanOwner
    )
        internal
        returns (uint256, REVLoan memory)
    {
        // Burn the original loan.
        _burn(loanId);

        // If the loan will carry no more amount or collateral, store its changes directly.
        if (collateralCountToReturn == loan.collateral) {
            // Snapshot the loan to memory BEFORE _adjust zeroes the storage pointer.
            REVLoan memory loanSnapshot = loan;

            // Borrow in.
            _adjust({
                loan: loan,
                revnetId: revnetId,
                newBorrowAmount: 0,
                newCollateralCount: 0,
                sourceFeeAmount: sourceFeeAmount,
                beneficiary: beneficiary,
                holder: _msgSender() // Only used if collateral is added (not the case here — collateral is returned).
            });

            // Snapshot the zeroed loan for the return value (reflects post-repay state).
            REVLoan memory paidOffSnapshot = loan;

            emit RepayLoan({
                loanId: loanId,
                revnetId: revnetId,
                paidOffLoanId: loanId,
                loan: loanSnapshot,
                paidOffLoan: paidOffSnapshot,
                repayBorrowAmount: repayBorrowAmount,
                sourceFeeAmount: sourceFeeAmount,
                collateralCountToReturn: collateralCountToReturn,
                beneficiary: beneficiary,
                caller: _msgSender()
            });

            // Clear stale loan data for gas refund.
            delete _loanOf[loanId];

            return (loanId, paidOffSnapshot);
        } else {
            // Get a reference to the replacement loan ID.
            uint256 paidOffLoanId = _nextLoanIdFor(revnetId);

            // Get a reference to the loan being paid off.
            REVLoan storage paidOffLoan = _loanOf[paidOffLoanId];

            // Copy the original loan's values. amount and collateral are written here so _adjust
            // can compute correct deltas, then _adjust overwrites them with the final values.
            paidOffLoan.amount = loan.amount;
            paidOffLoan.collateral = loan.collateral;
            paidOffLoan.createdAt = loan.createdAt;
            paidOffLoan.prepaidFeePercent = loan.prepaidFeePercent;
            paidOffLoan.prepaidDuration = loan.prepaidDuration;
            paidOffLoan.sourceToken = loan.sourceToken;

            // Mint the replacement loan to the loan owner FIRST so it exists before _adjust writes data.
            _mint({to: loanOwner, tokenId: paidOffLoanId});

            // Then adjust the loan data.
            _adjust({
                loan: paidOffLoan,
                revnetId: revnetId,
                newBorrowAmount: paidOffLoan.amount - (repayBorrowAmount - sourceFeeAmount),
                newCollateralCount: paidOffLoan.collateral - collateralCountToReturn,
                sourceFeeAmount: sourceFeeAmount,
                beneficiary: beneficiary,
                holder: _msgSender() // Only used if collateral is added (not the case here — collateral is returned).
            });

            emit RepayLoan({
                loanId: loanId,
                revnetId: revnetId,
                paidOffLoanId: paidOffLoanId,
                loan: loan,
                paidOffLoan: paidOffLoan,
                repayBorrowAmount: repayBorrowAmount,
                sourceFeeAmount: sourceFeeAmount,
                collateralCountToReturn: collateralCountToReturn,
                beneficiary: beneficiary,
                caller: _msgSender()
            });

            // Clear stale loan data for gas refund.
            delete _loanOf[loanId];

            return (paidOffLoanId, paidOffLoan);
        }
    }

    /// @notice Return collateral from a loan.
    /// @param revnetId The ID of the revnet the loan is in.
    /// @param collateralCount The amount of collateral to return from the loan.
    /// @param beneficiary The address to receive the returned collateral.
    function _returnCollateralFrom(uint256 revnetId, uint256 collateralCount, address payable beneficiary) internal {
        // Decrement the total amount of collateral tokens.
        totalCollateralOf[revnetId] -= collateralCount;

        // Mint the collateral tokens back to the loan payer.
        CONTROLLER.mintTokensOf({
            projectId: revnetId,
            tokenCount: collateralCount,
            beneficiary: beneficiary,
            memo: "",
            useReservedPercent: false
        });
    }

    /// @notice Transfer tokens.
    /// @param from The address to transfer tokens from.
    /// @param to The address to transfer tokens to.
    /// @param token The address of the token to transfer.
    /// @param amount The amount of tokens to transfer, as a fixed point number with the same number of decimals as the
    /// token.
    function _transferFrom(address from, address payable to, address token, uint256 amount) internal virtual {
        if (from == address(this)) {
            // If the token is native token, assume the `sendValue` standard.
            if (token == JBConstants.NATIVE_TOKEN) return Address.sendValue({recipient: to, amount: amount});

            // If the transfer is from this contract, use `safeTransfer`.
            return IERC20(token).safeTransfer({to: to, value: amount});
        }

        // If there's sufficient approval, transfer normally.
        if (IERC20(token).allowance({owner: address(from), spender: address(this)}) >= amount) {
            return IERC20(token).safeTransferFrom({from: from, to: to, value: amount});
        }

        // Make sure the amount being paid is less than the maximum permit2 allowance.
        if (amount > type(uint160).max) revert REVLoans_OverflowAlert(amount, type(uint160).max);

        // Otherwise, attempt to use the `permit2` method.
        // forge-lint: disable-next-line(unsafe-typecast)
        PERMIT2.transferFrom({from: from, to: to, amount: uint160(amount), token: token});
    }

    /// @notice Attempt to pay a fee to a terminal. On failure, cleans up the ERC-20 allowance and returns false.
    /// @param terminal The terminal to pay the fee to.
    /// @param projectId The project to pay the fee to.
    /// @param token The token to pay the fee with.
    /// @param amount The fee amount.
    /// @param beneficiary The address to credit for the fee payment.
    /// @param metadataProjectId The project ID to encode in the payment metadata.
    /// @return success Whether the fee was successfully paid.
    function _tryPayFee(
        IJBTerminal terminal,
        uint256 projectId,
        address token,
        uint256 amount,
        address beneficiary,
        uint256 metadataProjectId
    )
        internal
        returns (bool success)
    {
        uint256 payValue = _beforeTransferTo({to: address(terminal), token: token, amount: amount});

        try terminal.pay{value: payValue}({
            projectId: projectId,
            token: token,
            amount: amount,
            beneficiary: beneficiary,
            minReturnedTokens: 0,
            memo: "",
            metadata: bytes(abi.encodePacked(metadataProjectId))
        }) {
            success = true;
            _afterTransferTo({to: address(terminal), token: token});
        } catch (bytes memory) {
            if (token != JBConstants.NATIVE_TOKEN) {
                IERC20(token).safeDecreaseAllowance({spender: address(terminal), requestedDecrease: amount});
            }
        }
    }

    /// @notice Accepts calldata sent with native tokens so repayment helpers can refund or settle value.
    fallback() external payable {}

    /// @notice Accepts native tokens sent directly to the loan contract.
    receive() external payable {}
}
