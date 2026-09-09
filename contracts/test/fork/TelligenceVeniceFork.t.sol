// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TelligenceComputeVault} from "../../src/TelligenceComputeVault.sol";
import {TelligenceVaultState} from "../../src/enums/TelligenceVaultState.sol";
import {IVeniceStaking} from "../../src/interfaces/IVeniceStaking.sol";
import {IVeniceDiem} from "../../src/interfaces/IVeniceDiem.sol";
import {VaultPolicyMock} from "../helpers/VeniceMocks.sol";

/// @notice Read-only Base fork verification against real provider bytecode. No live transaction is broadcast.
/// @dev Requires RPC_BASE_MAINNET archive access; fail closed if the named endpoint is unavailable.
contract TelligenceVeniceForkTest is Test {
    IERC20 internal constant VVV = IERC20(0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf);
    IVeniceStaking internal constant STAKING = IVeniceStaking(0x321b7ff75154472B18EDb199033fF4D116F340Ff);
    IVeniceDiem internal constant DIEM = IVeniceDiem(0xF4d97F2da56e8c3098f3a8D538DB630A2606a024);
    address internal constant RESERVE = address(0xBEEF);
    VaultPolicyMock internal policy;
    TelligenceComputeVault internal vault;

    function setUp() public {
        vm.createSelectFork("base", 51_091_381);
        policy = new VaultPolicyMock(VVV, RESERVE);
        vault = new TelligenceComputeVault(address(policy), VVV, STAKING, DIEM, 1000e18, 7 days, address(0xA11CE));
        policy.bind(vault);
        deal(address(VVV), address(policy), 1000e18);
    }

    function test_RealVVVToStakedDiemAndCompleteReturn() public {
        uint256 amount = 90e18;
        uint256 quote = STAKING.getDiemAmountOut(amount);
        assertGt(quote, 0);
        policy.allocate(amount, quote);
        assertEq(vault.totalAllocated(), amount);
        (uint256 locked, uint256 debt) = STAKING.lockedStakes(address(vault));
        assertEq(locked, amount);
        assertEq(debt, quote);
        (uint256 staked,,) = DIEM.stakedInfos(address(vault));
        assertEq(staked, quote);
        assertEq(DIEM.balanceOf(address(vault)), 0);
        assertEq(VVV.allowance(address(vault), address(STAKING)), 0);

        policy.announceWinddown();
        vm.warp(vault.noticeEndsAt());
        vault.beginDiemUnstake();
        (, uint256 diemReady, uint256 pending) = DIEM.stakedInfos(address(vault));
        assertEq(pending, quote);
        vm.warp(diemReady);
        vault.claimDiemAndBeginVVVUnstake();
        (locked, debt) = STAKING.lockedStakes(address(vault));
        assertEq(locked, 0);
        assertEq(debt, 0);
        (, uint256 vvvReady, uint256 principal) = STAKING.stakes(address(vault));
        assertEq(principal, amount);
        vm.warp(vvvReady);
        vault.claimVVVAndReturn();
        assertGe(VVV.balanceOf(RESERVE), amount);
        assertEq(VVV.balanceOf(RESERVE), vault.totalReturned());
        assertEq(VVV.balanceOf(address(vault)), 0);
        assertEq(STAKING.balanceOf(address(vault)), 0);
        assertEq(uint8(vault.state()), uint8(TelligenceVaultState.Closed));
        assertFalse(vault.authenticationEnabled());
        assertTrue(vault.authenticationPermanentlyDisabled());
    }

    function test_RealProviderHonorsMinimumAndAtomicRollback() public {
        uint256 quote = STAKING.getDiemAmountOut(90e18);
        vm.expectRevert();
        policy.allocate(90e18, quote + 1);
        assertEq(vault.totalAllocated(), 0);
        assertEq(VVV.balanceOf(address(policy)), 1000e18);
        assertEq(STAKING.balanceOf(address(vault)), 0);
    }
}
