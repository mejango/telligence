// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StockV6Fixture, FixtureVVV} from "./helpers/StockV6Fixture.sol";
import {VaultVVVMock, VaultDiemMock, VaultStakingMock} from "../helpers/VeniceMocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {TelligenceFactory} from "../../src/TelligenceFactory.sol";
import {ProjectPolicy} from "../../src/ProjectPolicy.sol";
import {TelligenceComputeVault} from "../../src/TelligenceComputeVault.sol";
import {TelligenceComputeVaultDeployer} from "../../src/TelligenceComputeVaultDeployer.sol";
import {IVeniceStaking} from "../../src/interfaces/IVeniceStaking.sol";
import {IVeniceDiem} from "../../src/interfaces/IVeniceDiem.sol";
import {TelligencePolicyConfig} from "../../src/structs/TelligencePolicyConfig.sol";
import {TelligenceStageConfig} from "../../src/structs/TelligenceStageConfig.sol";
import {TelligenceVaultState} from "../../src/enums/TelligenceVaultState.sol";

/// @notice Exercises actions in adversarial order against real core contracts, including provider shutdown races.
contract TelligenceLifecycleHandler is Test {
    FixtureVVV public immutable VVV;
    IJBController public immutable CONTROLLER;
    IJBTerminal public immutable TERMINAL;
    VaultStakingMock public immutable STAKING;
    VaultDiemMock public immutable DIEM;
    ProjectPolicy public immutable POLICY;
    TelligenceComputeVault public immutable VAULT;
    uint256 public immutable REVNET_ID;

    constructor(TelligenceFactory factory, FixtureVVV vvv, VaultStakingMock staking, VaultDiemMock diem) {
        VVV = vvv;
        STAKING = staking;
        DIEM = diem;
        CONTROLLER = factory.REV_DEPLOYER().CONTROLLER();
        TERMINAL = factory.REV_DEPLOYER().MULTI_TERMINAL();
        TelligenceStageConfig[] memory stages = new TelligenceStageConfig[](1);
        stages[0] = TelligenceStageConfig({
            startsAtOrAfter: uint48(block.timestamp),
            splitPercent: 4000,
            initialIssuance: 1000e18,
            issuanceCutFrequency: 0,
            issuanceCutPercent: 0,
            cashOutTaxRate: 6000,
            operatorSplitPercent: 0
        });
        (uint256 projectId, ProjectPolicy policy, TelligenceComputeVault vault) = factory.deployFor(
            REVDescription({
                name: "Stateful compute", ticker: "STATE", uri: "ipfs://stateful", salt: bytes32("stateful")
            }),
            stages,
            TelligencePolicyConfig({
                    conversionCadence: 1 days,
                    minBatchTokens: 1e18,
                    maxBatchTokens: 50_000e18,
                    minVVVPerProjectToken: 1e12,
                    minDiemPerVVV: 1e17,
                    maxPrincipal: 100e18
                }),
            address(0xBEEF),
            address(0xA017)
        );
        REVNET_ID = projectId;
        POLICY = policy;
        VAULT = vault;
    }

    function fund(uint96 seed) external {
        uint256 amount = bound(uint256(seed), 1e15, 100e18);
        VVV.mint(address(this), amount);
        VVV.approve(address(TERMINAL), amount);
        TERMINAL.pay(REVNET_ID, address(VVV), amount, address(this), 0, "fund compute", "");
        CONTROLLER.sendReservedTokensToSplitsOf(REVNET_ID);
    }

    function convertProduction(uint32 elapsed) external {
        vm.warp(block.timestamp + bound(uint256(elapsed), 0, 2 days));
        uint256 balance = CONTROLLER.TOKENS().totalBalanceOf(address(POLICY), REVNET_ID);
        uint256 batch = balance < POLICY.maxBatchTokens() ? balance : POLICY.maxBatchTokens();
        try POLICY.cashOutProduction(batch, block.timestamp + 60) {} catch {}
    }

    function allocate(uint96 seed) external {
        uint256 balance = VVV.balanceOf(address(POLICY));
        uint256 remaining = POLICY.maxPrincipal() - POLICY.totalAllocated();
        uint256 maximum = balance < remaining ? balance : remaining;
        if (maximum == 0) return;
        uint256 amount = bound(uint256(seed), 1, maximum);
        try POLICY.allocate(amount, block.timestamp + 60) {} catch {}
    }

    function returnReward(uint96 seed) external {
        uint256 amount = bound(uint256(seed), 1, 10e18);
        STAKING.setReward(address(VAULT), amount);
        VAULT.claimRewardsAndReturn();
    }

    function pause(bool paused) external {
        POLICY.setAllocationPaused(paused);
    }

    function advanceWinddown(uint32 elapsed) external {
        vm.warp(block.timestamp + bound(uint256(elapsed), 0, 10 days));
        TelligenceVaultState state = VAULT.state();
        if (state == TelligenceVaultState.Active) {
            POLICY.announceWinddown();
        } else if (state == TelligenceVaultState.Notice) {
            try VAULT.beginDiemUnstake() {} catch {}
        } else if (state == TelligenceVaultState.DiemCooldown) {
            try VAULT.claimDiemAndBeginVVVUnstake() {} catch {}
        } else if (state == TelligenceVaultState.VVVCooldown) {
            try VAULT.claimVVVAndReturn() {} catch {}
        }
        if (POLICY.windingDown()) {
            try POLICY.returnUnallocatedVVV() {} catch {}
            try POLICY.burnLateProduction() {} catch {}
        }
    }
}

