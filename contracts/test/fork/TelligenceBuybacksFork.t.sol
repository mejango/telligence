// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {StockV6Fixture} from "../integration/helpers/StockV6Fixture.sol";
import {PolicyVault} from "../unit/ProjectPolicy.t.sol";
import {ProjectPolicy} from "../../src/ProjectPolicy.sol";
import {TelligenceFactory} from "../../src/TelligenceFactory.sol";
import {TelligenceComputeVaultDeployer} from "../../src/TelligenceComputeVaultDeployer.sol";
import {ITelligenceComputeVaultDeployer} from "../../src/interfaces/ITelligenceComputeVaultDeployer.sol";
import {IVeniceStaking} from "../../src/interfaces/IVeniceStaking.sol";
import {IVeniceDiem} from "../../src/interfaces/IVeniceDiem.sol";
import {TelligenceStageConfig} from "../../src/structs/TelligenceStageConfig.sol";
import {VaultVVVMock, VaultDiemMock, VaultStakingMock} from "../helpers/VeniceMocks.sol";
import {TelligencePolicyConfig} from "../../src/structs/TelligencePolicyConfig.sol";
import {JBBuybackHook} from "@bananapus/buyback-hook-v6/src/JBBuybackHook.sol";
import {JBBuybackHookRegistry} from "@bananapus/buyback-hook-v6/src/JBBuybackHookRegistry.sol";
import {IJBBuybackHookRegistry} from "@bananapus/buyback-hook-v6/src/interfaces/IJBBuybackHookRegistry.sol";
import {IJBRulesetDataHook} from "@bananapus/core-v6/src/interfaces/IJBRulesetDataHook.sol";
import {IJBSplitHook} from "@bananapus/core-v6/src/interfaces/IJBSplitHook.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {JBSuckerDeployerConfig} from "@bananapus/suckers-v6/src/structs/JBSuckerDeployerConfig.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Supplies liquidity and performs ordinary market trades through actual V4 settlement callbacks.
contract TelligencePoolParticipant is IUnlockCallback {
    IPoolManager internal immutable MANAGER;

    constructor(IPoolManager manager) {
        MANAGER = manager;
    }

    function addLiquidity(PoolKey memory key, int256 liquidity) external {
        MANAGER.unlock(abi.encode(uint8(0), key, liquidity, false));
    }

    function swap(PoolKey memory key, uint256 amount, bool zeroForOne) external {
        MANAGER.unlock(abi.encode(uint8(1), key, int256(amount), zeroForOne));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(MANAGER));
        (uint8 operation, PoolKey memory key, int256 amount, bool zeroForOne) =
            abi.decode(data, (uint8, PoolKey, int256, bool));
        BalanceDelta delta;
        if (operation == 0) {
            (delta,) = MANAGER.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: -887_200, tickUpper: 887_200, liquidityDelta: amount, salt: bytes32(0)
                }),
                ""
            );
        } else {
            delta = MANAGER.swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -amount,
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );
        }
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount < 0) {
            MANAGER.sync(currency);
            require(IERC20(Currency.unwrap(currency)).transfer(address(MANAGER), uint256(uint128(-amount))));
            MANAGER.settle();
        } else if (amount > 0) {
            MANAGER.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}

