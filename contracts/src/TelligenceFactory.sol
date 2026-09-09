// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IJBPayerTracker} from "@bananapus/core-v6/src/interfaces/IJBPayerTracker.sol";
import {IJBSplitHook} from "@bananapus/core-v6/src/interfaces/IJBSplitHook.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";
import {JBSuckerDeployerConfig} from "@bananapus/suckers-v6/src/structs/JBSuckerDeployerConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IREVDeployer} from "@rev-net/core-v6/src/interfaces/IREVDeployer.sol";
import {REVAutoIssuance} from "@rev-net/core-v6/src/structs/REVAutoIssuance.sol";
import {REVConfig} from "@rev-net/core-v6/src/structs/REVConfig.sol";
import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {REVStageConfig} from "@rev-net/core-v6/src/structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "@rev-net/core-v6/src/structs/REVSuckerDeploymentConfig.sol";

import {ProjectPolicy} from "./ProjectPolicy.sol";
import {TelligenceComputeVault} from "./TelligenceComputeVault.sol";
import {ITelligenceComputeVaultDeployer} from "./interfaces/ITelligenceComputeVaultDeployer.sol";
import {ITelligenceFactory} from "./interfaces/ITelligenceFactory.sol";
import {TelligencePolicyConfig} from "./structs/TelligencePolicyConfig.sol";
import {TelligenceStageConfig} from "./structs/TelligenceStageConfig.sol";

