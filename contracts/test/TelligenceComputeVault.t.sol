// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TelligenceComputeVault} from "../src/TelligenceComputeVault.sol";
import {IVeniceStaking} from "../src/interfaces/IVeniceStaking.sol";
import {IVeniceDiem} from "../src/interfaces/IVeniceDiem.sol";
import {TelligenceVaultState} from "../src/enums/TelligenceVaultState.sol";
import {VaultVVVMock, VaultDiemMock, VaultStakingMock, VaultPolicyMock} from "./helpers/VeniceMocks.sol";

contract TelligenceComputeVaultTest is Test {
    VaultVVVMock internal vvv;
    VaultDiemMock internal diem;
    VaultStakingMock internal staking;
    VaultPolicyMock internal policy;
    TelligenceComputeVault internal vault;
    address internal reserve = address(0xBEEF);
    address internal signer = address(0xA11CE);

    function setUp() public {
        vm.chainId(8453);
        vm.warp(1_800_000_000);
        vvv = new VaultVVVMock();
        diem = new VaultDiemMock();
        staking = new VaultStakingMock(vvv, diem);
        diem.setMinter(address(staking));
        policy = new VaultPolicyMock(vvv, reserve);
        vault = new TelligenceComputeVault(
            address(policy), vvv, IVeniceStaking(address(staking)), IVeniceDiem(address(diem)), 1000e18, 7 days, signer
        );
        policy.bind(vault);
        vvv.mint(address(policy), 1000e18);
    }

    function test_AllocateKeepsEveryPositionInVaultAndClearsApprovals() public {
        policy.allocate(90e18, 30e18);
        assertEq(vault.totalAllocated(), 90e18);
        assertEq(vvv.balanceOf(address(policy)), 910e18);
        assertEq(staking.balanceOf(address(vault)), 90e18);
        (uint256 locked, uint256 debt) = staking.lockedStakes(address(vault));
        assertEq(locked, 90e18);
        assertEq(debt, 30e18);
        (uint256 staked,, uint256 pending) = diem.stakedInfos(address(vault));
        assertEq(staked, 30e18);
        assertEq(pending, 0);
        assertEq(diem.balanceOf(address(vault)), 0);
        assertEq(vvv.allowance(address(vault), address(staking)), 0);
        assertEq(vvv.allowance(address(vault), address(policy)), 0);
        assertEq(vvv.balanceOf(signer), 0);
    }

    function test_MintFailureRollsBackVVVAndPosition() public {
        staking.setFailMint(true);
        vm.expectRevert();
        policy.allocate(90e18, 30e18);
        assertEq(vault.totalAllocated(), 0);
        assertEq(staking.balanceOf(address(vault)), 0);
        assertEq(vvv.balanceOf(address(policy)), 1000e18);
        assertEq(vvv.allowance(address(vault), address(staking)), 0);
    }

    function test_SlippageFailureRollsBackAllSteps() public {
        vm.expectRevert();
        policy.allocate(90e18, 31e18);
        assertEq(vvv.balanceOf(address(policy)), 1000e18);
        assertEq(staking.balanceOf(address(vault)), 0);
    }

    function test_BadStakingReceiptRevertsAtomically() public {
        staking.setBadStake(true);
        vm.expectRevert();
        policy.allocate(90e18, 29e18);
        assertEq(vvv.balanceOf(address(policy)), 1000e18);
    }

    function test_RejectsUnauthorizedAllocationAndShutdown() public {
        vm.expectRevert();
        vault.allocate(90e18, 30e18);
        vm.expectRevert();
        vault.announceWinddown();
        vm.expectRevert();
        vault.setAllocationPaused(true);
    }

    function test_RejectsZeroAmountOrMinimum() public {
        vm.expectRevert();
        policy.allocate(0, 1);
        vm.expectRevert();
        policy.allocate(3e18, 0);
    }

    function test_RejectsAllocationBeyondImmutableCap() public {
        policy.allocate(999e18, 333e18);
        vvv.mint(address(policy), 3e18);
        vm.expectRevert();
        policy.allocate(3e18, 1e18);
        assertEq(vault.totalAllocated(), 999e18);
    }

    function test_PauseBlocksAllocationButNotRewardsOrWinddown() public {
        policy.allocate(90e18, 30e18);
        policy.setAllocationPaused(true);
        vm.expectRevert();
        policy.allocate(3e18, 1e18);
        staking.setReward(address(vault), 2e18);
        vault.claimRewardsAndReturn();
        assertEq(vvv.balanceOf(reserve), 2e18);
        policy.announceWinddown();
        _finishWinddown();
        assertEq(vvv.balanceOf(reserve), 92e18);
    }

    function test_RewardsImplicitlyClaimedDuringStakeAreNotReallocated() public {
        policy.allocate(90e18, 30e18);
        staking.setReward(address(vault), 5e18);
        policy.allocate(60e18, 20e18);
        assertEq(vvv.balanceOf(address(vault)), 5e18);
        assertEq(vault.totalAllocated(), 150e18);
        vault.returnLiquidVVV();
        assertEq(vvv.balanceOf(reserve), 5e18);
        assertEq(vault.totalReturned(), 5e18);
    }

    function test_CompleteWinddownUsesAggregateDebtWithoutRoundingDust() public {
        policy.allocate(91e18, 30e18);
        staking.setRate(7e18);
        policy.allocate(83e18, 11e18);
        policy.announceWinddown();
        _finishWinddown();
        (uint256 locked, uint256 debt) = staking.lockedStakes(address(vault));
        assertEq(locked, 0);
        assertEq(debt, 0);
        assertEq(staking.balanceOf(address(vault)), 0);
        assertEq(vvv.balanceOf(reserve), 174e18);
        assertEq(uint8(vault.state()), uint8(TelligenceVaultState.Closed));
        assertEq(vvv.balanceOf(address(policy)), 826e18);
        assertEq(vvv.allowance(address(vault), address(policy)), 0);
    }

    function test_NoticeFreezesAllocationAndCannotRestartOrSkip() public {
        policy.allocate(90e18, 30e18);
        policy.announceWinddown();
        vm.expectRevert();
        policy.allocate(3e18, 1e18);
        vm.expectRevert();
        policy.announceWinddown();
        vm.expectRevert();
        vault.beginDiemUnstake();
        vm.expectRevert();
        vault.claimDiemAndBeginVVVUnstake();
        vm.expectRevert();
        vault.claimVVVAndReturn();
    }

    function test_ProviderCooldownsReadFromPositionsAndCannotReset() public {
        policy.allocate(90e18, 30e18);
        policy.announceWinddown();
        vm.warp(vault.noticeEndsAt());
        diem.setCooldownDuration(5 days);
        vault.beginDiemUnstake();
        (, uint256 diemEnd,) = diem.stakedInfos(address(vault));
        vm.expectRevert();
        vault.beginDiemUnstake();
        vm.warp(diemEnd - 1);
        vm.expectRevert();
        vault.claimDiemAndBeginVVVUnstake();
        vm.warp(diemEnd);
        staking.setCooldownDuration(10 days);
        vault.claimDiemAndBeginVVVUnstake();
        (, uint256 vvvEnd,) = staking.stakes(address(vault));
        vm.expectRevert();
        vault.claimDiemAndBeginVVVUnstake();
        vm.warp(vvvEnd - 1);
        vm.expectRevert();
        vault.claimVVVAndReturn();
        vm.warp(vvvEnd);
        vault.claimVVVAndReturn();
        vm.expectRevert();
        vault.claimVVVAndReturn();
        assertEq(vvv.balanceOf(reserve), 90e18);
    }

    function test_EmptyVaultCanCloseWithoutCallingZeroUnstake() public {
        policy.announceWinddown();
        _finishWinddown();
        assertEq(uint8(vault.state()), uint8(TelligenceVaultState.Closed));
    }

    function test_ReturnFailureCanRetryWithoutLossOrDuplicate() public {
        vvv.mint(address(vault), 3e18);
        policy.setRejectReturn(true);
        vm.expectRevert();
        vault.returnLiquidVVV();
        assertEq(vvv.balanceOf(address(vault)), 3e18);
        assertEq(vault.totalReturned(), 0);
        assertEq(vvv.allowance(address(vault), address(policy)), 0);
        policy.setRejectReturn(false);
        vault.returnLiquidVVV();
        vault.returnLiquidVVV();
        assertEq(vvv.balanceOf(reserve), 3e18);
        assertEq(vault.totalReturned(), 3e18);
    }

    function test_ReturnCallbackCannotReenter() public {
        vvv.mint(address(vault), 3e18);
        policy.setReenter(true);
        vm.expectRevert();
        vault.returnLiquidVVV();
        assertEq(vvv.balanceOf(address(vault)), 3e18);
        assertEq(vault.totalReturned(), 0);
    }

    function test_DonatedStakeAfterClosureRecoversWithoutReactivatingCompute() public {
        policy.allocate(90e18, 30e18);
        policy.announceWinddown();
        _finishWinddown();
        vvv.mint(address(this), 6e18);
        vvv.approve(address(staking), 6e18);
        staking.stake(address(vault), 6e18);
        vault.recoverDonatedStake();
        (, uint256 end,) = staking.stakes(address(vault));
        vm.warp(end);
        vault.claimVVVAndReturn();
        assertEq(vvv.balanceOf(reserve), 96e18);
        assertEq(vault.totalAllocated(), 90e18);
        vm.expectRevert();
        policy.allocate(3e18, 1e18);
    }

    function testFuzz_AllocationConservesPrincipalAndRecovery(uint96 amount) public {
        amount = uint96(bound(amount, 3e18, 1000e18));
        policy.allocate(amount, 1);
        policy.announceWinddown();
        _finishWinddown();
        assertEq(vvv.balanceOf(reserve), amount);
        assertEq(vvv.balanceOf(address(policy)) + vvv.balanceOf(reserve), 1000e18);
        assertEq(vvv.balanceOf(signer), 0);
    }

    function test_ConstructorRejectsWrongChainAndMismatchedAssets() public {
        vm.chainId(1);
        vm.expectRevert();
        new TelligenceComputeVault(
            address(policy), vvv, IVeniceStaking(address(staking)), IVeniceDiem(address(diem)), 1, 7 days, signer
        );
        vm.chainId(8453);
        VaultDiemMock other = new VaultDiemMock();
        vm.expectRevert();
        new TelligenceComputeVault(
            address(policy), vvv, IVeniceStaking(address(staking)), IVeniceDiem(address(other)), 1, 7 days, signer
        );
    }

    function test_ConstructorRejectsEOAPolicyAndUnsafeNotice() public {
        vm.expectRevert();
        new TelligenceComputeVault(
            signer, vvv, IVeniceStaking(address(staking)), IVeniceDiem(address(diem)), 1, 7 days, signer
        );
        vm.expectRevert();
        new TelligenceComputeVault(
            address(policy), vvv, IVeniceStaking(address(staking)), IVeniceDiem(address(diem)), 1, 6 days, signer
        );
        vm.expectRevert();
        new TelligenceComputeVault(
            address(policy), vvv, IVeniceStaking(address(staking)), IVeniceDiem(address(diem)), 0, 7 days, signer
        );
    }

    function test_DonatedDiemCannotInflateMintDebtOrPreventRecovery() public {
        policy.allocate(90e18, 30e18);
        vm.prank(address(staking));
        diem.mint(address(vault), 50e18);
        policy.announceWinddown();
        _finishWinddown();
        assertEq(vvv.balanceOf(reserve), 90e18);
        assertEq(diem.balanceOf(address(vault)), 50e18);
        (, uint256 debt) = staking.lockedStakes(address(vault));
        assertEq(debt, 0);
    }

    function test_InferenceSignerHasNoAssetOrPolicyAuthority() public {
        policy.allocate(90e18, 30e18);
        vm.startPrank(signer);
        vm.expectRevert();
        vault.allocate(3e18, 1e18);
        vm.expectRevert();
        vault.announceWinddown();
        vm.expectRevert();
        vault.setAllocationPaused(true);
        vm.expectRevert();
        vault.setInferenceSigner(signer);
        vm.expectRevert();
        vault.setAuthenticationEnabled(false);
        vm.expectRevert();
        vault.beginDiemUnstake();
        vm.stopPrank();
        assertEq(staking.balanceOf(address(vault)), 90e18);
    }

    function test_ClosingPermanentlyDisablesSignerWithoutReenable() public {
        policy.announceWinddown();
        assertTrue(vault.authenticationEnabled());
        vm.warp(vault.noticeEndsAt());
        vault.beginDiemUnstake();
        assertFalse(vault.authenticationEnabled());
        assertTrue(vault.authenticationPermanentlyDisabled());
        vm.prank(address(policy));
        vm.expectRevert();
        vault.setAuthenticationEnabled(true);
        vm.prank(address(policy));
        vm.expectRevert();
        vault.setInferenceSigner(signer);
    }

    function test_ProjectIsolationIncludesAllocationAndRecoveredPrincipal() public {
        address secondReserve = address(0xBEEF2);
        VaultPolicyMock secondPolicy = new VaultPolicyMock(vvv, secondReserve);
        TelligenceComputeVault secondVault = new TelligenceComputeVault(
            address(secondPolicy),
            vvv,
            IVeniceStaking(address(staking)),
            IVeniceDiem(address(diem)),
            300e18,
            7 days,
            signer
        );
        secondPolicy.bind(secondVault);
        vvv.mint(address(secondPolicy), 60e18);
        secondPolicy.allocate(60e18, 20e18);
        policy.allocate(90e18, 30e18);
        vm.prank(address(secondPolicy));
        vm.expectRevert();
        vault.allocate(3e18, 1e18);
        policy.announceWinddown();
        _finishWinddown();
        assertEq(vvv.balanceOf(reserve), 90e18);
        assertEq(vvv.balanceOf(secondReserve), 0);
        assertEq(staking.balanceOf(address(secondVault)), 60e18);
        assertEq(uint8(secondVault.state()), uint8(TelligenceVaultState.Active));
    }

    function test_NoticeExpiryRejectsFreshValidSignaturesWithoutKeeper() public {
        uint256 signingKey = 0xA11CE;
        vm.prank(address(policy));
        vault.setInferenceSigner(vm.addr(signingKey));
        policy.announceWinddown();
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(
            bytes(
                string.concat(
                    "api.venice.ai wants you to sign in with your Ethereum account:\n",
                    Strings.toChecksumHexString(address(vault)),
                    "\n\nSign in to Venice AI\n\nURI: https://api.venice.ai/api/v1/chat/completions",
                    "\nVersion: 1\nChain ID: 8453\nNonce: abcdefgh\nIssued At: 2027-01-22T08:00:00.000Z",
                    "\nExpiration Time: 2027-01-22T08:05:00.000Z"
                )
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("TelligenceVeniceAuth"),
                keccak256("1"),
                uint256(8453),
                address(vault)
            )
        );
        bytes32 payload = keccak256(
            abi.encode(
                keccak256("VeniceAuthentication(bytes32 messageHash,uint64 generation)"),
                messageHash,
                vault.signerGeneration()
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signingKey, MessageHashUtils.toTypedDataHash(domain, payload));
        bytes memory envelope = abi.encode(
            uint8(1),
            vault.signerGeneration(),
            uint8(0),
            "abcdefgh",
            "2027-01-22T08:00:00.000Z",
            "2027-01-22T08:05:00.000Z",
            abi.encodePacked(r, s, v)
        );
        vm.warp(vault.noticeEndsAt() - 1);
        assertEq(vault.isValidSignature(messageHash, envelope), bytes4(0x1626ba7e));
        vm.warp(vault.noticeEndsAt());
        assertEq(vault.isValidSignature(messageHash, envelope), bytes4(0xffffffff));
        assertEq(uint8(vault.state()), uint8(TelligenceVaultState.Notice));
    }

    function _finishWinddown() internal {
        vm.warp(vault.noticeEndsAt());
        vault.beginDiemUnstake();
        (, uint256 diemEnd,) = diem.stakedInfos(address(vault));
        if (diemEnd > block.timestamp) vm.warp(diemEnd);
        vault.claimDiemAndBeginVVVUnstake();
        (, uint256 vvvEnd,) = staking.stakes(address(vault));
        if (vvvEnd > block.timestamp) vm.warp(vvvEnd);
        vault.claimVVVAndReturn();
    }
}