/// @notice Tests stock Revnet buyback production and policy cashout on genuine Base Uniswap pools and oracle history.
/// @dev All changes happen in a local fork. The test does not broadcast, use live users' assets, or modify core
/// contracts.
contract TelligenceBuybacksForkTest is StockV6Fixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    IPoolManager internal constant MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    IHooks internal constant ORACLE = IHooks(0xf70B71605f1C0A8Ff7580557645BB7e29fE495c8);
    JBBuybackHook internal buyback;
    ProjectPolicy internal policy;
    TelligencePoolParticipant internal participant;
    uint256 internal projectId;
    PoolKey internal key;
    address internal supporter = address(0xB0B);

    function setUp() public {
        vm.createSelectFork("base", 51_091_381);
        assertGt(address(MANAGER).code.length, 0);
        assertGt(address(ORACLE).code.length, 0);
        _deployStockV6();
        policy = new ProjectPolicy(
            address(this),
            address(this),
            address(0xBEEF),
            controller,
            terminal,
            vvv,
            TelligencePolicyConfig({
                conversionCadence: 1 days,
                minBatchTokens: 1 ether,
                maxBatchTokens: 10_000 ether,
                minVVVPerProjectToken: 1e14,
                minDiemPerVVV: 1e17,
                maxPrincipal: 1000 ether
            })
        );
        _launch();
        policy.bind(projectId, address(new PolicyVault(address(policy), vvv)));
        _pay(supporter, 10_000 ether);
        controller.sendReservedTokensToSplitsOf(projectId);
        key = buyback.poolKeyOf(projectId, VVV_ADDRESS);
        assertEq(Currency.unwrap(key.currency0) < Currency.unwrap(key.currency1), true);
        participant = new TelligencePoolParticipant(MANAGER);
        IERC20 projectToken = IERC20(address(tokens.tokenOf(projectId)));
        vm.prank(supporter);
        projectToken.transfer(address(participant), 5_500_000 ether);
        vvv.mint(address(participant), 10_000 ether);
        participant.addLiquidity(key, 100_000 ether);
    }

    function test_RealBuybackPreservesProductionAndCashoutReceivesVVVOutsideTerminalReclaim() public {
        // An ordinary market sale makes buying existing tokens better than direct issuance.
        participant.swap(key, 1_000_000 ether, Currency.unwrap(key.currency0) != VVV_ADDRESS);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        uint256 productionBefore = tokens.totalBalanceOf(address(policy), projectId);
        uint256 supplyBefore = tokens.totalSupplyOf(projectId);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), projectId, VVV_ADDRESS);
        vm.recordLogs();
        _pay(address(0xCAFE), 1 ether);
        Vm.Log[] memory paymentLogs = vm.getRecordedLogs();
        assertTrue(
            _hasEvent(paymentLogs, address(buyback), keccak256("Swap(uint256,uint256,bytes32,uint256,address)")),
            "real buyback Swap event required"
        );
        controller.sendReservedTokensToSplitsOf(projectId);
        assertGt(tokens.totalBalanceOf(address(policy), projectId), productionBefore);
        assertGt(tokens.totalBalanceOf(address(0xCAFE), projectId), 600 ether);
        assertLt(terminalStore.balanceOf(address(terminal), projectId, VVV_ADDRESS) - reserveBefore, 1 ether);
        assertEq(
            tokens.totalSupplyOf(projectId),
            supplyBefore,
            "AMM tokens are burned/reminted with production, preserving supply"
        );

        uint256 policyVVVBefore = vvv.balanceOf(address(policy));
        vm.recordLogs();
        uint256 received = policy.cashOutProduction(10_000 ether, vm.getBlockTimestamp() + 60);
        Vm.Log[] memory cashoutLogs = vm.getRecordedLogs();
        assertTrue(
            _hasEvent(cashoutLogs, address(buyback), keccak256("CashOutSwap(uint256,uint256,bytes32,uint256,address)")),
            "real sell swap required"
        );
        assertGt(received, 0);
        assertEq(vvv.balanceOf(address(policy)) - policyVVVBefore, received);
        assertEq(_terminalReclaimed(cashoutLogs), 0, "terminal reports zero on real AMM route");
    }

    function test_RealBuybackRoutesComputeAndCreatorAllocationsThroughFactoryWithoutInflatingSupply() public {
        _launchCreatorProject();
        _pay(supporter, 10_000 ether);
        controller.sendReservedTokensToSplitsOf(projectId);
        key = buyback.poolKeyOf(projectId, VVV_ADDRESS);
        participant = new TelligencePoolParticipant(MANAGER);
        IERC20 projectToken = IERC20(address(tokens.tokenOf(projectId)));
        vm.prank(supporter);
        projectToken.transfer(address(participant), 4_500_000 ether);
        vvv.mint(address(participant), 10_000 ether);
        participant.addLiquidity(key, 100_000 ether);
        participant.swap(key, 1_000_000 ether, Currency.unwrap(key.currency0) != VVV_ADDRESS);
        vm.warp(vm.getBlockTimestamp() + 2 days);

        uint256 computeBefore = tokens.totalBalanceOf(address(policy), projectId);
        uint256 creatorBefore = tokens.totalBalanceOf(address(this), projectId);
        uint256 ownerBefore = tokens.totalBalanceOf(address(revOwner), projectId);
        uint256 supplyBefore = tokens.totalSupplyOf(projectId);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), projectId, VVV_ADDRESS);
        vm.recordLogs();
        _pay(address(0xCAFE), 1 ether);
        Vm.Log[] memory paymentLogs = vm.getRecordedLogs();
        assertTrue(
            _hasEvent(paymentLogs, address(buyback), keccak256("Swap(uint256,uint256,bytes32,uint256,address)")),
            "creator allocation must retain the genuine buyback route"
        );
        controller.sendReservedTokensToSplitsOf(projectId);
        uint256 computeTokens = tokens.totalBalanceOf(address(policy), projectId) - computeBefore;
        uint256 creatorTokens = tokens.totalBalanceOf(address(this), projectId) - creatorBefore;
        uint256 supporterTokens = tokens.totalBalanceOf(address(0xCAFE), projectId);
        uint256 ownerDust = tokens.totalBalanceOf(address(revOwner), projectId) - ownerBefore;
        assertGt(creatorTokens, 0, "creator receives the declared share from the real buyback remint");
        assertGt(computeTokens, 0);
        assertGt(supporterTokens, 500 ether, "buyback beats the 50% direct supporter allocation");
        assertApproxEqAbs(computeTokens, creatorTokens * 4, 4, "reserved weights preserve compute 40 / creator 10");
        uint256 redistributed = computeTokens + creatorTokens + supporterTokens + ownerDust;
        assertEq(supporterTokens, redistributed / 2, "supporter receives half of the acquired token issuance");
        assertLe(ownerDust, 1);
        assertEq(tokens.totalSupplyOf(projectId), supplyBefore, "buyback burn/remint conserves token supply");
        assertEq(controller.pendingReservedTokenBalanceOf(projectId), 0);
        assertLt(terminalStore.balanceOf(address(terminal), projectId, VVV_ADDRESS) - reserveBefore, 1 ether);
        assertTrue(revOwner.isOperatorOf(projectId, address(policy)));
        assertFalse(revOwner.isOperatorOf(projectId, address(this)));

        uint256 policyVVVBefore = vvv.balanceOf(address(policy));
        vm.recordLogs();
        uint256 received = policy.cashOutProduction(10_000 ether, vm.getBlockTimestamp() + 60);
        Vm.Log[] memory cashoutLogs = vm.getRecordedLogs();
        assertTrue(
            _hasEvent(cashoutLogs, address(buyback), keccak256("CashOutSwap(uint256,uint256,bytes32,uint256,address)")),
            "compute production still exits through the genuine AMM"
        );
        assertGt(received, 0);
        assertEq(vvv.balanceOf(address(policy)) - policyVVVBefore, received);
        assertEq(_terminalReclaimed(cashoutLogs), 0);
        assertEq(tokens.totalBalanceOf(address(this), projectId), creatorBefore + creatorTokens);
    }

    function test_RealAMMOutputBelowPolicyFloorRevertsEveryPoolAndTreasuryMovement() public {
        vm.warp(vm.getBlockTimestamp() + 2 days);
        policy.raiseMinimumOutputs(1 ether, 1e17);
        uint256 heldBefore = tokens.totalBalanceOf(address(policy), projectId);
        uint256 reserveBefore = terminalStore.balanceOf(address(terminal), projectId, VVV_ADDRESS);
        (uint160 priceBefore,,,) = MANAGER.getSlot0(key.toId());
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InsufficientOutput.selector);
        policy.cashOutProduction(10_000 ether, vm.getBlockTimestamp() + 60);
        assertEq(tokens.totalBalanceOf(address(policy), projectId), heldBefore);
        assertEq(terminalStore.balanceOf(address(terminal), projectId, VVV_ADDRESS), reserveBefore);
        (uint160 priceAfter,,,) = MANAGER.getSlot0(key.toId());
        assertEq(priceAfter, priceBefore);
        assertEq(policy.nextConversionAt(), 0);
    }

    /// @notice Use the actual factory for the new allocation while retaining the original zero-creator cases.
    /// @dev Only the provider adapter is modeled here; core, factory, hook, manager, and oracle execute normally.
    function _launchCreatorProject() internal {
        VaultDiemMock diem = new VaultDiemMock();
        VaultStakingMock staking = new VaultStakingMock(VaultVVVMock(VVV_ADDRESS), diem);
        diem.setMinter(address(staking));
        TelligenceComputeVaultDeployer vaultDeployer = new TelligenceComputeVaultDeployer(
            IERC20(VVV_ADDRESS), IVeniceStaking(address(staking)), IVeniceDiem(address(diem))
        );
        TelligenceFactory factory =
            new TelligenceFactory(revDeployer, ITelligenceComputeVaultDeployer(address(vaultDeployer)));
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
        (projectId, policy,) = factory.deployFor(
            REVDescription({
                name: "Creator buyback compute", ticker: "CBC", uri: "ipfs://creator-buyback", salt: bytes32("creator")
            }),
            stages,
            TelligencePolicyConfig({
                conversionCadence: 1 days,
                minBatchTokens: 1 ether,
                maxBatchTokens: 10_000 ether,
                minVVVPerProjectToken: 1e14,
                minDiemPerVVV: 1e17,
                maxPrincipal: 1000 ether
            }),
            address(0xBEEF),
            address(0x5151)
        );
    }

    function _makeBuybackRegistry() internal override returns (IJBBuybackHookRegistry registry) {
        JBBuybackHookRegistry deployed = new JBBuybackHookRegistry(permissions, projects, address(this), FORWARDER);
        buyback = new JBBuybackHook(directory, permissions, prices, projects, tokens, address(this), FORWARDER);
        buyback.setChainSpecificConstants(MANAGER, ORACLE);
        deployed.setDefaultHook(IJBRulesetDataHook(address(buyback)));
        return IJBBuybackHookRegistry(address(deployed));
    }

    function _pay(address payer, uint256 amount) internal {
        vvv.mint(payer, amount);
        vm.startPrank(payer);
        vvv.approve(address(terminal), amount);
        terminal.pay(projectId, VVV_ADDRESS, amount, payer, 0, "compute", "");
        vm.stopPrank();
    }

    function _launch() internal {
        JBSplit[] memory production = new JBSplit[](1);
        production[0] = JBSplit({
            percent: 1_000_000_000,
            projectId: 0,
            beneficiary: payable(address(policy)),
            preferAddToBalance: false,
            lockedUntil: type(uint48).max,
            hook: IJBSplitHook(address(0))
        });
        REVStageConfig[] memory stages = new REVStageConfig[](1);
        stages[0] = REVStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            autoIssuances: new REVAutoIssuance[](0),
            splitPercent: 4000,
            splits: production,
            initialIssuance: 1000 ether,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            extraMetadata: 0
        });
        JBAccountingContext[] memory contexts = new JBAccountingContext[](1);
        contexts[0] = JBAccountingContext({token: VVV_ADDRESS, decimals: 18, currency: uint32(uint160(VVV_ADDRESS))});
        (projectId,) = revDeployer.deployFor(
            0,
            REVConfig({
                description: REVDescription({
                    name: "Real buyback compute",
                    ticker: "RBC",
                    uri: "ipfs://real-buyback",
                    salt: bytes32("real-buyback")
                }),
                baseCurrency: uint32(uint160(VVV_ADDRESS)),
                operator: address(policy),
                scopeCashOutsToLocalBalances: true,
                stageConfigurations: stages
            }),
            contexts,
            REVSuckerDeploymentConfig({deployerConfigurations: new JBSuckerDeployerConfig[](0), salt: bytes32(0)})
        );
    }

    function _hasEvent(Vm.Log[] memory logs, address emitter, bytes32 signature) internal pure returns (bool) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == signature) return true;
        }
        return false;
    }

    function _terminalReclaimed(Vm.Log[] memory logs) internal view returns (uint256) {
        bytes32 signature =
            keccak256("CashOutTokens(uint256,uint256,uint256,address,address,uint256,uint256,uint256,bytes,address)");
        for (uint256 i; i < logs.length; i++) {
            if (
                logs[i].emitter == address(terminal) && logs[i].topics[0] == signature
                    && uint256(logs[i].topics[3]) == projectId
            ) {
                // The full event layout is checked when the genuine terminal emits it.
                (,,,, uint256 reclaimAmount,,) =
                    abi.decode(logs[i].data, (address, address, uint256, uint256, uint256, bytes, address));
                return reclaimAmount;
            }
        }
        revert("missing terminal CashOutTokens event");
    }
}
