// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {TelligenceVeniceAuth} from "./abstract/TelligenceVeniceAuth.sol";
import {TelligenceVaultState} from "./enums/TelligenceVaultState.sol";
import {ITelligenceVaultReturn} from "./interfaces/ITelligenceVaultReturn.sol";
import {IVeniceDiem} from "./interfaces/IVeniceDiem.sol";
import {IVeniceStaking} from "./interfaces/IVeniceStaking.sol";

/// @notice A project's return-only VVV endowment and Venice contract-wallet identity on Base.
/// @dev Owns the sVVV mint obligation and all DIEM throughout allocation and recovery. The policy may allocate funds,
/// pause, or announce closure; no account may choose an asset recipient, arbitrary approval, or call target.
/// Venice's owner can upgrade staking and change minting/cooldowns. These immutable restrictions do not remove that
/// trust.
contract TelligenceComputeVault is TelligenceVeniceAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    //*********************************************************************//
    // -------------------------- custom errors -------------------------- //
    //*********************************************************************//

    error TelligenceComputeVault_InvalidConfiguration();
    error TelligenceComputeVault_Unauthorized(address caller);
    error TelligenceComputeVault_InvalidState(TelligenceVaultState current, TelligenceVaultState required);
    error TelligenceComputeVault_AllocationPaused();
    error TelligenceComputeVault_InvalidAmount(uint256 amount, uint256 minimum);
    error TelligenceComputeVault_PrincipalLimit(uint256 allocated, uint256 amount, uint256 maximum);
    error TelligenceComputeVault_UnexpectedBalance(address token, uint256 expected, uint256 actual);
    error TelligenceComputeVault_UnexpectedPosition();
    error TelligenceComputeVault_Cooldown(uint256 currentTime, uint256 readyAt);
    error TelligenceComputeVault_NoDonatedStake();

    //*********************************************************************//
    // ------------------------------- events ---------------------------- //
    //*********************************************************************//

    event Allocated(uint256 vvvAmount, uint256 diemAmount, address indexed caller);
    event AllocationPauseSet(bool paused, address indexed caller);
    event WinddownAnnounced(uint256 noticeEndsAt, address indexed caller);
    event WinddownAdvanced(TelligenceVaultState state, address indexed caller);
    event ReturnedToRevnet(uint256 amount, address indexed caller);

    //*********************************************************************//
    // --------------- public immutable stored properties ---------------- //
    //*********************************************************************//

    /// @notice The immutable, return-only project policy. This is separate from the hosted inference signer.
    address public immutable POLICY;
    /// @notice The project's sole accounting token.
    IERC20 public immutable VVV;
    /// @notice The pinned Venice StakingV2 proxy, which also holds nontransferable sVVV receipts.
    IVeniceStaking public immutable STAKING;
    /// @notice The pinned DIEM ERC-20 and its built-in staking contract.
    IVeniceDiem public immutable DIEM;
    /// @notice The maximum cumulative VVV the policy may ever allocate to this versioned vault.
    uint256 public immutable MAX_PRINCIPAL;
    /// @notice The minimum public notice before compute backing begins recovery.
    uint256 public immutable WINDDOWN_NOTICE;

    //*********************************************************************//
    // ----------------------- public stored properties ------------------ //
    //*********************************************************************//

    TelligenceVaultState public state;
    uint256 public noticeEndsAt;
    /// @notice Cumulative VVV allocated through the policy, excluding rewards and unsolicited external gifts.
    uint256 public totalAllocated;
    /// @notice Cumulative realized VVV returned through the policy's `addToBalanceOf` path.
    uint256 public totalReturned;
    bool public allocationPaused;

    //*********************************************************************//
    // -------------------------- constructor ---------------------------- //
    //*********************************************************************//

    /// @param policy The already deployed project policy; it must have no ability to redirect recovered VVV.
    /// @param vvv The accounting ERC-20, verified by the canonical deployment factory.
    /// @param staking The Venice staking proxy whose underlying token and DIEM match these assets.
    /// @param diem The provider's DIEM token and staking implementation.
    /// @param maxPrincipal The cumulative allocation limit in VVV base units.
    /// @param winddownNotice The disclosed notice, between seven and thirty days.
    /// @param inferenceSigner The credential with narrowly scoped provider authentication authority.
    constructor(
        address policy,
        IERC20 vvv,
        IVeniceStaking staking,
        IVeniceDiem diem,
        uint256 maxPrincipal,
        uint256 winddownNotice,
        address inferenceSigner
    )
        TelligenceVeniceAuth(policy, inferenceSigner)
    {
        if (
            block.chainid != 8453 || policy.code.length == 0 || address(vvv).code.length == 0
                || address(staking).code.length == 0 || address(diem).code.length == 0 || maxPrincipal == 0
                || winddownNotice < 7 days || winddownNotice > 30 days
        ) revert TelligenceComputeVault_InvalidConfiguration();
        if (
            staking.venice() != address(vvv) || staking.diem() != address(diem)
                || IERC20Metadata(address(vvv)).decimals() != 18 || staking.decimals() != 18 || diem.decimals() != 18
        ) revert TelligenceComputeVault_InvalidConfiguration();
        POLICY = policy;
        VVV = vvv;
        STAKING = staking;
        DIEM = diem;
        MAX_PRINCIPAL = maxPrincipal;
        WINDDOWN_NOTICE = winddownNotice;
    }

    //*********************************************************************//
    // ------------------------- external views -------------------------- //
    //*********************************************************************//

    /// @notice Quote the provider's current mint curve. This is an estimate until an allocation is confirmed.
    function quoteDiem(uint256 vvvAmount) external view returns (uint256) {
        return STAKING.getDiemAmountOut(vvvAmount);
    }

    //*********************************************************************//
    // ---------------------- external transactions ---------------------- //
    //*********************************************************************//

    /// @notice Pull, stake, lock, mint, and stake a bounded amount atomically, keeping all positions at this address.
    /// @dev Staking and minting implicitly claim VVV rewards. Those remain liquid for a separate return transaction,
    /// never compound silently and never call back into the policy while its allocation guard is entered.
    function allocate(uint256 vvvAmount, uint256 minDiemOut) external nonReentrant {
        _requirePolicy();
        _requireState(TelligenceVaultState.Active);
        if (allocationPaused) revert TelligenceComputeVault_AllocationPaused();
        if (vvvAmount == 0 || minDiemOut == 0) {
            revert TelligenceComputeVault_InvalidAmount({amount: vvvAmount, minimum: minDiemOut});
        }
        if (vvvAmount > MAX_PRINCIPAL - totalAllocated) {
            revert TelligenceComputeVault_PrincipalLimit({
                allocated: totalAllocated, amount: vvvAmount, maximum: MAX_PRINCIPAL
            });
        }
        totalAllocated += vvvAmount;
        uint256 liquidBefore = VVV.balanceOf(address(this));
        VVV.safeTransferFrom({from: POLICY, to: address(this), value: vvvAmount});
        _requireBalance({token: VVV, expected: liquidBefore + vvvAmount});
        uint256 stakeBefore = STAKING.balanceOf(address(this));
        VVV.forceApprove({spender: address(STAKING), value: vvvAmount});
        STAKING.stake({recipient: address(this), amount: vvvAmount});
        VVV.forceApprove({spender: address(STAKING), value: 0});
        _requireBalance({token: IERC20(address(STAKING)), expected: stakeBefore + vvvAmount});
        (uint256 lockedBefore, uint256 debtBefore) = STAKING.lockedStakes(address(this));
        uint256 diemBefore = DIEM.balanceOf(address(this));
        STAKING.mintDiem({sVVVAmountToLock: vvvAmount, minDiemAmountOut: minDiemOut});
        uint256 minted = DIEM.balanceOf(address(this)) - diemBefore;
        (uint256 lockedAfter, uint256 debtAfter) = STAKING.lockedStakes(address(this));
        if (minted < minDiemOut || lockedAfter != lockedBefore + vvvAmount || debtAfter != debtBefore + minted) {
            revert TelligenceComputeVault_UnexpectedPosition();
        }
        (uint256 stakedBefore,, uint256 pendingBefore) = DIEM.stakedInfos(address(this));
        if (pendingBefore != 0) revert TelligenceComputeVault_UnexpectedPosition();
        DIEM.stake(minted);
        (uint256 stakedAfter,, uint256 pendingAfter) = DIEM.stakedInfos(address(this));
        if (stakedAfter != stakedBefore + minted || pendingAfter != 0) {
            revert TelligenceComputeVault_UnexpectedPosition();
        }
        _requireBalance({token: IERC20(address(DIEM)), expected: diemBefore});
        emit Allocated({vvvAmount: vvvAmount, diemAmount: minted, caller: msg.sender});
    }

    /// @notice Pause only new deployment of compute backing; prescribed recovery always remains callable.
    function setAllocationPaused(bool paused) external {
        _requirePolicy();
        allocationPaused = paused;
        emit AllocationPauseSet({paused: paused, caller: msg.sender});
    }

    /// @notice Irreversibly begin the disclosed notice period. Authentication continues until unstaking starts.
    function announceWinddown() external nonReentrant {
        _requirePolicy();
        _requireState(TelligenceVaultState.Active);
        state = TelligenceVaultState.Notice;
        noticeEndsAt = block.timestamp + WINDDOWN_NOTICE;
        emit WinddownAnnounced({noticeEndsAt: noticeEndsAt, caller: msg.sender});
    }

    /// @notice After notice, disable authentication forever and start the one DIEM cooldown for all retained mint debt.
    function beginDiemUnstake() external nonReentrant {
        _requireState(TelligenceVaultState.Notice);
        _requireMature(noticeEndsAt);
        _disableAuthentication();
        state = TelligenceVaultState.DiemCooldown;
        (uint256 amount,, uint256 pending) = DIEM.stakedInfos(address(this));
        if (pending != 0) revert TelligenceComputeVault_UnexpectedPosition();
        if (amount != 0) DIEM.initiateUnstake(amount);
        emit WinddownAdvanced({state: state, caller: msg.sender});
    }

    /// @notice Claim DIEM, burn the complete aggregate obligation to release every rounding unit, then unstake all
    /// sVVV. @dev Venice records one weighted-average position per account, not independently redeemable mint lots.
    function claimDiemAndBeginVVVUnstake() external nonReentrant {
        _requireState(TelligenceVaultState.DiemCooldown);
        (uint256 stillStaked, uint256 readyAt, uint256 pending) = DIEM.stakedInfos(address(this));
        if (stillStaked != 0) revert TelligenceComputeVault_UnexpectedPosition();
        if (pending != 0) {
            _requireMature(readyAt);
            DIEM.unstake();
        }
        (, uint256 debt) = STAKING.lockedStakes(address(this));
        if (debt != 0) STAKING.burnDiem(debt);
        (uint256 lockedAfter, uint256 debtAfter) = STAKING.lockedStakes(address(this));
        if (lockedAfter != 0 || debtAfter != 0) revert TelligenceComputeVault_UnexpectedPosition();
        _beginVVVUnstake();
    }

    /// @notice Finalize the actual provider cooldown and return every liquid VVV only to this project's reserve.
    /// @dev If the terminal fails, the whole transaction rolls back and anybody can retry without duplicate payment.
    function claimVVVAndReturn() external nonReentrant {
        _requireState(TelligenceVaultState.VVVCooldown);
        (, uint256 readyAt, uint256 pending) = STAKING.stakes(address(this));
        if (pending != 0) {
            _requireMature(readyAt);
            STAKING.finalizeUnstake();
        }
        state = TelligenceVaultState.Closed;
        _returnLiquidVVV();
        emit WinddownAdvanced({state: state, caller: msg.sender});
    }

    /// @notice Recover sVVV that third parties stake to the vault after closure, without reopening compute.
    /// @dev Venice permits `stake(vault, amount)` by anyone. Gifts must not permanently prevent closing a position.
    function recoverDonatedStake() external nonReentrant {
        _requireState(TelligenceVaultState.Closed);
        if (STAKING.balanceOfUnlocked(address(this)) == 0) revert TelligenceComputeVault_NoDonatedStake();
        _beginVVVUnstake();
    }

    /// @notice Realize rewards and return the complete liquid VVV balance without issuing Revnet tokens.
    function claimRewardsAndReturn() external nonReentrant {
        STAKING.claim();
        _returnLiquidVVV();
    }

    /// @notice Return already realized rewards, unsolicited VVV, or recovered principal without relying on a provider
    /// claim.
    function returnLiquidVVV() external nonReentrant {
        _returnLiquidVVV();
    }

    //*********************************************************************//
    // -------------------------- internal views ------------------------- //
    //*********************************************************************//

    /// @notice Enforces the disclosed cutoff even if every keeper is offline when notice expires.
    /// @dev The provider must independently revoke cached sessions; this controls fresh ERC-1271 validation.
    function _authenticationAllowed() internal view override returns (bool) {
        if (state == TelligenceVaultState.Active) return true;
        // This declared multi-day cutoff is an access policy, not a source of randomness.
        // forge-lint: disable-next-line(block-timestamp)
        return state == TelligenceVaultState.Notice && block.timestamp < noticeEndsAt;
    }

    //*********************************************************************//
    // ------------------------- private helpers ------------------------- //
    //*********************************************************************//

    function _beginVVVUnstake() private {
        (,, uint256 pending) = STAKING.stakes(address(this));
        if (pending != 0) revert TelligenceComputeVault_UnexpectedPosition();
        state = TelligenceVaultState.VVVCooldown;
        uint256 amount = STAKING.balanceOfUnlocked(address(this));
        if (amount != 0) STAKING.initiateUnstake(amount);
        emit WinddownAdvanced({state: state, caller: msg.sender});
    }

    function _returnLiquidVVV() private {
        uint256 amount = VVV.balanceOf(address(this));
        if (amount == 0) return;
        totalReturned += amount;
        VVV.forceApprove({spender: POLICY, value: amount});
        ITelligenceVaultReturn(POLICY).returnToRevnet(amount);
        VVV.forceApprove({spender: POLICY, value: 0});
        _requireBalance({token: VVV, expected: 0});
        emit ReturnedToRevnet({amount: amount, caller: msg.sender});
    }

    function _requirePolicy() private view {
        if (msg.sender != POLICY) revert TelligenceComputeVault_Unauthorized(msg.sender);
    }

    function _requireState(TelligenceVaultState required) private view {
        if (state != required) revert TelligenceComputeVault_InvalidState({current: state, required: required});
    }

    function _requireBalance(IERC20 token, uint256 expected) private view {
        uint256 actual = token.balanceOf(address(this));
        if (actual != expected) {
            revert TelligenceComputeVault_UnexpectedBalance({token: address(token), expected: expected, actual: actual});
        }
    }

    function _requireMature(uint256 readyAt) private view {
        // Multi-day provider/notice deadlines are not meaningfully affected by a validator's timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < readyAt) {
            revert TelligenceComputeVault_Cooldown({currentTime: block.timestamp, readyAt: readyAt});
        }
    }
}
