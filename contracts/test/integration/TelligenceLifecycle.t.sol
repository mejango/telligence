// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StockV6Fixture} from "./helpers/StockV6Fixture.sol";
import {VaultVVVMock, VaultDiemMock, VaultStakingMock} from "../helpers/VeniceMocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JBRulesetMetadata} from "@bananapus/core-v6/src/structs/JBRulesetMetadata.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {JBSplitGroupIds} from "@bananapus/core-v6/src/libraries/JBSplitGroupIds.sol";
import {JBPayerTrackerLib} from "@bananapus/core-v6/src/libraries/JBPayerTrackerLib.sol";
import {TelligenceFactory} from "../../src/TelligenceFactory.sol";
import {ProjectPolicy} from "../../src/ProjectPolicy.sol";
import {TelligenceComputeVault} from "../../src/TelligenceComputeVault.sol";
import {TelligenceComputeVaultDeployer} from "../../src/TelligenceComputeVaultDeployer.sol";
import {ITelligenceComputeVaultDeployer} from "../../src/interfaces/ITelligenceComputeVaultDeployer.sol";
import {IVeniceStaking} from "../../src/interfaces/IVeniceStaking.sol";
import {IVeniceDiem} from "../../src/interfaces/IVeniceDiem.sol";
import {TelligencePolicyConfig} from "../../src/structs/TelligencePolicyConfig.sol";
import {TelligenceStageConfig} from "../../src/structs/TelligenceStageConfig.sol";
import {TelligenceVaultState} from "../../src/enums/TelligenceVaultState.sol";

/// @notice Models the stock fee receiver's attribution before it routes fees into a payment.
contract CreationFeeAttributionFixture {
    address public recordedPayer;

    receive() external payable {
        recordedPayer = JBPayerTrackerLib.resolve(msg.sender);
    }
}

