// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {JBPermissions} from "@bananapus/core-v6/src/JBPermissions.sol";
import {JBProjects} from "@bananapus/core-v6/src/JBProjects.sol";
import {JBDirectory} from "@bananapus/core-v6/src/JBDirectory.sol";
import {JBPrices} from "@bananapus/core-v6/src/JBPrices.sol";
import {JBRulesets} from "@bananapus/core-v6/src/JBRulesets.sol";
import {JBERC20} from "@bananapus/core-v6/src/JBERC20.sol";
import {JBTokens} from "@bananapus/core-v6/src/JBTokens.sol";
import {JBSplits} from "@bananapus/core-v6/src/JBSplits.sol";
import {JBFundAccessLimits} from "@bananapus/core-v6/src/JBFundAccessLimits.sol";
import {JBFeelessAddresses} from "@bananapus/core-v6/src/JBFeelessAddresses.sol";
import {JBController} from "@bananapus/core-v6/src/JBController.sol";
import {JBTerminalStore} from "@bananapus/core-v6/src/JBTerminalStore.sol";
import {JBMultiTerminal} from "@bananapus/core-v6/src/JBMultiTerminal.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {IJBRulesetDataHook} from "@bananapus/core-v6/src/interfaces/IJBRulesetDataHook.sol";
import {JBBeforePayRecordedContext} from "@bananapus/core-v6/src/structs/JBBeforePayRecordedContext.sol";
import {JBBeforeCashOutRecordedContext} from "@bananapus/core-v6/src/structs/JBBeforeCashOutRecordedContext.sol";
import {JBPayHookSpecification} from "@bananapus/core-v6/src/structs/JBPayHookSpecification.sol";
import {JBCashOutHookSpecification} from "@bananapus/core-v6/src/structs/JBCashOutHookSpecification.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JB721TiersHookStore} from "@bananapus/721-hook-v6/src/JB721TiersHookStore.sol";
import {JB721CheckpointsDeployer} from "@bananapus/721-hook-v6/src/JB721CheckpointsDeployer.sol";
import {JB721TiersHook} from "@bananapus/721-hook-v6/src/JB721TiersHook.sol";
import {JB721TiersHookDeployer} from "@bananapus/721-hook-v6/src/JB721TiersHookDeployer.sol";
import {JBAddressRegistry} from "@bananapus/address-registry-v6/src/JBAddressRegistry.sol";
import {IJBBuybackHookRegistry} from "@bananapus/buyback-hook-v6/src/interfaces/IJBBuybackHookRegistry.sol";
import {JBSuckerRegistry} from "@bananapus/suckers-v6/src/JBSuckerRegistry.sol";
import {CTPublisher} from "@croptop/core-v6/src/CTPublisher.sol";
import {REVDeployer} from "@rev-net/core-v6/src/REVDeployer.sol";
import {REVOwner} from "@rev-net/core-v6/src/REVOwner.sol";
import {REVLoans} from "@rev-net/core-v6/src/REVLoans.sol";
import {IPermit2} from "@uniswap/permit2/src/interfaces/IPermit2.sol";

/// @notice ERC-20 standing in for canonical VVV without a fork/RPC dependency.
contract FixtureVVV is ERC20 {
    constructor() ERC20("Venice Token", "VVV") {}

    function mint(address beneficiary, uint256 amount) external {
        _mint(beneficiary, amount);
    }
}

/// @notice Models the stock buyback hook's no-liquidity route. The deployer and owner are real stock contracts.
/// @dev These tests prove core accounting integration, not AMM execution or a Base deployment's bytecode.
contract NoLiquidityBuybackFixture is IJBRulesetDataHook {
    function beforePayRecordedWith(JBBeforePayRecordedContext calldata context)
        external
        pure
        returns (uint256 weight, JBPayHookSpecification[] memory specifications)
    {
        return (context.weight, new JBPayHookSpecification[](0));
    }

    function beforeCashOutRecordedWith(JBBeforeCashOutRecordedContext calldata context)
        external
        pure
        returns (uint256, uint256, uint256, uint256, JBCashOutHookSpecification[] memory)
    {
        return (
            context.cashOutTaxRate,
            context.cashOutCount,
            context.totalSupply,
            context.surplus.value,
            new JBCashOutHookSpecification[](0)
        );
    }

    function hasMintPermissionFor(uint256, JBRuleset calldata, address) external pure returns (bool) {
        return false;
    }

    function initializePoolFor(uint256, uint24, int24, uint256, address, uint160) external pure {}

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IJBRulesetDataHook).interfaceId || interfaceId == 0x01ffc9a7;
    }
}

