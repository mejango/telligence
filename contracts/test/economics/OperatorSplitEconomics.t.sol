// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockV6Fixture} from "../integration/helpers/StockV6Fixture.sol";
import {VaultVVVMock, VaultDiemMock, VaultStakingMock} from "../helpers/VeniceMocks.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {JBSuckerDeployerConfig} from "@bananapus/suckers-v6/src/structs/JBSuckerDeployerConfig.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";
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

/// @notice Characterizes creator token ownership using actual factory deployment and unmodified V6 accounting.
/// @dev VVV fee processing is enabled. Venice is modeled; no AMM liquidity, price changes, gas, revenue, loans,
/// or remote balances are assumed. Each observation starts with 100 VVV of supporter funding.
contract OperatorSplitEconomicsTest is StockV6Fixture {
    struct Observation {
        uint256 creatorReceipt;
        uint256 computeReceipt;
        uint256 treasury;
        uint256 fees;
    }

    TelligenceFactory internal factory;
    VaultDiemMock internal diem;
    VaultStakingMock internal staking;
    address internal creator;
    address internal supporter;
    uint256 internal sequence;

    function setUp() public {
        _deployStockV6();
        _enableVVVFeeTerminal();
        creator = makeAddr("creator");
        supporter = makeAddr("supporter");
        diem = new VaultDiemMock();
        staking = new VaultStakingMock(VaultVVVMock(VVV_ADDRESS), diem);
        diem.setMinter(address(staking));
        TelligenceComputeVaultDeployer vaultDeployer = new TelligenceComputeVaultDeployer(
            IERC20(VVV_ADDRESS), IVeniceStaking(address(staking)), IVeniceDiem(address(diem))
        );
        factory = new TelligenceFactory(revDeployer, ITelligenceComputeVaultDeployer(address(vaultDeployer)));
    }

    function test_FundingIssues40Compute10Creator50SupporterWithoutCreatorPayment() public {
        (uint256 id, ProjectPolicy policy,) = _launch();
        _fund(id);
        assertEq(tokens.totalBalanceOf(address(policy), id), 40_000 ether);
        assertEq(tokens.totalBalanceOf(creator, id), 10_000 ether);
        assertEq(tokens.totalBalanceOf(supporter, id), 50_000 ether);
        assertEq(tokens.totalSupplyOf(id), 100_000 ether);
        assertEq(_reserve(id), 100 ether);
        assertEq(vvv.balanceOf(creator), 0, "creator allocation mints project tokens, not VVV");
        assertEq(vvv.balanceOf(address(policy)), 0);
        assertTrue(revOwner.isOperatorOf(id, address(policy)));
        assertFalse(revOwner.isOperatorOf(id, creator));
    }

    function test_CreatorCanCashOutFundedBackingBeforeAnyRevenue() public {
        (uint256 id, ProjectPolicy policy,) = _launch();
        _fund(id);
        uint256 feesBefore = _reserve(feeProjectId);
        uint256 received = _creatorCashOut(id);
        // Independently derived stock cashout: 100 * 0.0975 * (0.4 + 0.6 * 0.0975) * 0.975.
        assertEq(received, 4.358_615_625 ether, "creator can extract VVV before work or revenue");
        assertLt(received, 10 ether, "10 percent of issued tokens is not an immediate 10 percent cash payout");
        assertEq(tokens.totalBalanceOf(creator, id), 0);
        assertEq(tokens.totalBalanceOf(address(policy), id), 40_000 ether);
        assertEq(tokens.totalBalanceOf(supporter, id), 50_000 ether);
        assertEq(received + _reserve(id) + _reserve(feeProjectId) - feesBefore, 100 ether);
        _report("creator_before_revenue", Observation(received, 0, _reserve(id), _reserve(feeProjectId) - feesBefore));
    }

    function test_CreatorExitOrderChangesComputeAndTreasuryWhileVVVConserves() public {
        Observation memory creatorFirst = _observeExitOrder(true);
        Observation memory computeFirst = _observeExitOrder(false);
        assertLt(creatorFirst.creatorReceipt, computeFirst.creatorReceipt);
        assertGt(creatorFirst.computeReceipt, computeFirst.computeReceipt);
        assertLt(creatorFirst.treasury, computeFirst.treasury);
        assertEq(computeFirst.computeReceipt, 24.107_85 ether);
        // The same initial token allocations do not prescribe fixed cash shares: earlier burns alter the curve.
        _report("creator_then_compute", creatorFirst);
        _report("compute_then_creator", computeFirst);
    }

    function test_RewardsAndRecoveredPrincipalReturnWithoutMintingOrCreatorSkim() public {
        (uint256 id, ProjectPolicy policy, TelligenceComputeVault vault) = _launch();
        _fund(id);
        uint256 feesBefore = _reserve(feeProjectId);
        uint256 realized = policy.cashOutProduction(tokens.totalBalanceOf(address(policy), id), block.timestamp + 60);
        policy.allocate(realized, block.timestamp + 60);
        uint256 supplyBefore = tokens.totalSupplyOf(id);
        uint256 reserveBefore = _reserve(id);
        uint256 creatorTokensBefore = tokens.totalBalanceOf(creator, id);
        uint256 supporterTokensBefore = tokens.totalBalanceOf(supporter, id);

        staking.setReward(address(vault), 3 ether);
        vault.claimRewardsAndReturn();
        assertEq(_reserve(id), reserveBefore + 3 ether);
        assertEq(tokens.totalSupplyOf(id), supplyBefore);
        assertEq(vvv.balanceOf(creator), 0, "no direct reward payout or creator fee");

        vm.prank(creator);
        policy.announceWinddown();
        vm.warp(vault.noticeEndsAt());
        vault.beginDiemUnstake();
        vm.warp(block.timestamp + diem.cooldownDuration());
        vault.claimDiemAndBeginVVVUnstake();
        vm.warp(block.timestamp + staking.cooldownDuration());
        vault.claimVVVAndReturn();
        assertEq(uint256(vault.state()), uint256(TelligenceVaultState.Closed));
        assertEq(_reserve(id), reserveBefore + 3 ether + realized);
        assertEq(tokens.totalSupplyOf(id), supplyBefore, "addToBalance returns do not mint");
        assertEq(tokens.totalBalanceOf(creator, id), creatorTokensBefore);
        assertEq(tokens.totalBalanceOf(supporter, id), supporterTokensBefore);
        assertEq(vvv.balanceOf(creator), 0, "principal returns in full to the treasury");
        assertEq(vvv.balanceOf(address(vault)), 0);
        assertEq(vvv.balanceOf(address(policy)), 0);
        assertEq(_reserve(id) + _reserve(feeProjectId) - feesBefore, 103 ether);

        // The creator who keeps ordinary tokens participates in the recovered treasury as a current holder.
        uint256 received = _creatorCashOut(id);
        assertGt(received, 0);
        assertEq(received + _reserve(id) + _reserve(feeProjectId) - feesBefore, 103 ether);
        _report(
            "creator_after_3_vvv_reward_and_recovery",
            Observation(received, 0, _reserve(id), _reserve(feeProjectId) - feesBefore)
        );
    }

    function _observeExitOrder(bool creatorFirst) internal returns (Observation memory observation) {
        (uint256 id, ProjectPolicy policy,) = _launch();
        _fund(id);
        uint256 feesBefore = _reserve(feeProjectId);
        if (creatorFirst) observation.creatorReceipt = _creatorCashOut(id);
        observation.computeReceipt =
            policy.cashOutProduction(tokens.totalBalanceOf(address(policy), id), block.timestamp + 60);
        if (!creatorFirst) observation.creatorReceipt = _creatorCashOut(id);
        observation.treasury = _reserve(id);
        observation.fees = _reserve(feeProjectId) - feesBefore;
        assertEq(
            observation.creatorReceipt + observation.computeReceipt + observation.treasury + observation.fees, 100 ether
        );
        assertEq(vvv.balanceOf(address(policy)), observation.computeReceipt);
        assertEq(tokens.totalBalanceOf(address(policy), id), 0);
        assertEq(tokens.totalBalanceOf(creator, id), 0);
        assertEq(tokens.totalBalanceOf(supporter, id), 50_000 ether);
    }

    function _creatorCashOut(uint256 id) internal returns (uint256 received) {
        uint256 balanceBefore = vvv.balanceOf(creator);
        uint256 count = tokens.totalBalanceOf(creator, id);
        vm.prank(creator);
        terminal.cashOutTokensOf(creator, id, count, VVV_ADDRESS, 0, payable(creator), "");
        received = vvv.balanceOf(creator) - balanceBefore;
    }

    function _launch() internal returns (uint256 id, ProjectPolicy policy, TelligenceComputeVault vault) {
        TelligenceStageConfig[] memory stages = new TelligenceStageConfig[](1);
        stages[0] = TelligenceStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            splitPercent: 4000,
            initialIssuance: 1000 ether,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            operatorSplitPercent: 1000
        });
        REVDescription memory description = REVDescription({
            name: "Creator split observation",
            ticker: "OWNER",
            uri: "ipfs://operator-economics",
            salt: bytes32(++sequence)
        });
        TelligencePolicyConfig memory configuration = TelligencePolicyConfig({
            conversionCadence: 1 days,
            minBatchTokens: 100 ether,
            maxBatchTokens: 50_000 ether,
            minVVVPerProjectToken: 1e14,
            minDiemPerVVV: 1e17,
            maxPrincipal: 100 ether
        });
        vm.prank(creator);
        return factory.deployFor(description, stages, configuration, makeAddr("recovery"), makeAddr("inference signer"));
    }

    function _fund(uint256 id) internal {
        vvv.mint(supporter, 100 ether);
        vm.startPrank(supporter);
        vvv.approve(address(terminal), 100 ether);
        terminal.pay(id, VVV_ADDRESS, 100 ether, supporter, 0, "compute economics", "");
        vm.stopPrank();
        controller.sendReservedTokensToSplitsOf(id);
    }

    function _enableVVVFeeTerminal() internal {
        REVStageConfig[] memory stages = new REVStageConfig[](1);
        stages[0] = REVStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            autoIssuances: new REVAutoIssuance[](0),
            splitPercent: 0,
            splits: new JBSplit[](0),
            initialIssuance: 1000 ether,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 0,
            extraMetadata: 0
        });
        JBAccountingContext[] memory contexts = new JBAccountingContext[](1);
        contexts[0] = JBAccountingContext({token: VVV_ADDRESS, decimals: 18, currency: uint32(uint160(VVV_ADDRESS))});
        projects.approve(address(revDeployer), feeProjectId);
        revDeployer.deployFor(
            feeProjectId,
            REVConfig({
                description: REVDescription({
                    name: "VVV fee receiver", ticker: "FEES", uri: "ipfs://fees", salt: bytes32(0)
                }),
                baseCurrency: uint32(uint160(VVV_ADDRESS)),
                operator: address(this),
                scopeCashOutsToLocalBalances: true,
                stageConfigurations: stages
            }),
            contexts,
            REVSuckerDeploymentConfig({deployerConfigurations: new JBSuckerDeployerConfig[](0), salt: bytes32(0)})
        );
    }

    function _reserve(uint256 id) internal view returns (uint256) {
        return terminalStore.balanceOf(address(terminal), id, VVV_ADDRESS);
    }

    function _report(string memory label, Observation memory observation) internal pure {
        console2.log(
            string.concat(
                label,
                ",creator_vvv=",
                vm.toString(observation.creatorReceipt),
                ",compute_vvv=",
                vm.toString(observation.computeReceipt),
                ",treasury_vvv=",
                vm.toString(observation.treasury),
                ",fees_vvv=",
                vm.toString(observation.fees)
            )
        );
    }
}