/// @notice Executes the public funding and recovery lifecycle through real, unmodified V6 contracts.
/// @dev Venice is modeled locally. This suite does not claim a live provider, funded Base canary, or AMM proof.
contract TelligenceLifecycleTest is StockV6Fixture {
    TelligenceFactory internal factory;
    VaultDiemMock internal diem;
    VaultStakingMock internal staking;
    address internal creator;
    address internal recovery;
    address internal supporter;
    address internal inferenceSigner;
    uint256 internal revnetId;
    ProjectPolicy internal policy;
    TelligenceComputeVault internal vault;

    function setUp() public {
        _deployStockV6();
        creator = makeAddr("creator");
        recovery = makeAddr("recovery");
        supporter = makeAddr("supporter");
        inferenceSigner = makeAddr("inferenceSigner");
        diem = new VaultDiemMock();
        staking = new VaultStakingMock(VaultVVVMock(VVV_ADDRESS), diem);
        diem.setMinter(address(staking));
        TelligenceComputeVaultDeployer vaultDeployer = new TelligenceComputeVaultDeployer(
            IERC20(VVV_ADDRESS), IVeniceStaking(address(staking)), IVeniceDiem(address(diem))
        );
        factory = new TelligenceFactory(revDeployer, ITelligenceComputeVaultDeployer(address(vaultDeployer)));
        _deployProject(_stages());
    }

    function test_factoryPinsOperatorVVVAndProductionRecipientsAcrossEveryStage() public {
        assertTrue(revOwner.isOperatorOf(revnetId, address(policy)));
        assertFalse(revOwner.isOperatorOf(revnetId, creator));
        assertFalse(revOwner.isOperatorOf(revnetId, recovery));
        assertFalse(revOwner.isOperatorOf(revnetId, inferenceSigner));
        assertEq(projects.ownerOf(revnetId), address(revOwner));
        assertEq(address(directory.controllerOf(revnetId)), address(controller));
        assertEq(address(directory.primaryTerminalOf(revnetId, VVV_ADDRESS)), address(terminal));
        assertEq(vault.POLICY(), address(policy));
        assertEq(address(vault.VVV()), VVV_ADDRESS);
        assertEq(tokens.totalSupplyOf(revnetId), 0);
        assertEq(suckerRegistry.allSuckersOf(revnetId).length, 0);

        JBAccountingContext memory context = terminal.accountingContextForTokenOf(revnetId, VVV_ADDRESS);
        assertEq(terminal.accountingContextsOf(revnetId).length, 1);
        assertEq(context.decimals, 18);
        assertEq(context.currency, uint32(uint160(VVV_ADDRESS)));
        for (uint256 i; i < 2; i++) {
            (JBRuleset memory ruleset, JBRulesetMetadata memory metadata) = controller.currentRulesetOf(revnetId);
            assertEq(metadata.baseCurrency, uint32(uint160(VVV_ADDRESS)));
            assertTrue(metadata.scopeCashOutsToLocalBalances);
            assertEq(metadata.metadata, 0);
            JBSplit[] memory reservedSplits = splits.splitsOf(revnetId, ruleset.id, JBSplitGroupIds.RESERVED_TOKENS);
            assertEq(reservedSplits.length, 1);
            assertEq(reservedSplits[0].beneficiary, address(policy));
            assertEq(reservedSplits[0].percent, 1_000_000_000);
            assertEq(reservedSplits[0].projectId, 0);
            assertEq(address(reservedSplits[0].hook), address(0));
            assertEq(reservedSplits[0].lockedUntil, type(uint48).max);
            assertFalse(reservedSplits[0].preferAddToBalance);
            vm.warp(block.timestamp + 31 days);
        }
    }

    function test_supportFundsRealRevnet_thenProductionBuildsCompute_andYieldReturnsWithoutMinting() public {
        _fund(100e18);
        uint256 production = tokens.totalBalanceOf(address(policy), revnetId);
        assertEq(production, 40_000e18);
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 60_000e18);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        uint256 realized = policy.cashOutProduction(production, block.timestamp + 60);
        assertEq(vvv.balanceOf(address(policy)), realized);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 0);
        assertLt(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBefore);

        policy.allocate(realized, block.timestamp + 60);
        (uint256 diemStaked,,) = diem.stakedInfos(address(vault));
        (uint256 lockedVVV, uint256 diemObligation) = staking.lockedStakes(address(vault));
        assertEq(lockedVVV, realized);
        assertEq(diemStaked, diemObligation);
        assertGt(diemStaked, 0);
        assertEq(vvv.balanceOf(creator), 0);
        assertEq(vvv.balanceOf(recovery), 0);
        assertEq(vvv.balanceOf(inferenceSigner), 0);

        uint256 supplyBefore = tokens.totalSupplyOf(revnetId);
        uint256 reserveBeforeReward = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        staking.setReward(address(vault), 3e18);
        vault.claimRewardsAndReturn();
        assertEq(tokens.totalSupplyOf(revnetId), supplyBefore);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBeforeReward + 3e18);
        assertEq(vvv.allowance(address(vault), address(policy)), 0);
        assertEq(vvv.allowance(address(policy), address(terminal)), 0);
    }

    function test_winddownReturnsPrincipalToSameRevnetWithoutMintingOrPrivilegedKeeper() public {
        _fund(100e18);
        uint256 realized =
            policy.cashOutProduction(tokens.totalBalanceOf(address(policy), revnetId), block.timestamp + 60);
        policy.allocate(realized, block.timestamp + 60);
        uint256 supplyBefore = tokens.totalSupplyOf(revnetId);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        vm.prank(creator);
        policy.announceWinddown();
        vm.warp(vault.noticeEndsAt());
        vm.prank(makeAddr("independent keeper"));
        vault.beginDiemUnstake();
        vm.warp(block.timestamp + diem.cooldownDuration());
        vault.claimDiemAndBeginVVVUnstake();
        vm.warp(block.timestamp + staking.cooldownDuration());
        vault.claimVVVAndReturn();

        assertEq(tokens.totalSupplyOf(revnetId), supplyBefore);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBefore + realized);
        assertEq(vvv.balanceOf(address(policy)), 0);
        assertEq(vvv.balanceOf(address(vault)), 0);
        assertEq(staking.balanceOf(address(vault)), 0);
        assertEq(diem.balanceOf(address(vault)), 0);
        assertEq(vault.totalReturned(), realized);
        assertEq(uint256(vault.state()), uint256(TelligenceVaultState.Closed));
    }

    function test_failedAllocationLeavesFundingAndProductionSafelyCommittedForRetry() public {
        _fund(100e18);
        uint256 realized =
            policy.cashOutProduction(tokens.totalBalanceOf(address(policy), revnetId), block.timestamp + 60);
        uint256 reserve = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        staking.setFailMint(true);
        vm.expectRevert();
        policy.allocate(realized, block.timestamp + 60);
        assertEq(vvv.balanceOf(address(policy)), realized);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserve);
        assertEq(vault.totalAllocated(), 0);
        assertEq(staking.balanceOf(address(vault)), 0);
        assertEq(vvv.allowance(address(policy), address(vault)), 0);
        staking.setFailMint(false);
        policy.allocate(realized, block.timestamp + 60);
        assertEq(vault.totalAllocated(), realized);
    }

    function test_secondAllocationPreservesImplicitRewardsUntilExplicitNoMintReturn() public {
        _fund(100e18);
        uint256 realized =
            policy.cashOutProduction(tokens.totalBalanceOf(address(policy), revnetId), block.timestamp + 60);
        uint256 firstAllocation = realized / 2;
        policy.allocate(firstAllocation, block.timestamp + 60);
        staking.setReward(address(vault), 2e18);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        uint256 supplyBefore = tokens.totalSupplyOf(revnetId);

        // Venice's stake call realizes rewards inside the guarded policy -> vault allocation call.
        policy.allocate(realized - firstAllocation, block.timestamp + 60);
        assertEq(vvv.balanceOf(address(vault)), 2e18);
        assertEq(vault.totalAllocated(), realized);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBefore);
        vault.returnLiquidVVV();
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBefore + 2e18);
        assertEq(tokens.totalSupplyOf(revnetId), supplyBefore);
    }

    function test_creatorCannotUseStockOperatorPermissionsToRedirectProduction() public {
        vm.prank(creator);
        vm.expectRevert();
        revOwner.setOperatorOf(revnetId, creator);
        assertTrue(revOwner.isOperatorOf(revnetId, address(policy)));

        vm.prank(inferenceSigner);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        policy.announceWinddown();
        vm.prank(inferenceSigner);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        policy.setInferenceSigner(inferenceSigner);
    }

    function test_lateProductionBurnsWithoutReopeningComputeOrReducingTreasury() public {
        vm.prank(creator);
        policy.announceWinddown();
        _fund(100e18);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        uint256 supporterBalance = tokens.totalBalanceOf(supporter, revnetId);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 40_000e18);
        policy.burnLateProduction();
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 0);
        assertEq(tokens.totalSupplyOf(revnetId), supporterBalance);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBefore);
        assertEq(vault.totalAllocated(), 0);
        assertEq(uint256(vault.state()), uint256(TelligenceVaultState.Notice));
    }

    function test_factoryRejectsLaunchOnWrongChain() public {
        vm.chainId(1);
        vm.prank(creator);
        vm.expectRevert(TelligenceFactory.TelligenceFactory_WrongChainOrAsset.selector);
        factory.deployFor(_description(), _stages(), _policyConfiguration(), recovery, inferenceSigner);
    }

    function test_factoryRejectsUnsafeFutureStageAtomically() public {
        TelligenceStageConfig[] memory stageConfigs = _stages();
        stageConfigs[1].cashOutTaxRate = 10_000;
        uint256 projectCountBefore = projects.count();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TelligenceFactory.TelligenceFactory_InvalidStage.selector, 1));
        factory.deployFor(_description(), stageConfigs, _policyConfiguration(), recovery, inferenceSigner);
        assertEq(projects.count(), projectCountBefore);
        assertEq(factory.policyOf(revnetId), address(policy));
    }

    function test_factoryRejectsZeroEconomicFloorBeforeCreatingProject() public {
        TelligencePolicyConfig memory configuration = _policyConfiguration();
        configuration.minVVVPerProjectToken = 0;
        uint256 projectCountBefore = projects.count();
        vm.prank(creator);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InvalidConfiguration.selector);
        factory.deployFor(_description(), _stages(), configuration, recovery, inferenceSigner);
        assertEq(projects.count(), projectCountBefore);
    }

    function test_boundPolicyCannotBeReclaimedByCreatorOrStranger() public {
        vm.prank(creator);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        policy.bind(revnetId + 1, address(vault));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        policy.bind(revnetId + 1, address(vault));
        assertEq(policy.revnetId(), revnetId);
        assertEq(policy.vault(), address(vault));
    }

    function test_factoryRequiresAndForwardsExactStockCreationFee() public {
        address payable feeRecipient = payable(makeAddr("creation fee recipient"));
        uint256 fee = 0.001 ether;
        projects.setCreationFee(fee, feeRecipient);
        uint256 projectCountBefore = projects.count();
        vm.deal(creator, 2 * fee);
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TelligenceFactory.TelligenceFactory_IncorrectCreationFee.selector, fee, 0)
        );
        factory.deployFor(_description(), _stages(), _policyConfiguration(), recovery, inferenceSigner);
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(TelligenceFactory.TelligenceFactory_IncorrectCreationFee.selector, fee, fee + 1)
        );
        factory.deployFor{value: fee + 1}(_description(), _stages(), _policyConfiguration(), recovery, inferenceSigner);
        assertEq(projects.count(), projectCountBefore);

        vm.prank(creator);
        (uint256 paidProjectId, ProjectPolicy paidPolicy, TelligenceComputeVault paidVault) =
            factory.deployFor{value: fee}(_description(), _stages(), _policyConfiguration(), recovery, inferenceSigner);
        assertEq(feeRecipient.balance, fee);
        assertEq(address(factory).balance, 0);
        assertEq(projects.count(), projectCountBefore + 1);
        assertEq(factory.creatorOf(paidProjectId), creator);
        assertEq(factory.policyOf(paidProjectId), address(paidPolicy));
        assertEq(factory.vaultOf(paidProjectId), address(paidVault));
        assertNotEq(factory.policyHashOf(paidProjectId), bytes32(0));
        assertNotEq(address(paidVault), address(vault));
    }

    function test_factoryPreservesCreatorAttributionThroughStockCreationFeeRouting() public {
        CreationFeeAttributionFixture receiver = new CreationFeeAttributionFixture();
        uint256 fee = 0.001 ether;
        projects.setCreationFee(fee, payable(address(receiver)));
        vm.deal(creator, fee);
        vm.prank(creator);
        factory.deployFor{value: fee}(_description(), _stages(), _policyConfiguration(), recovery, inferenceSigner);
        assertEq(receiver.recordedPayer(), creator);
        assertEq(address(receiver).balance, fee);
    }

    function test_projectRewardsAndVaultCallbacksRemainIsolated() public {
        _fund(100e18);
        uint256 realized =
            policy.cashOutProduction(tokens.totalBalanceOf(address(policy), revnetId), block.timestamp + 60);
        policy.allocate(realized, block.timestamp + 60);
        uint256 firstProjectId = revnetId;
        ProjectPolicy firstPolicy = policy;
        TelligenceComputeVault firstVault = vault;
        uint256 firstReserve = terminalStore.balanceOf(address(terminal), firstProjectId, VVV_ADDRESS);
        uint256 firstSupply = tokens.totalSupplyOf(firstProjectId);

        _deployProject(_stages());
        _fund(50e18);
        uint256 secondReserve = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        uint256 secondSupply = tokens.totalSupplyOf(revnetId);
        staking.setReward(address(firstVault), 4e18);
        firstVault.claimRewardsAndReturn();
        assertEq(terminalStore.balanceOf(address(terminal), firstProjectId, VVV_ADDRESS), firstReserve + 4e18);
        assertEq(tokens.totalSupplyOf(firstProjectId), firstSupply);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), secondReserve);
        assertEq(tokens.totalSupplyOf(revnetId), secondSupply);
        assertEq(vault.totalAllocated(), 0);
        vm.prank(address(vault));
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        firstPolicy.returnToRevnet(1e18);
    }

    function _fund(uint256 amount) internal {
        vvv.mint(supporter, amount);
        vm.startPrank(supporter);
        vvv.approve(address(terminal), amount);
        terminal.pay(revnetId, VVV_ADDRESS, amount, supporter, 0, "fund useful compute", "");
        vm.stopPrank();
        controller.sendReservedTokensToSplitsOf(revnetId);
    }

    function _deployProject(TelligenceStageConfig[] memory stageConfigs) internal {
        vm.prank(creator);
        (revnetId, policy,) =
            factory.deployFor(_description(), stageConfigs, _policyConfiguration(), recovery, inferenceSigner);
        vault = TelligenceComputeVault(policy.vault());
    }

    function _description() internal view returns (REVDescription memory) {
        return REVDescription({
            name: "Compute for public goods", ticker: "COMPUTE", uri: "ipfs://compute", salt: bytes32(revnetId)
        });
    }

    function _policyConfiguration() internal pure returns (TelligencePolicyConfig memory) {
        return TelligencePolicyConfig({
            conversionCadence: 1 days,
            minBatchTokens: 100e18,
            maxBatchTokens: 50_000e18,
            minVVVPerProjectToken: 1e14,
            minDiemPerVVV: 1e17,
            maxPrincipal: 100e18
        });
    }

    function _stages() internal view returns (TelligenceStageConfig[] memory stages) {
        stages = new TelligenceStageConfig[](2);
        stages[0] = TelligenceStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            splitPercent: 4000,
            initialIssuance: 1000e18,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            operatorSplitPercent: 0
        });
        stages[1] = TelligenceStageConfig({
            startsAtOrAfter: uint48(block.timestamp + 30 days),
            splitPercent: 3000,
            initialIssuance: 900e18,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 5000,
            operatorSplitPercent: 0
        });
    }
}