/// @notice Stateful custody, debt coverage, and identity invariants over the unmodified V6 accounting stack.
contract TelligenceInvariantTest is StockV6Fixture {
    TelligenceFactory internal factory;
    VaultStakingMock internal staking;
    VaultDiemMock internal diem;
    TelligenceLifecycleHandler internal handler;
    ProjectPolicy internal policy;
    TelligenceComputeVault internal vault;
    uint256 internal projectId;
    bytes32 internal launchPolicyHash;

    function setUp() public {
        _deployStockV6();
        diem = new VaultDiemMock();
        staking = new VaultStakingMock(VaultVVVMock(VVV_ADDRESS), diem);
        diem.setMinter(address(staking));
        TelligenceComputeVaultDeployer vaultDeployer = new TelligenceComputeVaultDeployer(
            IERC20(VVV_ADDRESS), IVeniceStaking(address(staking)), IVeniceDiem(address(diem))
        );
        factory = new TelligenceFactory(revDeployer, vaultDeployer);
        handler = new TelligenceLifecycleHandler(factory, vvv, staking, diem);
        policy = handler.POLICY();
        vault = handler.VAULT();
        projectId = handler.REVNET_ID();
        launchPolicyHash = factory.policyHashOf(projectId);
        // Every campaign begins with actual collateral and DIEM debt, so early shutdown cannot make coverage vacuous.
        handler.fund(10e18);
        handler.convertProduction(0);
        handler.allocate(1e18);
        assertEq(vault.totalAllocated(), 1e18);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.fund.selector;
        selectors[1] = handler.convertProduction.selector;
        selectors[2] = handler.allocate.selector;
        selectors[3] = handler.returnReward.selector;
        selectors[4] = handler.pause.selector;
        selectors[5] = handler.advanceWinddown.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_projectIdentityAndProductionDestinationCannotChange() public view {
        assertEq(factory.creatorOf(projectId), address(handler));
        assertEq(factory.policyOf(projectId), address(policy));
        assertEq(factory.vaultOf(projectId), address(vault));
        assertEq(factory.policyHashOf(projectId), launchPolicyHash);
        assertEq(policy.revnetId(), projectId);
        assertEq(policy.vault(), address(vault));
        assertEq(vault.POLICY(), address(policy));
        assertTrue(revOwner.isOperatorOf(projectId, address(policy)));
        assertEq(projects.ownerOf(projectId), address(revOwner));
        (JBRuleset memory ruleset,) = controller.currentRulesetOf(projectId);
        JBSplit[] memory productionSplits = splits.splitsOf(projectId, ruleset.id, 1);
        assertEq(productionSplits.length, 1);
        assertEq(productionSplits[0].beneficiary, address(policy));
        assertEq(productionSplits[0].percent, 1_000_000_000);
        assertEq(productionSplits[0].lockedUntil, type(uint48).max);
    }

    function invariant_lifetimeAllocationIsBoundedAndAgreesAcrossPolicyAndVault() public view {
        assertLe(policy.totalAllocated(), policy.maxPrincipal());
        assertLe(vault.totalAllocated(), vault.MAX_PRINCIPAL());
        assertEq(policy.totalAllocated(), vault.totalAllocated());
    }

    function invariant_noStandingAssetApprovalSurvivesATransaction() public view {
        assertEq(vvv.allowance(address(policy), address(vault)), 0);
        assertEq(vvv.allowance(address(policy), address(terminal)), 0);
        assertEq(vvv.allowance(address(vault), address(staking)), 0);
        assertEq(vvv.allowance(address(vault), address(policy)), 0);
        assertEq(diem.allowance(address(vault), address(staking)), 0);
    }

    function invariant_allGeneratedVVVRemainsInTreasuryOrItsOwnBacking() public view {
        uint256 controlled = vvv.balanceOf(address(terminal)) + vvv.balanceOf(address(policy))
            + vvv.balanceOf(address(vault)) + vvv.balanceOf(address(staking));
        assertEq(controlled, vvv.totalSupply());
        assertEq(vvv.balanceOf(address(handler)), 0);
        assertEq(vvv.balanceOf(policy.RECOVERY()), 0);
        assertEq(vvv.balanceOf(address(0xA017)), 0);
    }

    function invariant_retainedDiemAlwaysCoversTheVaultsMintObligation() public view {
        (uint256 locked, uint256 debt) = staking.lockedStakes(address(vault));
        (uint256 staked,, uint256 pending) = diem.stakedInfos(address(vault));
        assertGe(staked + pending + diem.balanceOf(address(vault)), debt);
        assertLe(locked, staking.balanceOf(address(vault)));
        if (vault.state() == TelligenceVaultState.Closed) {
            assertEq(debt, 0);
            assertEq(locked, 0);
        }
    }
}
