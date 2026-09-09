// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBCashOutTerminal} from "@bananapus/core-v6/src/interfaces/IJBCashOutTerminal.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IProjectComputeVault} from "./interfaces/IProjectComputeVault.sol";
import {IProjectPolicy} from "./interfaces/IProjectPolicy.sol";
import {TelligencePolicyConfig} from "./structs/TelligencePolicyConfig.sol";

/// @notice An immutable Revnet operator that converts only its own production into compute backing.
/// @dev There is no general execution, permission grant, split change, loan, bridge, or operator handoff surface.
contract ProjectPolicy is IProjectPolicy, ReentrancyGuard {
    using SafeERC20 for IERC20;

    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice The caller has no authority for this narrowly scoped action.
    error ProjectPolicy_Unauthorized();
    /// @notice Identity has already been bound and cannot be replaced.
    error ProjectPolicy_AlreadyBound();
    /// @notice Identity or execution limits are invalid.
    error ProjectPolicy_InvalidConfiguration();
    /// @notice No project has been bound by the factory.
    error ProjectPolicy_NotBound();
    /// @notice The execution deadline is expired or more than one hour ahead.
    error ProjectPolicy_InvalidDeadline();
    /// @notice The fixed cashout cadence has not elapsed.
    error ProjectPolicy_TooEarly();
    /// @notice A cashout differs from the prescribed economical batch.
    error ProjectPolicy_InvalidBatch();
    /// @notice Fresh investment is stopped by pause, winddown, or the lifetime cap.
    error ProjectPolicy_AllocationStopped();
    /// @notice An allocation is zero, exceeds held VVV, or exceeds the lifetime limit.
    error ProjectPolicy_AllocationLimit();
    /// @notice Received VVV does not satisfy the independently enforced output floor.
    error ProjectPolicy_InsufficientOutput();
    /// @notice No held VVV is eligible to return under the immutable policy.
    error ProjectPolicy_NothingToReturn();

    //*********************************************************************//
    // ------------------------- public constants ------------------------ //
    //*********************************************************************//

    /// @notice The largest execution lifetime accepted by transaction executors.
    uint256 public constant MAX_DEADLINE_WINDOW = 1 hours;

    //*********************************************************************//
    // --------------- public immutable stored properties ---------------- //
    //*********************************************************************//

    /// @notice The only address that can atomically bind the Revnet and vault.
    address public immutable FACTORY;
    /// @notice The project creator, with inference and pause authority only.
    address public immutable CREATOR;
    /// @notice The disclosed recovery authority, with no asset redirection power.
    address public immutable RECOVERY;
    /// @notice The stock Juicebox controller whose project-token balance is used.
    IJBController public immutable CONTROLLER;
    /// @notice The canonical stock terminal, permanently pinned at launch.
    IJBTerminal public immutable TERMINAL;
    /// @notice The sole accepted compute backing and accounting asset.
    IERC20 public immutable VVV;
    /// @notice Minimum elapsed seconds between successful conversion batches.
    uint256 public immutable conversionCadence;
    /// @notice Minimum economical production-token batch.
    uint256 public immutable minBatchTokens;
    /// @notice Maximum production-token batch per cadence.
    uint256 public immutable maxBatchTokens;
    /// @notice Maximum cumulative VVV committed to compute.
    uint256 public immutable maxPrincipal;

    //*********************************************************************//
    // --------------------- public stored properties -------------------- //
    //*********************************************************************//

    /// @inheritdoc IProjectPolicy
    uint256 public override revnetId;
    /// @inheritdoc IProjectPolicy
    address public override vault;
    /// @notice The next time a production batch may execute.
    uint256 public nextConversionAt;
    /// @notice VVV committed across all successful allocations, never reduced by returns.
    uint256 public totalAllocated;
    /// @notice Minimum VVV received per project token, scaled by 1e18; can only increase.
    uint256 public minVVVPerProjectToken;
    /// @notice Minimum DIEM minted per VVV, scaled by 1e18; can only increase.
    uint256 public minDiemPerVVV;
    /// @notice Whether fresh investment is reversibly paused.
    bool public allocationPaused;
    /// @notice Whether an irrevocable return-only winddown has been announced.
    bool public windingDown;

    //*********************************************************************//
    // -------------------------- constructor ---------------------------- //
    //*********************************************************************//

    /// @notice Pin all authorities, accounting addresses, and economic limits.
    /// @param factory The atomic deployment factory.
    /// @param creator The creator with inference and pause authority.
    /// @param recovery The recovery authority with return-only powers.
    /// @param controller The stock project controller.
    /// @param terminal The canonical VVV terminal.
    /// @param vvv The canonical VVV asset checked by the factory.
    /// @param configuration The disclosed investment limits.
    constructor(
        address factory,
        address creator,
        address recovery,
        IJBController controller,
        IJBTerminal terminal,
        IERC20 vvv,
        TelligencePolicyConfig memory configuration
    ) {
        if (
            factory == address(0) || creator == address(0) || recovery == address(0)
                || address(controller) == address(0) || address(terminal) == address(0) || address(vvv) == address(0)
                || configuration.conversionCadence < 1 hours || configuration.conversionCadence > 30 days
                || configuration.minBatchTokens == 0 || configuration.maxBatchTokens < configuration.minBatchTokens
                || configuration.minVVVPerProjectToken == 0 || configuration.minDiemPerVVV == 0
                || configuration.maxPrincipal == 0
        ) revert ProjectPolicy_InvalidConfiguration();

        FACTORY = factory;
        CREATOR = creator;
        RECOVERY = recovery;
        CONTROLLER = controller;
        TERMINAL = terminal;
        VVV = vvv;
        conversionCadence = configuration.conversionCadence;
        minBatchTokens = configuration.minBatchTokens;
        maxBatchTokens = configuration.maxBatchTokens;
        maxPrincipal = configuration.maxPrincipal;
        minVVVPerProjectToken = configuration.minVVVPerProjectToken;
        minDiemPerVVV = configuration.minDiemPerVVV;
    }

    //*********************************************************************//
    // ---------------------- external transactions ---------------------- //
    //*********************************************************************//

    /// @inheritdoc IProjectPolicy
    function allocate(uint256 vvvAmount, uint256 deadline) external override nonReentrant {
        _requireInvesting(deadline);
        if (vvvAmount == 0 || vvvAmount > maxPrincipal - totalAllocated || vvvAmount > VVV.balanceOf(address(this))) {
            revert ProjectPolicy_AllocationLimit();
        }

        // Commit before the call; a failed provider operation rolls back the ledger and approval together.
        totalAllocated += vvvAmount;
        uint256 minDiemOut = Math.mulDiv(vvvAmount, minDiemPerVVV, 1e18, Math.Rounding.Ceil);
        VVV.forceApprove({spender: vault, value: vvvAmount});
        IProjectComputeVault(vault).allocate({vvvAmount: vvvAmount, minDiemOut: minDiemOut});
        VVV.forceApprove({spender: vault, value: 0});
        emit Allocate({revnetId: revnetId, vvvAmount: vvvAmount, totalAllocated: totalAllocated});
    }

    /// @inheritdoc IProjectPolicy
    function announceWinddown() external override nonReentrant {
        _requireAuthority();
        _requireBound();
        if (windingDown) revert ProjectPolicy_AllocationStopped();

        // Irrevocable notice stops both conversions and investment, independently of pause state.
        windingDown = true;
        IProjectComputeVault(vault).announceWinddown();
        emit AnnounceWinddown({revnetId: revnetId, caller: msg.sender});
    }

    /// @inheritdoc IProjectPolicy
    function bind(uint256 projectId, address computeVault) external override {
        if (msg.sender != FACTORY) revert ProjectPolicy_Unauthorized();
        if (revnetId != 0) revert ProjectPolicy_AlreadyBound();
        if (
            projectId == 0 || computeVault.code.length == 0
                || IProjectComputeVault(computeVault).POLICY() != address(this)
                || address(IProjectComputeVault(computeVault).VVV()) != address(VVV)
        ) revert ProjectPolicy_InvalidConfiguration();

        // No external user can claim this deployment between creation and its factory's binding call.
        revnetId = projectId;
        vault = computeVault;
        emit Bind({revnetId: projectId, vault: computeVault});
    }

    /// @inheritdoc IProjectPolicy
    function burnLateProduction() external override nonReentrant {
        _requireBound();
        if (!windingDown && totalAllocated != maxPrincipal) revert ProjectPolicy_AllocationStopped();
        uint256 count = CONTROLLER.TOKENS().totalBalanceOf({holder: address(this), projectId: revnetId});
        if (count == 0) revert ProjectPolicy_InvalidBatch();

        // Late production improves remaining holders' share without restarting compute or withdrawing reserve.
        CONTROLLER.burnTokensOf({holder: address(this), projectId: revnetId, tokenCount: count, memo: ""});
    }

    /// @inheritdoc IProjectPolicy
    function cashOutProduction(
        uint256 tokenCount,
        uint256 deadline
    )
        external
        override
        nonReentrant
        returns (uint256 vvvReceived)
    {
        _requireInvesting(deadline);
        if (block.timestamp < nextConversionAt) revert ProjectPolicy_TooEarly();
        uint256 held = CONTROLLER.TOKENS().totalBalanceOf({holder: address(this), projectId: revnetId});
        if (tokenCount < minBatchTokens || tokenCount != Math.min(held, maxBatchTokens)) {
            revert ProjectPolicy_InvalidBatch();
        }

        // Keepers cannot choose many tiny batches or consume the same cadence through reentrant hooks.
        nextConversionAt = block.timestamp + conversionCadence;
        uint256 beforeBalance = VVV.balanceOf(address(this));
        IJBCashOutTerminal(address(TERMINAL))
            .cashOutTokensOf({
            holder: address(this),
            projectId: revnetId,
            cashOutCount: tokenCount,
            tokenToReclaim: address(VVV),
            minTokensReclaimed: 0,
            beneficiary: payable(address(this)),
            metadata: ""
        });

        // The standard buyback hook can send VVV directly while the terminal reports zero reclaimed reserve.
        vvvReceived = VVV.balanceOf(address(this)) - beforeBalance;
        uint256 minimum = Math.mulDiv(tokenCount, minVVVPerProjectToken, 1e18, Math.Rounding.Ceil);
        if (vvvReceived < minimum) revert ProjectPolicy_InsufficientOutput();
        emit CashOutProduction({
            revnetId: revnetId, tokenCount: tokenCount, vvvReceived: vvvReceived, caller: msg.sender
        });
    }

    /// @inheritdoc IProjectPolicy
    function raiseMinimumOutputs(uint256 vvvFloor, uint256 diemFloor) external override {
        _requireAuthority();
        if (vvvFloor < minVVVPerProjectToken || diemFloor < minDiemPerVVV) {
            revert ProjectPolicy_InvalidConfiguration();
        }
        minVVVPerProjectToken = vvvFloor;
        minDiemPerVVV = diemFloor;
        emit RaiseMinimumOutputs({minVVVPerProjectToken: vvvFloor, minDiemPerVVV: diemFloor});
    }

    /// @inheritdoc IProjectPolicy
    function returnToRevnet(uint256 amount) external override nonReentrant {
        if (msg.sender != vault || vault == address(0)) revert ProjectPolicy_Unauthorized();
        if (amount == 0) revert ProjectPolicy_NothingToReturn();

        // Exact approved pulls distinguish recovered value from unrelated donations already held here.
        VVV.safeTransferFrom({from: vault, to: address(this), value: amount});
        _returnToRevnet(amount);
    }

    /// @inheritdoc IProjectPolicy
    function returnUnallocatedVVV() external override nonReentrant {
        _requireBound();
        uint256 balance = VVV.balanceOf(address(this));
        uint256 remaining = windingDown ? 0 : maxPrincipal - totalAllocated;
        if (balance <= remaining) revert ProjectPolicy_NothingToReturn();
        _returnToRevnet(balance - remaining);
    }

    /// @inheritdoc IProjectPolicy
    function setAllocationPaused(bool paused) external override {
        _requireAuthority();
        allocationPaused = paused;
        emit SetAllocationPaused({paused: paused, caller: msg.sender});
    }

    /// @inheritdoc IProjectPolicy
    function setAuthenticationEnabled(bool enabled) external override nonReentrant {
        _requireAuthority();
        _requireBound();
        IProjectComputeVault(vault).setAuthenticationEnabled(enabled);
    }

    /// @inheritdoc IProjectPolicy
    function setInferenceSigner(address signer) external override nonReentrant {
        _requireAuthority();
        _requireBound();
        IProjectComputeVault(vault).setInferenceSigner(signer);
    }

    //*********************************************************************//
    // ---------------------- internal transactions ---------------------- //
    //*********************************************************************//

    /// @notice Add an exact amount to the permanently bound Revnet without minting project tokens.
    /// @param amount VVV held here and eligible for return.
    function _returnToRevnet(uint256 amount) internal {
        VVV.forceApprove({spender: address(TERMINAL), value: amount});
        TERMINAL.addToBalanceOf({
            projectId: revnetId,
            token: address(VVV),
            amount: amount,
            shouldReturnHeldFees: true,
            memo: "Telligence compute return",
            metadata: ""
        });
        VVV.forceApprove({spender: address(TERMINAL), value: 0});
        emit ReturnToRevnet({revnetId: revnetId, amount: amount});
    }

    //*********************************************************************//
    // ----------------------- internal views ---------------------------- //
    //*********************************************************************//

    /// @notice Require the creator or the disclosed return-only recovery authority.
    function _requireAuthority() internal view {
        if (msg.sender != CREATOR && msg.sender != RECOVERY) revert ProjectPolicy_Unauthorized();
    }

    /// @notice Require immutable identity before any monetary operation.
    function _requireBound() internal view {
        if (revnetId == 0) revert ProjectPolicy_NotBound();
    }

    /// @notice Check state and caller-supplied expiry without giving the executor economic discretion.
    /// @param deadline The bounded execution expiry.
    function _requireInvesting(uint256 deadline) internal view {
        _requireBound();
        if (allocationPaused || windingDown || totalAllocated == maxPrincipal) {
            revert ProjectPolicy_AllocationStopped();
        }
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert ProjectPolicy_InvalidDeadline();
        }
    }
}