/// @notice Deploys stock V6 core, 721, loans, owner, and deployer in a deterministic local test environment.
/// @dev Deliberately independent of upstream test helpers, deployment artifacts, and RPC services.
abstract contract StockV6Fixture is Test {
    address internal constant VVV_ADDRESS = 0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf;
    address internal constant FORWARDER = address(0x2771);
    IPermit2 internal constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    FixtureVVV internal vvv;
    JBPermissions internal permissions;
    JBProjects internal projects;
    JBDirectory internal directory;
    JBPrices internal prices;
    JBRulesets internal rulesets;
    JBTokens internal tokens;
    JBSplits internal splits;
    JBController internal controller;
    JBTerminalStore internal terminalStore;
    JBMultiTerminal internal terminal;
    JBFeelessAddresses internal feeless;
    REVDeployer internal revDeployer;
    REVOwner internal revOwner;
    REVLoans internal loans;
    JBSuckerRegistry internal suckerRegistry;
    uint256 internal feeProjectId;

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function _deployStockV6() internal {
        vm.chainId(8453);
        vm.warp(1_800_000_000);
        FixtureVVV tokenImplementation = new FixtureVVV();
        vm.etch(VVV_ADDRESS, address(tokenImplementation).code);
        vvv = FixtureVVV(VVV_ADDRESS);

        permissions = new JBPermissions(FORWARDER);
        projects = new JBProjects(address(this), address(0), FORWARDER);
        directory = new JBDirectory(permissions, projects, address(this));
        JBERC20 tokenImplementationV6 = new JBERC20(permissions, projects);
        tokens = new JBTokens(directory, tokenImplementationV6);
        rulesets = new JBRulesets(directory);
        prices = new JBPrices(directory, permissions, projects, address(this), FORWARDER);
        splits = new JBSplits(directory);
        JBFundAccessLimits fundAccessLimits = new JBFundAccessLimits(directory);
        feeless = new JBFeelessAddresses(address(this));
        controller = new JBController(
            directory, fundAccessLimits, permissions, prices, projects, rulesets, splits, tokens, address(0), FORWARDER
        );
        directory.setIsAllowedToSetFirstController(address(controller), true);
        terminalStore = new JBTerminalStore(directory, prices, rulesets);
        terminal =
            new JBMultiTerminal(feeless, permissions, projects, splits, terminalStore, tokens, PERMIT2, FORWARDER);
        feeProjectId = projects.createFor(address(this));
        suckerRegistry = new JBSuckerRegistry(directory, permissions, prices, address(this), FORWARDER);
        loans = new REVLoans(controller, terminal, suckerRegistry, feeProjectId, address(this), PERMIT2, FORWARDER);
        IJBBuybackHookRegistry buyback = _makeBuybackRegistry();
        revOwner = new REVOwner(
            IJBBuybackHookRegistry(address(buyback)),
            directory,
            feeProjectId,
            suckerRegistry,
            loans,
            FORWARDER,
            address(this)
        );

        JB721TiersHookStore hookStore = new JB721TiersHookStore();
        JB721TiersHook hookImplementation = new JB721TiersHook(
            directory,
            permissions,
            prices,
            rulesets,
            hookStore,
            splits,
            new JB721CheckpointsDeployer(hookStore),
            FORWARDER
        );
        JB721TiersHookDeployer hookDeployer =
            new JB721TiersHookDeployer(hookImplementation, hookStore, new JBAddressRegistry(), FORWARDER);
        CTPublisher publisher = new CTPublisher(directory, permissions, feeProjectId, PERMIT2, FORWARDER);
        revDeployer = new REVDeployer(
            controller,
            terminal,
            IJBTerminal(address(0)),
            suckerRegistry,
            feeProjectId,
            hookDeployer,
            publisher,
            IJBBuybackHookRegistry(address(buyback)),
            loans,
            FORWARDER,
            address(revOwner)
        );
        revOwner.setDeployer(revDeployer);
    }

    /// @notice Override only routing integration while retaining the complete stock accounting deployment.
    function _makeBuybackRegistry() internal virtual returns (IJBBuybackHookRegistry) {
        return IJBBuybackHookRegistry(address(new NoLiquidityBuybackFixture()));
    }
}
