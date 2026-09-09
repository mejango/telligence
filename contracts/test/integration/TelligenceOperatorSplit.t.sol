// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StockV6Fixture} from "./helpers/StockV6Fixture.sol";
import {VaultVVVMock, VaultDiemMock, VaultStakingMock} from "../helpers/VeniceMocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JBRulesetMetadata} from "@bananapus/core-v6/src/structs/JBRulesetMetadata.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {JBSplitGroup} from "@bananapus/core-v6/src/structs/JBSplitGroup.sol";
import {JBSplitGroupIds} from "@bananapus/core-v6/src/libraries/JBSplitGroupIds.sol";
import {TelligenceFactory} from "../../src/TelligenceFactory.sol";
import {ProjectPolicy} from "../../src/ProjectPolicy.sol";
import {TelligenceComputeVault} from "../../src/TelligenceComputeVault.sol";
import {TelligenceComputeVaultDeployer} from "../../src/TelligenceComputeVaultDeployer.sol";
import {ITelligenceComputeVaultDeployer} from "../../src/interfaces/ITelligenceComputeVaultDeployer.sol";
import {IVeniceStaking} from "../../src/interfaces/IVeniceStaking.sol";
import {IVeniceDiem} from "../../src/interfaces/IVeniceDiem.sol";
import {TelligencePolicyConfig} from "../../src/structs/TelligencePolicyConfig.sol";
import {TelligenceStageConfig} from "../../src/structs/TelligenceStageConfig.sol";