/// @notice Deploys isolated compute projects using stock Revnet issuance, buybacks, cashouts, and accounting.
/// @dev Protocol integrations are constructor-pinned. There is no owner, upgrade path, or per-launch integration
/// override.
contract TelligenceFactory is ITelligenceFactory, IJBPayerTracker, ReentrancyGuard {
    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice The factory is restricted to Base mainnet's canonical VVV accounting context.
    error TelligenceFactory_WrongChainOrAsset();
    /// @notice A pinned integration is unavailable or inconsistent.
    error TelligenceFactory_InvalidIntegration();
    /// @notice Project identity or recovery/authentication roles are missing.
    error TelligenceFactory_InvalidDescription();
    /// @notice A stage exposes unsupported or unsafe economics.
    /// @param stageIndex The invalid stage's index.
    error TelligenceFactory_InvalidStage(uint256 stageIndex);
    /// @notice The exact stock project creation fee was not provided.
    /// @param expected The required fee.
    /// @param received The supplied amount.
    error TelligenceFactory_IncorrectCreationFee(uint256 expected, uint256 received);
    /// @notice The stock deployment returned an invalid or previously registered project ID.
    error TelligenceFactory_InvalidProject();

    //*********************************************************************//
    // ------------------------- public constants ------------------------ //
    //*********************************************************************//

    /// @notice The only supported network.
    uint256 public constant CHAIN_ID = 8453;
    /// @notice The canonical Base Venice token; identity never comes from its symbol.
    address public constant VVV_ADDRESS = 0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf;
    /// @notice The immutable policy schema version included in every launch commitment.
    uint256 public constant POLICY_VERSION = 2;
    /// @notice The maximum number of stages accepted in a single launch.
    uint256 public constant MAX_STAGES = 16;

    //*********************************************************************//
    // --------------- public immutable stored properties ---------------- //
    //*********************************************************************//

    /// @notice The existing stock Revnet deployer on Base.
    IREVDeployer public immutable REV_DEPLOYER;
    /// @notice The fixed adapter deployer; all projects use its verified Venice integration.
    ITelligenceComputeVaultDeployer public immutable VAULT_DEPLOYER;

    //*********************************************************************//
    // --------------------- public stored properties -------------------- //
    //*********************************************************************//

    /// @inheritdoc ITelligenceFactory
    mapping(uint256 revnetId => address creator) public override creatorOf;
    /// @inheritdoc ITelligenceFactory
    mapping(uint256 revnetId => bytes32 policyHash) public override policyHashOf;
    /// @inheritdoc ITelligenceFactory
    mapping(uint256 revnetId => address policy) public override policyOf;
    /// @inheritdoc ITelligenceFactory
    mapping(uint256 revnetId => address vault) public override vaultOf;

    //*********************************************************************//
    // ------------------- transient stored properties ------------------- //
    //*********************************************************************//

    /// @notice The creator whose creation fee is being forwarded, or zero outside that call.
    address public transient override originalPayer;

    //*********************************************************************//
    // -------------------------- constructor ---------------------------- //
    //*********************************************************************//

    /// @notice Pin the deployed stock protocol and provider adapter for every project.
    /// @param revnetDeployer The verified Base Revnet deployer.
    /// @param vaultDeployer The verified immutable Venice vault deployer.
    constructor(IREVDeployer revnetDeployer, ITelligenceComputeVaultDeployer vaultDeployer) {
        if (block.chainid != CHAIN_ID) revert TelligenceFactory_WrongChainOrAsset();
        if (address(revnetDeployer).code.length == 0 || address(vaultDeployer).code.length == 0) {
            revert TelligenceFactory_InvalidIntegration();
        }
        if (address(vaultDeployer.VVV()) != VVV_ADDRESS || IERC20Metadata(VVV_ADDRESS).decimals() != 18) {
            revert TelligenceFactory_WrongChainOrAsset();
        }
        if (
            address(revnetDeployer.CONTROLLER()).code.length == 0
                || address(revnetDeployer.MULTI_TERMINAL()).code.length == 0
                || address(vaultDeployer.STAKING()).code.length == 0 || address(vaultDeployer.DIEM()).code.length == 0
        ) revert TelligenceFactory_InvalidIntegration();

        REV_DEPLOYER = revnetDeployer;
        VAULT_DEPLOYER = vaultDeployer;
    }

    //*********************************************************************//
    // ---------------------- external transactions ---------------------- //
    //*********************************************************************//

    /// @inheritdoc ITelligenceFactory
    function deployFor(
        REVDescription memory description,
        TelligenceStageConfig[] memory stages,
        TelligencePolicyConfig memory policyConfiguration,
        address recovery,
        address inferenceSigner
    )
        external
        payable
        override
        nonReentrant
        returns (uint256 revnetId, ProjectPolicy policy, TelligenceComputeVault vault)
    {
        if (block.chainid != CHAIN_ID) revert TelligenceFactory_WrongChainOrAsset();
        _validateDescription({description: description, recovery: recovery, inferenceSigner: inferenceSigner});
        uint256 fee = REV_DEPLOYER.PROJECTS().creationFee();
        if (msg.value != fee) revert TelligenceFactory_IncorrectCreationFee({expected: fee, received: msg.value});

        // Each policy is born with the factory as its only binder; no uninitialized identity is user-claimable.
        policy = new ProjectPolicy({
            factory: address(this),
            creator: msg.sender,
            recovery: recovery,
            controller: REV_DEPLOYER.CONTROLLER(),
            terminal: REV_DEPLOYER.MULTI_TERMINAL(),
            vvv: IERC20(VVV_ADDRESS),
            configuration: policyConfiguration
        });
        vault = VAULT_DEPLOYER.deployFor({
            policy: address(policy), maxPrincipal: policyConfiguration.maxPrincipal, inferenceSigner: inferenceSigner
        });

        // The only accepted accounting asset and issuance currency are the same canonical token identity.
        JBAccountingContext[] memory contexts = new JBAccountingContext[](1);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 currency = uint32(uint160(VVV_ADDRESS));
        contexts[0] = JBAccountingContext({token: VVV_ADDRESS, decimals: 18, currency: currency});
        REVConfig memory configuration = REVConfig({
            description: description,
            baseCurrency: currency,
            operator: address(policy),
            scopeCashOutsToLocalBalances: true,
            stageConfigurations: _makeStages({stages: stages, policy: address(policy), creator: msg.sender})
        });

        // Stock deployment installs standard buybacks and its empty 721 hook. The policy exposes none of its tier
        // powers. Preserve the creator's fee credit across factory → deployer → project registry → fee receiver
        // forwarding.
        originalPayer = msg.sender;
        (revnetId,) = REV_DEPLOYER.deployFor{value: msg.value}({
            revnetId: 0,
            configuration: configuration,
            accountingContextsToAccept: contexts,
            suckerDeploymentConfiguration: REVSuckerDeploymentConfig({
                deployerConfigurations: new JBSuckerDeployerConfig[](0), salt: bytes32(0)
            })
        });
        originalPayer = address(0);
        if (revnetId == 0 || policyOf[revnetId] != address(0)) revert TelligenceFactory_InvalidProject();
        policy.bind({projectId: revnetId, computeVault: address(vault)});

        // Include actual routing and identities, since the stock economic hash intentionally omits split recipients.
        bytes32 policyHash = keccak256(
            abi.encode(
                CHAIN_ID, POLICY_VERSION, address(this), revnetId, configuration, policyConfiguration, recovery, vault
            )
        );
        creatorOf[revnetId] = msg.sender;
        policyHashOf[revnetId] = policyHash;
        policyOf[revnetId] = address(policy);
        vaultOf[revnetId] = address(vault);
        emit DeployProject({
            revnetId: revnetId,
            creator: msg.sender,
            policy: address(policy),
            vault: address(vault),
            policyHash: policyHash
        });
    }

    //*********************************************************************//
    // ----------------------- external views ---------------------------- //
    //*********************************************************************//

    /// @inheritdoc ITelligenceFactory
    function creationFee() external view override returns (uint256 fee) {
        return REV_DEPLOYER.PROJECTS().creationFee();
    }

    //*********************************************************************//
    // ----------------------- internal helpers -------------------------- //
    //*********************************************************************//

    /// @notice Construct every stage's routing without accepting client-supplied split or bridge instructions.
    /// @param stages The economic stage fields.
    /// @param policy The compute production beneficiary and sole protocol operator.
    /// @param creator The fixed beneficiary of the optional creator token allocation.
    /// @return configurations Stock stage configurations with permanently pinned routing.
    function _makeStages(
        TelligenceStageConfig[] memory stages,
        address policy,
        address creator
    )
        internal
        pure
        returns (REVStageConfig[] memory configurations)
    {
        if (stages.length == 0 || stages.length > MAX_STAGES) revert TelligenceFactory_InvalidStage(0);
        configurations = new REVStageConfig[](stages.length);
        for (uint256 i; i < stages.length; i++) {
            TelligenceStageConfig memory stage = stages[i];
            uint256 totalReservedPercent = uint256(stage.splitPercent) + stage.operatorSplitPercent;
            if (
                stage.splitPercent == 0 || totalReservedPercent >= JBConstants.MAX_RESERVED_PERCENT
                    || stage.cashOutTaxRate >= JBConstants.MAX_CASH_OUT_TAX_RATE
                    || stage.issuanceCutPercent >= JBConstants.MAX_WEIGHT_CUT_PERCENT
                    || (stage.issuanceCutPercent != 0 && stage.issuanceCutFrequency < 1 days)
                    || (i == 0 && stage.initialIssuance == 0)
                    || (i != 0 && stage.startsAtOrAfter <= stages[i - 1].startsAtOrAfter)
                    // Stock core distributes pending reserves using the current stage's recipients. Keeping their
                    // ratio fixed prevents distribution timing from moving already accrued compute to the creator.
                    || uint256(stage.operatorSplitPercent) * stages[0].splitPercent
                        != uint256(stages[0].operatorSplitPercent) * stage.splitPercent
            ) revert TelligenceFactory_InvalidStage(i);

            // Round the recipient ratio toward compute. Each stock distribution still floors token amounts
            // independently; at most one raw token unit of residue goes to REVOwner and is permissionlessly burnable.
            // The validated total is below 10,000, and operatorSplitPercent is strictly smaller than it, so this
            // value is below SPLITS_TOTAL_PERCENT (1e9) and fits uint32.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 operatorPercent =
                uint32(uint256(stage.operatorSplitPercent) * JBConstants.SPLITS_TOTAL_PERCENT / totalReservedPercent);
            JBSplit[] memory splits = new JBSplit[](stage.operatorSplitPercent == 0 ? 1 : 2);
            splits[0] = JBSplit({
                percent: JBConstants.SPLITS_TOTAL_PERCENT - operatorPercent,
                projectId: 0,
                beneficiary: payable(policy),
                preferAddToBalance: false,
                lockedUntil: type(uint48).max,
                hook: IJBSplitHook(address(0))
            });
            if (stage.operatorSplitPercent != 0) {
                splits[1] = JBSplit({
                    percent: operatorPercent,
                    projectId: 0,
                    beneficiary: payable(creator),
                    preferAddToBalance: false,
                    lockedUntil: type(uint48).max,
                    hook: IJBSplitHook(address(0))
                });
            }
            configurations[i] = REVStageConfig({
                startsAtOrAfter: stage.startsAtOrAfter,
                autoIssuances: new REVAutoIssuance[](0),
                // The checked total is below MAX_RESERVED_PERCENT (10,000).
                // forge-lint: disable-next-line(unsafe-typecast)
                splitPercent: uint16(totalReservedPercent),
                splits: splits,
                initialIssuance: stage.initialIssuance,
                issuanceCutFrequency: stage.issuanceCutFrequency,
                issuanceCutPercent: stage.issuanceCutPercent,
                cashOutTaxRate: stage.cashOutTaxRate,
                extraMetadata: 0
            });
        }
    }

    /// @notice Require bounded public project identity and nonzero recovery/authentication roles.
    /// @param description The public project identity.
    /// @param recovery The fixed recovery authority.
    /// @param inferenceSigner The initial isolated inference signer.
    function _validateDescription(
        REVDescription memory description,
        address recovery,
        address inferenceSigner
    )
        internal
        pure
    {
        if (
            bytes(description.name).length == 0 || bytes(description.name).length > 128
                || bytes(description.ticker).length == 0 || bytes(description.ticker).length > 32
                || bytes(description.uri).length == 0 || bytes(description.uri).length > 2048 || recovery == address(0)
                || inferenceSigner == address(0)
        ) revert TelligenceFactory_InvalidDescription();
    }
}
