// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {StockV6Fixture} from "../integration/helpers/StockV6Fixture.sol";
import {PolicyVault} from "../unit/ProjectPolicy.t.sol";
import {ProjectPolicy} from "../../src/ProjectPolicy.sol";
import {TelligencePolicyConfig} from "../../src/structs/TelligencePolicyConfig.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {IJBSplitHook} from "@bananapus/core-v6/src/interfaces/IJBSplitHook.sol";
import {JBSuckerDeployerConfig} from "@bananapus/suckers-v6/src/structs/JBSuckerDeployerConfig.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";

/// @notice Deterministic economic observations through actual stock V6 accounting and the production policy.
/// @dev No AMM liquidity, loans, remote balances, issuance decay, yield, or provider allocation is assumed. Values
/// are VVV base units. Fee-terminal availability is explicit and gas is excluded from every reported amount.
contract ComputeEconomicsTest is StockV6Fixture {
    uint256 internal sequence;
    address internal supporter = address(0xB0B);

    function setUp() public {
        _deployStockV6();
    }

    function test_DefaultTenPercentTaxMatchesIndependentNetFormula() public {
        _enableVVVFeeTerminal();
        (uint256 id, ProjectPolicy policy) = _launch(4000, 1000, 1 ether, 1e30, 1e30);
        _fund(id, 100 ether);
        uint256 net = policy.cashOutProduction(tokens.totalBalanceOf(address(policy), id), vm.getBlockTimestamp() + 60);
        // 40% compute, no creator allocation, 10% tax: 0.39 * (0.9 + 0.1 * 0.39) * 0.975.
        assertEq(net, 35.705_475 ether);
        assertEq(net + _reserve(id) + _reserve(feeProjectId), 100 ether);
        assertEq(tokens.totalBalanceOf(supporter, id), 60_000 ether);
        assertEq(tokens.totalBalanceOf(address(policy), id), 0);
    }

    function test_DirectIssuanceMatrix_ActualNetVVVAndConservationAcrossScales() public {
        _enableVVVFeeTerminal();
        uint16[3] memory production = [uint16(2000), 4000, 6000];
        uint16[4] memory tax = [uint16(0), 1000, 6000, 9000];
        for (uint256 r; r < production.length; r++) {
            for (uint256 t; t < tax.length; t++) {
                this.observeScales(production[r], tax[t]);
            }
        }
    }

    function test_HistoricalSixtyPercentTaxWithoutVVVFeeTerminal_UsesDifferentActualFeeBranch() public {
        (uint256 id, ProjectPolicy policy) = _launch(4000, 6000, 1 ether, 1e30, 1e30);
        _fund(id, 100 ether);
        uint256 net = policy.cashOutProduction(tokens.totalBalanceOf(address(policy), id), vm.getBlockTimestamp() + 60);
        assertEq(net, 24.96 ether);
        assertEq(_reserve(id), 75.04 ether);
        _row("no_fee_terminal", 4000, 6000, 100 ether, net, _reserve(id), 100 ether - net - _reserve(id));
    }

    function test_RepeatedFundingAndBatchSizeHaveObservableNonlinearImpact() public {
        _enableVVVFeeTerminal();
        (uint256 allId, ProjectPolicy allPolicy) = _launch(4000, 6000, 1 ether, 1e30, 1e30);
        uint256 feesBefore = _reserve(feeProjectId);
        _fund(allId, 100 ether);
        uint256 allNet =
            allPolicy.cashOutProduction(tokens.totalBalanceOf(address(allPolicy), allId), vm.getBlockTimestamp() + 60);
        _row(
            "one_funding_one_batch", 4000, 6000, 100 ether, allNet, _reserve(allId), _reserve(feeProjectId) - feesBefore
        );

        (uint256 repeatedId, ProjectPolicy repeatedPolicy) = _launch(4000, 6000, 1 ether, 1e30, 1e30);
        feesBefore = _reserve(feeProjectId);
        uint256 repeatedNet;
        for (uint256 i; i < 10; i++) {
            _fund(repeatedId, 10 ether);
            repeatedNet += repeatedPolicy.cashOutProduction(
                tokens.totalBalanceOf(address(repeatedPolicy), repeatedId), vm.getBlockTimestamp() + 60
            );
            vm.warp(vm.getBlockTimestamp() + 1 days);
        }
        assertNotEq(repeatedNet, allNet, "earlier conversion changes later supply and reserve");
        assertApproxEqAbs(repeatedNet + _reserve(repeatedId) + _reserve(feeProjectId) - feesBefore, 100 ether, 10);
        _row(
            "ten_fundings_ten_batches",
            4000,
            6000,
            100 ether,
            repeatedNet,
            _reserve(repeatedId),
            _reserve(feeProjectId) - feesBefore
        );

        (uint256 splitId, ProjectPolicy splitPolicy) = _launch(4000, 6000, 1 ether, 10_000 ether, 1e30);
        feesBefore = _reserve(feeProjectId);
        _fund(splitId, 100 ether);
        uint256 splitNet;
        for (uint256 i; i < 4; i++) {
            splitNet += splitPolicy.cashOutProduction(10_000 ether, vm.getBlockTimestamp() + 60);
            vm.warp(vm.getBlockTimestamp() + 1 days);
        }
        assertLt(splitNet, allNet, "a fixed production allocation is not indifferent to smaller cashouts");
        assertApproxEqAbs(splitNet + _reserve(splitId) + _reserve(feeProjectId) - feesBefore, 100 ether, 4);
        _row(
            "one_funding_four_batches",
            4000,
            6000,
            100 ether,
            splitNet,
            _reserve(splitId),
            _reserve(feeProjectId) - feesBefore
        );
    }

    function test_MinimumBatchAndOutputFloorCanDelayActivationWithoutLosingFunding() public {
        _enableVVVFeeTerminal();
        (uint256 id, ProjectPolicy policy) = _launch(4000, 6000, 1000 ether, 1e30, 1e30);
        _fund(id, 1 ether);
        uint256 count = tokens.totalBalanceOf(address(policy), id);
        assertEq(count, 400 ether);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InvalidBatch.selector);
        policy.cashOutProduction(count, vm.getBlockTimestamp() + 60);
        assertEq(_reserve(id), 1 ether);
        _row("below_minimum_batch", 4000, 6000, 1 ether, 0, _reserve(id), 0);

        _fund(id, 2 ether);
        count = tokens.totalBalanceOf(address(policy), id);
        assertEq(count, 1200 ether);
        policy.raiseMinimumOutputs(0.001 ether, 1);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InsufficientOutput.selector);
        policy.cashOutProduction(count, vm.getBlockTimestamp() + 60);
        assertEq(_reserve(id), 3 ether);
        assertEq(tokens.totalBalanceOf(address(policy), id), 1200 ether);
        _row("unmet_output_floor", 4000, 6000, 3 ether, 0, _reserve(id), 0);
    }

    function test_LifetimeCapReturnsExcessAndBurnsLateProduction() public {
        _enableVVVFeeTerminal();
        (uint256 id, ProjectPolicy policy) = _launch(4000, 6000, 1 ether, 1e30, 10 ether);
        uint256 feesBefore = _reserve(feeProjectId);
        _fund(id, 100 ether);
        uint256 net = policy.cashOutProduction(tokens.totalBalanceOf(address(policy), id), vm.getBlockTimestamp() + 60);
        uint256 supplyBefore = tokens.totalSupplyOf(id);
        policy.allocate(10 ether, vm.getBlockTimestamp() + 60);
        policy.returnUnallocatedVVV();
        assertEq(vvv.balanceOf(policy.vault()), 10 ether);
        assertEq(vvv.balanceOf(address(policy)), 0);
        assertEq(tokens.totalSupplyOf(id), supplyBefore);
        assertEq(policy.totalAllocated(), 10 ether);
        assertEq(10 ether + _reserve(id) + (_reserve(feeProjectId) - feesBefore), 100 ether);
        assertEq(_reserve(id), 74.768_306_8 ether + net - 10 ether);
        _row(
            "allocation_cap_10_vvv", 4000, 6000, 100 ether, 10 ether, _reserve(id), _reserve(feeProjectId) - feesBefore
        );

        _fund(id, 10 ether);
        uint256 reserveBefore = _reserve(id);
        policy.burnLateProduction();
        assertEq(tokens.totalBalanceOf(address(policy), id), 0);
        assertEq(policy.totalAllocated(), 10 ether);
        assertEq(_reserve(id), reserveBefore);
    }

    function _enableVVVFeeTerminal() internal {
        projects.approve(address(revDeployer), feeProjectId);
        _deploy(feeProjectId, address(this), 0, 0);
    }

    /// @notice Keep independent observations in separate call frames to bound fixture compiler stack use.
    function observeScales(uint16 split, uint16 tax) external {
        (uint256 unitNet, uint256 unitReserve) = this.observe(split, tax, 1 ether);
        (uint256 net, uint256 reserve) = this.observe(split, tax, 100 ether);
        assertApproxEqAbs(net, unitNet * 100, 100);
        assertApproxEqAbs(reserve, unitReserve * 100, 100);
        (net, reserve) = this.observe(split, tax, 10_000 ether);
        assertApproxEqAbs(net, unitNet * 10_000, 10_000);
        assertApproxEqAbs(reserve, unitReserve * 10_000, 10_000);
    }

    /// @notice Execute one independent stock deployment and report its exact VVV balances.
    function observe(uint16 split, uint16 tax, uint256 amount) external returns (uint256 net, uint256 reserve) {
        (uint256 id, ProjectPolicy policy) = _launch(split, tax, 1 ether, 1e30, 1e30);
        uint256 feeBefore = _reserve(feeProjectId);
        _fund(id, amount);
        uint256 count = tokens.totalBalanceOf(address(policy), id);
        assertEq(count, amount * 1000 * split / 10_000);
        net = policy.cashOutProduction(count, vm.getBlockTimestamp() + 60);
        reserve = _reserve(id);
        uint256 fees = _reserve(feeProjectId) - feeBefore;
        assertGt(net, 0);
        assertLe(net, amount * split / 10_000);
        assertEq(net + reserve + fees, amount, "VVV must reconcile including actual fee destination");
        assertEq(tokens.totalBalanceOf(address(policy), id), 0);
        if (split == 4000 && tax == 1000) {
            // Current preset: 0.39 * (0.9 + 0.1 * 0.39) * 0.975 = 0.35705475.
            assertEq(net, amount * 35_705_475 / 100_000_000);
        }
        if (split == 4000 && tax == 6000) {
            // Historical 60% tax comparison: 0.39 * (0.4 + 0.6 * 0.39) * 0.975 = 0.2410785.
            assertEq(net, amount * 2_410_785 / 10_000_000);
        }
        _row("matrix", split, tax, amount, net, reserve, fees);
    }

    function _launch(
        uint16 split,
        uint16 tax,
        uint128 minimum,
        uint128 maximum,
        uint128 cap
    )
        internal
        returns (uint256 id, ProjectPolicy policy)
    {
        policy = new ProjectPolicy(
            address(this),
            address(this),
            address(0xBEEF),
            controller,
            terminal,
            vvv,
            TelligencePolicyConfig({
                conversionCadence: 1 days,
                minBatchTokens: minimum,
                maxBatchTokens: maximum,
                minVVVPerProjectToken: 1,
                minDiemPerVVV: 1,
                maxPrincipal: cap
            })
        );
        id = _deploy(0, address(policy), split, tax);
        policy.bind(id, address(new PolicyVault(address(policy), vvv)));
    }

    function _deploy(uint256 id, address operator, uint16 split, uint16 tax) internal returns (uint256 deployedId) {
        JBSplit[] memory destinations = new JBSplit[](1);
        destinations[0] = JBSplit({
            percent: 1_000_000_000,
            projectId: 0,
            beneficiary: payable(operator),
            preferAddToBalance: false,
            lockedUntil: type(uint48).max,
            hook: IJBSplitHook(address(0))
        });
        REVStageConfig[] memory stages = new REVStageConfig[](1);
        stages[0] = REVStageConfig({
            startsAtOrAfter: uint48(vm.getBlockTimestamp()),
            autoIssuances: new REVAutoIssuance[](0),
            splitPercent: split,
            splits: destinations,
            initialIssuance: 1000 ether,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: tax,
            extraMetadata: 0
        });
        JBAccountingContext[] memory contexts = new JBAccountingContext[](1);
        contexts[0] = JBAccountingContext({token: VVV_ADDRESS, decimals: 18, currency: uint32(uint160(VVV_ADDRESS))});
        (deployedId,) = revDeployer.deployFor(
            id,
            REVConfig({
                description: REVDescription({
                    name: "Compute economic observation",
                    ticker: "ECON",
                    uri: "ipfs://economic-fixture",
                    salt: bytes32(++sequence)
                }),
                baseCurrency: uint32(uint160(VVV_ADDRESS)),
                operator: operator,
                scopeCashOutsToLocalBalances: true,
                stageConfigurations: stages
            }),
            contexts,
            REVSuckerDeploymentConfig({deployerConfigurations: new JBSuckerDeployerConfig[](0), salt: bytes32(0)})
        );
    }

    function _fund(uint256 id, uint256 amount) internal {
        vvv.mint(supporter, amount);
        vm.startPrank(supporter);
        vvv.approve(address(terminal), amount);
        terminal.pay(id, VVV_ADDRESS, amount, supporter, 0, "compute economics", "");
        vm.stopPrank();
        controller.sendReservedTokensToSplitsOf(id);
    }

    function _reserve(uint256 id) internal view returns (uint256) {
        return terminalStore.balanceOf(address(terminal), id, VVV_ADDRESS);
    }

    function _row(
        string memory label,
        uint256 split,
        uint256 tax,
        uint256 amount,
        uint256 net,
        uint256 reserve,
        uint256 fees
    )
        internal
        pure
    {
        console2.log(
            string.concat(
                label,
                ",",
                vm.toString(split),
                ",",
                vm.toString(tax),
                ",",
                vm.toString(amount),
                ",",
                vm.toString(net),
                ",",
                vm.toString(reserve),
                ",",
                vm.toString(fees)
            )
        );
    }
}