/// @notice Verifies creator compensation through actual stock issuance without granting protocol authority.
contract TelligenceOperatorSplitTest is StockV6Fixture {
    TelligenceFactory internal factory;
    address internal creator = address(0xC0FFEE);
    address internal recovery = address(0xBACC);
    address internal supporter = address(0xB0B);
    address internal signer = address(0x5151);
    uint256 internal revnetId;
    ProjectPolicy internal policy;
    TelligenceComputeVault internal vault;

    function setUp() public {
        _deployStockV6();
        VaultDiemMock diem = new VaultDiemMock();
        VaultStakingMock staking = new VaultStakingMock(VaultVVVMock(VVV_ADDRESS), diem);
        diem.setMinter(address(staking));
        TelligenceComputeVaultDeployer vaultDeployer = new TelligenceComputeVaultDeployer(
            IERC20(VVV_ADDRESS), IVeniceStaking(address(staking)), IVeniceDiem(address(diem))
        );
        factory = new TelligenceFactory(revDeployer, ITelligenceComputeVaultDeployer(address(vaultDeployer)));
    }

    function test_zeroOperatorKeepsOriginalSingleRecipientAndSupporterIssuance() public {
        _launch(_stages(4000, 0, 1000 ether));
        _fund(100 ether, true);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 40_000 ether);
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 60_000 ether);
        assertEq(tokens.totalBalanceOf(creator, revnetId), 0);
        assertEq(tokens.totalBalanceOf(address(revOwner), revnetId), 0);
        (JBRuleset memory ruleset, JBRulesetMetadata memory metadata) = controller.currentRulesetOf(revnetId);
        assertEq(metadata.reservedPercent, 4000);
        JBSplit[] memory recipients = splits.splitsOf(revnetId, ruleset.id, JBSplitGroupIds.RESERVED_TOKENS);
        assertEq(recipients.length, 1);
        assertEq(recipients[0].percent, 1_000_000_000);
    }

    function test_creatorAllocationDoesNotReplaceComputeOrRewardRecoveryAuthority() public {
        _launch(_stages(4000, 1000, 1000 ether));
        _fund(100 ether, true);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 40_000 ether);
        assertEq(tokens.totalBalanceOf(creator, revnetId), 10_000 ether);
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 50_000 ether);
        assertEq(tokens.totalBalanceOf(recovery, revnetId), 0);
        assertEq(tokens.totalBalanceOf(signer, revnetId), 0);
        assertEq(tokens.totalSupplyOf(revnetId), 100_000 ether);
        assertTrue(revOwner.isOperatorOf(revnetId, address(policy)));
        assertFalse(revOwner.isOperatorOf(revnetId, creator));
        assertEq(factory.creatorOf(revnetId), creator);
        (JBRuleset memory ruleset, JBRulesetMetadata memory metadata) = controller.currentRulesetOf(revnetId);
        assertEq(metadata.reservedPercent, 5000);
        JBSplit[] memory recipients = splits.splitsOf(revnetId, ruleset.id, JBSplitGroupIds.RESERVED_TOKENS);
        assertEq(recipients.length, 2);
        assertEq(recipients[0].beneficiary, address(policy));
        assertEq(recipients[0].percent, 800_000_000);
        assertEq(recipients[1].beneficiary, creator);
        assertEq(recipients[1].percent, 200_000_000);
        for (uint256 i; i < recipients.length; ++i) {
            assertEq(recipients[i].lockedUntil, type(uint48).max);
            assertEq(recipients[i].projectId, 0);
            assertEq(address(recipients[i].hook), address(0));
            assertFalse(recipients[i].preferAddToBalance);
        }
    }

    function test_factoryRejectsNoSupporterShareAndOverflowingInputsAtomically() public {
        uint16[3] memory invalidOperatorShares = [uint16(6000), 6001, type(uint16).max];
        for (uint256 i; i < invalidOperatorShares.length; ++i) {
            uint256 countBefore = projects.count();
            TelligenceStageConfig[] memory stages = _stages(4000, invalidOperatorShares[i], 1000 ether);
            vm.prank(creator);
            vm.expectRevert(abi.encodeWithSelector(TelligenceFactory.TelligenceFactory_InvalidStage.selector, 0));
            factory.deployFor(_description(), stages, _configuration(), recovery, signer);
            assertEq(projects.count(), countBefore);
        }
    }

    function test_factoryRequiresPositiveComputeEvenWithOperatorAllocation() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TelligenceFactory.TelligenceFactory_InvalidStage.selector, 0));
        factory.deployFor(_description(), _stages(0, 1000, 1000 ether), _configuration(), recovery, signer);
    }

    function test_oneBasisPointSupporterShareRemainsPossible() public {
        _launch(_stages(4000, 5999, 1000 ether));
        _fund(100 ether, true);
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 10 ether);
        assertGe(tokens.totalBalanceOf(address(policy), revnetId), 40_000 ether);
        assertGt(tokens.totalBalanceOf(creator, revnetId), 0);
        _assertConservedDistribution();
    }

    function test_lockedSplitCannotBeChangedEvenThroughExistingStockOperatorPermission() public {
        _launch(_stages(4000, 1000, 1000 ether));
        (JBRuleset memory ruleset,) = controller.currentRulesetOf(revnetId);
        JBSplit[] memory recipients = splits.splitsOf(revnetId, ruleset.id, JBSplitGroupIds.RESERVED_TOKENS);
        recipients[1].beneficiary = payable(recovery);
        JBSplitGroup[] memory groups = new JBSplitGroup[](1);
        groups[0] = JBSplitGroup({groupId: JBSplitGroupIds.RESERVED_TOKENS, splits: recipients});
        vm.prank(creator);
        vm.expectRevert();
        controller.setSplitGroupsOf(revnetId, ruleset.id, groups);
        // Even the actual policy address cannot replace the locked creator beneficiary through stock core.
        vm.prank(address(policy));
        vm.expectRevert();
        controller.setSplitGroupsOf(revnetId, ruleset.id, groups);
        vm.prank(creator);
        vm.expectRevert();
        revOwner.setOperatorOf(revnetId, creator);
        assertTrue(revOwner.isOperatorOf(revnetId, address(policy)));
        assertEq(splits.splitsOf(revnetId, ruleset.id, JBSplitGroupIds.RESERVED_TOKENS)[1].beneficiary, creator);
    }

    function test_fractionalSplitDustFollowsStockOwnerAndCanBeBurnedPermissionlessly() public {
        _launch(_stages(4000, 3333, 1 ether));
        _fund(7, true);
        // Seven raw issued units: supporter floor(7 * 2667 / 10000) = 1; six units reserved.
        // Each stock recipient floors independently: compute = 3, creator = 2, owner residue = 1.
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 1);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 3);
        assertEq(tokens.totalBalanceOf(creator, revnetId), 2);
        assertEq(tokens.totalBalanceOf(address(revOwner), revnetId), 1);
        _assertConservedDistribution();
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);
        vm.prank(supporter);
        revOwner.burnHeldTokensOf(revnetId);
        assertEq(tokens.totalBalanceOf(address(revOwner), revnetId), 0);
        assertEq(tokens.totalSupplyOf(revnetId), 6);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), reserveBefore);
    }

    function testFuzz_fractionalRoutingProtectsComputeAndConservesEveryIssuedUnit(
        uint16 operatorShare,
        uint96 rawFunding
    )
        public
    {
        operatorShare = uint16(bound(operatorShare, 1, 5999));
        uint256 amount = bound(uint256(rawFunding), 1, 1e24);
        _launch(_stages(4000, operatorShare, 1 ether));
        _fund(amount, true);
        uint256 reserved = amount - amount * (6000 - operatorShare) / 10_000;
        uint256 operatorWeight = uint256(operatorShare) * 1_000_000_000 / (4000 + uint256(operatorShare));
        uint256 computeWeight = 1_000_000_000 - operatorWeight;
        uint256 computeTokens = tokens.totalBalanceOf(address(policy), revnetId);
        assertEq(computeTokens, reserved * computeWeight / 1_000_000_000);
        assertEq(tokens.totalBalanceOf(creator, revnetId), reserved * operatorWeight / 1_000_000_000);
        assertGe(computeTokens, amount * 4000 / 10_000);
        assertLe(computeTokens - amount * 4000 / 10_000, Math.ceilDiv(reserved, 1_000_000_000) + 1);
        assertLe(tokens.totalBalanceOf(address(revOwner), revnetId), 1);
        _assertConservedDistribution();
    }

    function test_stagedRoutingRejectsChangingBeneficiaryRatios() public {
        TelligenceStageConfig[] memory stages = new TelligenceStageConfig[](2);
        stages[0] = _stages(4000, 1000, 1000 ether)[0];
        stages[1] = _stages(3000, 1000, 900 ether)[0];
        stages[1].startsAtOrAfter += 30 days;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(TelligenceFactory.TelligenceFactory_InvalidStage.selector, 1));
        factory.deployFor(_description(), stages, _configuration(), recovery, signer);
    }

    function test_delayedDistributionAcrossStageCannotChangeCreatorToComputeRatio() public {
        TelligenceStageConfig[] memory stages = new TelligenceStageConfig[](2);
        stages[0] = _stages(4000, 1000, 1000 ether)[0];
        stages[1] = _stages(3000, 750, 900 ether)[0];
        stages[1].startsAtOrAfter += 30 days;
        _launch(stages);
        _fund(100 ether, false);
        assertEq(controller.pendingReservedTokenBalanceOf(revnetId), 50_000 ether);
        vm.warp(stages[1].startsAtOrAfter);
        controller.sendReservedTokensToSplitsOf(revnetId);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 40_000 ether);
        assertEq(tokens.totalBalanceOf(creator, revnetId), 10_000 ether);
        _fund(100 ether, true);
        assertEq(tokens.totalBalanceOf(address(policy), revnetId), 67_000 ether);
        assertEq(tokens.totalBalanceOf(creator, revnetId), 16_750 ether);
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 106_250 ether);
        _assertConservedDistribution();
    }

    function test_policyHashCommitsCreatorRecipientAndNewPolicyVersion() public {
        TelligenceStageConfig[] memory stages = _stages(4000, 1000, 1000 ether);
        REVDescription memory description = _description();
        _launch(stages);
        assertEq(factory.POLICY_VERSION(), 2);
        (JBRuleset memory ruleset,) = controller.currentRulesetOf(revnetId);
        REVStageConfig[] memory stockStages = new REVStageConfig[](1);
        stockStages[0] = REVStageConfig({
            startsAtOrAfter: stages[0].startsAtOrAfter,
            autoIssuances: new REVAutoIssuance[](0),
            splitPercent: 5000,
            splits: splits.splitsOf(revnetId, ruleset.id, JBSplitGroupIds.RESERVED_TOKENS),
            initialIssuance: 1000 ether,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            extraMetadata: 0
        });
        REVConfig memory configuration = REVConfig({
            description: description,
            baseCurrency: uint32(uint160(VVV_ADDRESS)),
            operator: address(policy),
            scopeCashOutsToLocalBalances: true,
            stageConfigurations: stockStages
        });
        bytes32 expected = keccak256(
            abi.encode(
                uint256(8453), uint256(2), address(factory), revnetId, configuration, _configuration(), recovery, vault
            )
        );
        assertEq(factory.policyHashOf(revnetId), expected);
        configuration.stageConfigurations[0].splits[1].beneficiary = payable(recovery);
        assertNotEq(
            factory.policyHashOf(revnetId),
            keccak256(
                abi.encode(
                    uint256(8453),
                    uint256(2),
                    address(factory),
                    revnetId,
                    configuration,
                    _configuration(),
                    recovery,
                    vault
                )
            )
        );
    }

    function _assertConservedDistribution() internal view {
        assertEq(
            tokens.totalSupplyOf(revnetId),
            tokens.totalBalanceOf(supporter, revnetId) + tokens.totalBalanceOf(creator, revnetId)
                + tokens.totalBalanceOf(address(policy), revnetId) + tokens.totalBalanceOf(address(revOwner), revnetId)
        );
        assertEq(controller.pendingReservedTokenBalanceOf(revnetId), 0);
        assertEq(tokens.totalBalanceOf(address(controller), revnetId), 0);
    }

    function _fund(uint256 amount, bool distribute) internal {
        vvv.mint(supporter, amount);
        vm.startPrank(supporter);
        vvv.approve(address(terminal), amount);
        terminal.pay(revnetId, VVV_ADDRESS, amount, supporter, 0, "compute support", "");
        vm.stopPrank();
        if (distribute) controller.sendReservedTokensToSplitsOf(revnetId);
    }

    function _launch(TelligenceStageConfig[] memory stages) internal {
        vm.prank(creator);
        (revnetId, policy, vault) = factory.deployFor(_description(), stages, _configuration(), recovery, signer);
    }

    function _description() internal pure returns (REVDescription memory) {
        return REVDescription({name: "Creator allocation", ticker: "COMPUTE", uri: "ipfs://compute", salt: bytes32(0)});
    }

    function _configuration() internal pure returns (TelligencePolicyConfig memory) {
        return TelligencePolicyConfig({
            conversionCadence: 1 days,
            minBatchTokens: 100 ether,
            maxBatchTokens: 50_000 ether,
            minVVVPerProjectToken: 1e14,
            minDiemPerVVV: 1e17,
            maxPrincipal: 100 ether
        });
    }

    function _stages(
        uint16 computeShare,
        uint16 operatorShare,
        uint112 issuance
    )
        internal
        view
        returns (TelligenceStageConfig[] memory stages)
    {
        stages = new TelligenceStageConfig[](1);
        stages[0] = TelligenceStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            splitPercent: computeShare,
            initialIssuance: issuance,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            operatorSplitPercent: operatorShare
        });
    }
}
