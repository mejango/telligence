// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StockV6Fixture} from "./helpers/StockV6Fixture.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";
import {JBSuckerDeployerConfig} from "@bananapus/suckers-v6/src/structs/JBSuckerDeployerConfig.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {IJBSplitHook} from "@bananapus/core-v6/src/interfaces/IJBSplitHook.sol";

/// @notice An independent economic baseline for the wrapper integration tests.
contract StockV6AccountingTest is StockV6Fixture {
    function setUp() public {
        _deployStockV6();
    }

    function test_stockV6_acceptsVVV_distributesProduction_andAddsBalanceWithoutMinting() public {
        address supporter = makeAddr("supporter");
        address productionBeneficiary = makeAddr("productionBeneficiary");
        JBSplit[] memory productionSplits = new JBSplit[](1);
        productionSplits[0] = JBSplit({
            percent: 1_000_000_000,
            projectId: 0,
            beneficiary: payable(productionBeneficiary),
            preferAddToBalance: false,
            lockedUntil: type(uint48).max,
            hook: IJBSplitHook(address(0))
        });
        REVStageConfig[] memory stages = new REVStageConfig[](1);
        stages[0] = REVStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            autoIssuances: new REVAutoIssuance[](0),
            splitPercent: 4000,
            splits: productionSplits,
            initialIssuance: 1000e18,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            extraMetadata: 0
        });
        REVConfig memory configuration = REVConfig({
            description: REVDescription({
                name: "Stock compute", ticker: "STOCK", uri: "ipfs://compute", salt: bytes32("stock")
            }),
            baseCurrency: uint32(uint160(VVV_ADDRESS)),
            operator: productionBeneficiary,
            scopeCashOutsToLocalBalances: true,
            stageConfigurations: stages
        });
        JBAccountingContext[] memory accountingContexts = new JBAccountingContext[](1);
        accountingContexts[0] =
            JBAccountingContext({token: VVV_ADDRESS, decimals: 18, currency: uint32(uint160(VVV_ADDRESS))});
        (uint256 revnetId,) = revDeployer.deployFor(
            0,
            configuration,
            accountingContexts,
            REVSuckerDeploymentConfig({salt: bytes32(0), deployerConfigurations: new JBSuckerDeployerConfig[](0)})
        );

        vvv.mint(supporter, 100e18);
        vm.startPrank(supporter);
        vvv.approve(address(terminal), 100e18);
        terminal.pay(revnetId, VVV_ADDRESS, 100e18, supporter, 0, "fund compute", "");
        vm.stopPrank();
        controller.sendReservedTokensToSplitsOf(revnetId);
        assertEq(tokens.totalBalanceOf(supporter, revnetId), 60_000e18);
        assertEq(tokens.totalBalanceOf(productionBeneficiary, revnetId), 40_000e18);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), 100e18);

        uint256 productionTokens = tokens.totalBalanceOf(productionBeneficiary, revnetId);
        vm.prank(productionBeneficiary);
        terminal.cashOutTokensOf(
            productionBeneficiary, revnetId, productionTokens, VVV_ADDRESS, 0, payable(productionBeneficiary), ""
        );
        uint256 recovered = vvv.balanceOf(productionBeneficiary);
        assertGt(recovered, 0);
        assertLt(recovered, 40e18);
        uint256 supplyBeforeReturn = tokens.totalSupplyOf(revnetId);
        uint256 balanceBeforeReturn = terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS);

        vm.startPrank(productionBeneficiary);
        vvv.approve(address(terminal), recovered);
        terminal.addToBalanceOf(revnetId, VVV_ADDRESS, recovered, false, "return compute backing", "");
        vm.stopPrank();
        assertEq(tokens.totalSupplyOf(revnetId), supplyBeforeReturn);
        assertEq(terminalStore.balanceOf(address(terminal), revnetId, VVV_ADDRESS), balanceBeforeReturn + recovered);
    }
}
