// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IJB721TiersHook} from "@bananapus/721-hook-v6/src/interfaces/IJB721TiersHook.sol";
import {IJB721TiersHookDeployer} from "@bananapus/721-hook-v6/src/interfaces/IJB721TiersHookDeployer.sol";
import {JB721TiersHookFlags} from "@bananapus/721-hook-v6/src/structs/JB721TiersHookFlags.sol";
import {JBDeploy721TiersHookConfig} from "@bananapus/721-hook-v6/src/structs/JBDeploy721TiersHookConfig.sol";
import {IJBBuybackHookRegistry} from "@bananapus/buyback-hook-v6/src/interfaces/IJBBuybackHookRegistry.sol";
import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBPayerTracker} from "@bananapus/core-v6/src/interfaces/IJBPayerTracker.sol";
import {IJBPermissioned} from "@bananapus/core-v6/src/interfaces/IJBPermissioned.sol";
import {IJBPermissions} from "@bananapus/core-v6/src/interfaces/IJBPermissions.sol";
import {IJBProjects} from "@bananapus/core-v6/src/interfaces/IJBProjects.sol";
import {IJBRulesetApprovalHook} from "@bananapus/core-v6/src/interfaces/IJBRulesetApprovalHook.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBPayerTrackerLib} from "@bananapus/core-v6/src/libraries/JBPayerTrackerLib.sol";
import {JBSplitGroupIds} from "@bananapus/core-v6/src/libraries/JBSplitGroupIds.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBCurrencyAmount} from "@bananapus/core-v6/src/structs/JBCurrencyAmount.sol";
import {JBFundAccessLimitGroup} from "@bananapus/core-v6/src/structs/JBFundAccessLimitGroup.sol";
import {JBPermissionsData} from "@bananapus/core-v6/src/structs/JBPermissionsData.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JBRulesetConfig} from "@bananapus/core-v6/src/structs/JBRulesetConfig.sol";
import {JBRulesetMetadata} from "@bananapus/core-v6/src/structs/JBRulesetMetadata.sol";
import {JBSplitGroup} from "@bananapus/core-v6/src/structs/JBSplitGroup.sol";
import {JBTerminalConfig} from "@bananapus/core-v6/src/structs/JBTerminalConfig.sol";
import {JBOwnable} from "@bananapus/ownable-v6/src/JBOwnable.sol";
import {JBPermissionIds} from "@bananapus/permission-ids-v6/src/JBPermissionIds.sol";
import {IJBSuckerRegistry} from "@bananapus/suckers-v6/src/interfaces/IJBSuckerRegistry.sol";
import {CTPublisher} from "@croptop/core-v6/src/CTPublisher.sol";
import {CTAllowedPost} from "@croptop/core-v6/src/structs/CTAllowedPost.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {mulDiv, sqrt} from "@prb/math/src/Common.sol";

import {IREVDeployer} from "./interfaces/IREVDeployer.sol";
import {IREVLoans} from "./interfaces/IREVLoans.sol";
import {REVOwner} from "./REVOwner.sol";
import {REVAutoIssuance} from "./structs/REVAutoIssuance.sol";
import {REVConfig} from "./structs/REVConfig.sol";
import {REVCroptopAllowedPost} from "./structs/REVCroptopAllowedPost.sol";
import {REVDeploy721TiersHookConfig} from "./structs/REVDeploy721TiersHookConfig.sol";
import {REVOwnerAutoIssuance} from "./structs/REVOwnerAutoIssuance.sol";
import {REVOwnerExtraGrant} from "./structs/REVOwnerExtraGrant.sol";
import {REVOwnerRevnetInit} from "./structs/REVOwnerRevnetInit.sol";
import {REVStageConfig} from "./structs/REVStageConfig.sol";
import {REVSuckerDeploymentConfig} from "./structs/REVSuckerDeploymentConfig.sol";

/// @notice Deploys and configures Revnets: autonomous Juicebox projects with immutable staged tokenomics.
/// @dev Each revnet progresses through stages that define issuance rate, decay schedule, cash-out tax, split
/// allocations, and auto-issuances. The deployer translates these stage configurations into Juicebox rulesets, sets up
/// a buyback hook for secondary market routing, deploys a tiered 721 hook, optionally configures Croptop posting, and
/// can deploy cross-chain suckers. Once deployed, this contract holds the project NFT, so no single address can modify
/// the revnet's rules.
/// @dev Revnets are unowned Juicebox projects which operate autonomously after deployment. Runtime data hook logic
/// (pay/cash-out callbacks) is handled by the separate `REVOwner` contract to stay within EIP-170 size limits.
contract REVDeployer is ERC2771Context, IREVDeployer, IERC721Receiver, IJBPayerTracker {
    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice Thrown when an auto-issuance is configured with the zero address as beneficiary.
    error REVDeployer_AutoIssuanceBeneficiaryZeroAddress(uint256 stageIndex, uint256 autoIssuanceIndex);

    /// @notice Thrown when a stage's cash-out tax rate is at or above the maximum, which would disable cash-outs.
    error REVDeployer_CashOutsCantBeTurnedOffCompletely(uint256 cashOutTaxRate, uint256 maxCashOutTaxRate);

    /// @notice Thrown when a stage has a non-zero split percent but no splits to receive it.
    error REVDeployer_MustHaveSplits(uint256 stageIndex, uint256 splitPercent);

    /// @notice Thrown when native value is sent while deploying onto an existing revnet, which needs no creation fee.
    error REVDeployer_ProjectCreationFeeNotNeeded(uint256 revnetId, uint256 value);

    /// @notice Thrown when deploying suckers for a revnet whose current ruleset does not allow it.
    error REVDeployer_RulesetDoesNotAllowDeployingSuckers(uint256 revnetId);

    /// @notice Thrown when a revnet is configured with no stages.
    error REVDeployer_StagesRequired(uint256 stageCount);

    /// @notice Thrown when a stage's effective start time is not after the previous stage's start time.
    error REVDeployer_StageTimesMustIncrease(uint256 stageIndex, uint256 previousStageStart, uint256 effectiveStart);

    /// @notice Thrown when the caller is neither the revnet's owner nor its current operator.
    error REVDeployer_Unauthorized(uint256 revnetId, address caller);

    //*********************************************************************//
    // ------------------------- public constants ------------------------ //
    //*********************************************************************//

    /// @notice The number of seconds until a revnet's participants can cash out, starting from the time when that
    /// revnet is deployed to a new network.
    /// - Only applies to existing revnets which are deploying onto a new network.
    /// - To prevent liquidity/arbitrage issues which might arise when an existing revnet adds a brand-new treasury.
    /// @dev 7 days, in seconds.
    uint256 public constant override CASH_OUT_DELAY = 604_800;

    /// @notice The default Uniswap pool fee tier used when auto-configuring buyback pools.
    /// @dev 10_000 = 1%. This is the standard fee tier for most project token pairs.
    uint24 public constant DEFAULT_BUYBACK_POOL_FEE = 10_000;

    /// @notice The default tick spacing used when auto-configuring buyback pools.
    /// @dev 200 aligns with UniV4DeploymentSplitHook.TICK_SPACING so both target the same pool.
    int24 public constant DEFAULT_BUYBACK_TICK_SPACING = 200;

    /// @notice The default TWAP window used when auto-configuring buyback pools.
    /// @dev 2 days provides robust manipulation resistance.
    uint32 public constant DEFAULT_BUYBACK_TWAP_WINDOW = 2 days;

    //*********************************************************************//
    // --------------- public immutable stored properties ---------------- //
    //*********************************************************************//

    /// @notice The buyback hook used as a data hook to route payments through buyback pools.
    IJBBuybackHookRegistry public immutable override BUYBACK_HOOK;

    /// @notice The controller used to create and manage Juicebox projects for revnets.
    IJBController public immutable override CONTROLLER;

    /// @notice The directory of terminals and controllers for Juicebox projects (and revnets).
    IJBDirectory public immutable override DIRECTORY;

    /// @notice The Juicebox project ID of the revnet that receives cash-out fees.
    uint256 public immutable override FEE_REVNET_ID;

    /// @notice Deploys tiered ERC-721 hooks for revnets.
    IJB721TiersHookDeployer public immutable override HOOK_DEPLOYER;

    /// @notice The loan contract used by every revnet.
    /// @dev Revnets can offer loans to their participants, collateralized by their tokens.
    /// Participants can borrow up to the current cash-out value of their tokens.
    IREVLoans public immutable override LOANS;

    /// @notice The canonical terminal that holds revnet treasury balances.
    IJBTerminal public immutable override MULTI_TERMINAL;

    /// @notice The runtime data hook contract that handles pay and cash-out callbacks for revnets.
    /// @dev Set as `dataHook` in each revnet's ruleset metadata. Implements `IJBRulesetDataHook` and `IJBCashOutHook`.
    address public immutable override OWNER;

    /// @notice Stores Juicebox project (and revnet) access permissions.
    IJBPermissions public immutable override PERMISSIONS;

    /// @notice Mints ERC-721s that represent Juicebox project (and revnet) ownership and transfers.
    IJBProjects public immutable override PROJECTS;

    /// @notice Manages the publishing of ERC-721 posts to revnet's tiered ERC-721 hooks.
    CTPublisher public immutable override PUBLISHER;

    /// @notice The canonical router terminal registry installed as a project terminal for alternate payment routes.
    /// @dev Deployments pass the router terminal registry here, not the underlying router terminal implementation.
    IJBTerminal public immutable override ROUTER_TERMINAL_REGISTRY;

    /// @notice Deploys and tracks suckers for revnets.
    IJBSuckerRegistry public immutable override SUCKER_REGISTRY;

    //*********************************************************************//
    // --------------------- public stored properties -------------------- //
    //*********************************************************************//

    /// @notice The hashed encoded configuration of each revnet.
    /// @dev Validates omnichain sucker deployments against a revnet's encoded configuration.
    /// @custom:param revnetId The ID of the revnet to look up.
    mapping(uint256 revnetId => bytes32 hashedEncodedConfiguration) public override hashedEncodedConfigurationOf;

    //*********************************************************************//
    // ------------------- public transient properties ------------------- //
    //*********************************************************************//

    /// @notice The account that paid the creation fee for the revnet currently being deployed.
    /// @dev Set to the resolved fee payer (this contract's caller, or that caller's upstream payer when the caller is
    /// itself an `IJBPayerTracker`) while `PROJECTS.createFor` runs, so the fee receiver attributes the creation fee to
    /// the true payer instead of this deployer. Cleared back to `address(0)` once the call returns.
    address public transient override originalPayer;

    //*********************************************************************//
    // -------------------------- constructor ---------------------------- //
    //*********************************************************************//

    /// @param controller The controller to use for launching and operating the Juicebox projects which will be revnets.
    /// @param multiTerminal The canonical terminal that holds revnet treasury balances. Assumed to be a valid
    /// deployment-time dependency.
    /// @param routerTerminalRegistry The canonical router terminal registry used for alternate payment routes. May be
    /// the zero address on chains where the router terminal stack is unavailable.
    /// @param suckerRegistry The registry to use for deploying and tracking each revnet's suckers.
    /// @param feeRevnetId The Juicebox project ID of the revnet that will receive fees.
    /// @param hookDeployer The deployer to use for revnet's tiered ERC-721 hooks.
    /// @param publisher The Croptop publisher revnets can use to publish ERC-721 posts to their tiered ERC-721 hooks.
    /// @param buybackHook The buyback hook used as a data hook to route payments through buyback pools.
    /// @param loans The loan contract used by every revnet.
    /// @param trustedForwarder The trusted forwarder for the ERC2771Context.
    /// @param owner The runtime data hook contract (REVOwner) that handles pay and cash-out callbacks.
    constructor(
        IJBController controller,
        IJBTerminal multiTerminal,
        IJBTerminal routerTerminalRegistry,
        IJBSuckerRegistry suckerRegistry,
        uint256 feeRevnetId,
        IJB721TiersHookDeployer hookDeployer,
        CTPublisher publisher,
        IJBBuybackHookRegistry buybackHook,
        IREVLoans loans,
        address trustedForwarder,
        address owner
    )
        ERC2771Context(trustedForwarder)
    {
        CONTROLLER = controller;
        DIRECTORY = controller.DIRECTORY();
        PROJECTS = controller.PROJECTS();
        PERMISSIONS = IJBPermissioned(address(CONTROLLER)).PERMISSIONS();
        MULTI_TERMINAL = multiTerminal;
        ROUTER_TERMINAL_REGISTRY = routerTerminalRegistry;
        SUCKER_REGISTRY = suckerRegistry;
        FEE_REVNET_ID = feeRevnetId;
        HOOK_DEPLOYER = hookDeployer;
        PUBLISHER = publisher;
        BUYBACK_HOOK = buybackHook;
        LOANS = loans;
        OWNER = owner;

        // Wildcard-grant `SET_BUYBACK_POOL` to the buyback hook on this contract's account so the hook can
        // initialize and configure pools for every revnet during the setup window where this contract still
        // holds the JBProjects NFT, before ownership is handed to REVOwner at the end of `_deployRevnetFor`.
        uint8[] memory buybackPermissionIds = new uint8[](1);
        buybackPermissionIds[0] = JBPermissionIds.SET_BUYBACK_POOL;
        PERMISSIONS.setPermissionsFor({
            account: address(this),
            permissionsData: JBPermissionsData({
                operator: address(buybackHook), projectId: 0, permissionIds: buybackPermissionIds
            })
        });
    }

    //*********************************************************************//
    // ------------------------- external views -------------------------- //
    //*********************************************************************//

    /// @dev Required to receive the JBProjects NFT briefly while initializing an existing project as a revnet.
    /// The NFT is then forwarded to `OWNER` at the end of `_deployRevnetFor`.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        // Make sure the 721 received is from the `JBProjects` contract.
        if (msg.sender != address(PROJECTS)) revert();

        return IERC721Receiver.onERC721Received.selector;
    }

    //*********************************************************************//
    // -------------------------- public views --------------------------- //
    //*********************************************************************//

    /// @notice Indicates if this contract adheres to the specified interface.
    /// @dev See `IERC165.supportsInterface`.
    /// @return A flag indicating if the provided interface ID is supported.
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IREVDeployer).interfaceId || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IJBPayerTracker).interfaceId;
    }

    //*********************************************************************//
    // -------------------------- internal views ------------------------- //
    //*********************************************************************//

    /// @notice If the specified address is not the revnet's current operator on the REVOwner registry, revert.
    /// @param revnetId The ID of the revnet to check.
    /// @param operator The address to check.
    function _checkIfIsOperatorOf(uint256 revnetId, address operator) internal view {
        if (!REVOwner(OWNER).isOperatorOf({revnetId: revnetId, addr: operator})) {
            revert REVDeployer_Unauthorized({revnetId: revnetId, caller: operator});
        }
    }

    /// @notice Initialize fund access limits for the loan contract.
    /// @dev Returns an unlimited surplus allowance for each accepted token in the canonical multi terminal.
    /// @param accountingContextsToAccept The accounting contexts the canonical multi terminal should accept.
    /// @return fundAccessLimitGroups The fund access limit groups for the loans.
    function _makeLoanFundAccessLimits(JBAccountingContext[] calldata accountingContextsToAccept)
        internal
        view
        returns (JBFundAccessLimitGroup[] memory fundAccessLimitGroups)
    {
        // Initialize the fund access limit groups.
        fundAccessLimitGroups = new JBFundAccessLimitGroup[](accountingContextsToAccept.length);

        // Set up the fund access limits.
        for (uint256 i; i < accountingContextsToAccept.length;) {
            JBAccountingContext calldata accountingContext = accountingContextsToAccept[i];

            // Set up an unlimited allowance for the loan contract to use.
            JBCurrencyAmount[] memory loanAllowances = new JBCurrencyAmount[](1);
            loanAllowances[0] = JBCurrencyAmount({currency: accountingContext.currency, amount: type(uint224).max});

            // Set up the fund access limits for the loans.
            fundAccessLimitGroups[i] = JBFundAccessLimitGroup({
                terminal: address(MULTI_TERMINAL),
                token: accountingContext.token,
                payoutLimits: new JBCurrencyAmount[](0),
                surplusAllowances: loanAllowances
            });
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Make a ruleset configuration for a revnet's stage.
    /// @param baseCurrency The base currency of the revnet.
    /// @param scopeCashOutsToLocalBalances If true, cash-out calculations use only the local terminal's surplus.
    /// @param stageConfiguration The stage configuration to build a ruleset from.
    /// @param fundAccessLimitGroups The fund access limit groups to include in the ruleset.
    /// @return rulesetConfiguration The ruleset configuration.
    function _makeRulesetConfiguration(
        uint32 baseCurrency,
        bool scopeCashOutsToLocalBalances,
        REVStageConfig calldata stageConfiguration,
        JBFundAccessLimitGroup[] memory fundAccessLimitGroups
    )
        internal
        view
        returns (JBRulesetConfig memory)
    {
        // Set up the ruleset's metadata.
        JBRulesetMetadata memory metadata;
        metadata.reservedPercent = stageConfiguration.splitPercent;
        metadata.cashOutTaxRate = stageConfiguration.cashOutTaxRate;
        metadata.baseCurrency = baseCurrency;
        metadata.scopeCashOutsToLocalBalances = scopeCashOutsToLocalBalances;
        // Allow `REVOwner` to auto-mint configured allocations and handle pay/cash-out callbacks.
        metadata.allowOwnerMinting = true;
        metadata.useDataHookForPay = true;
        metadata.useDataHookForCashOut = true;
        metadata.dataHook = OWNER;
        metadata.metadata = stageConfiguration.extraMetadata;

        // Package the reserved token splits.
        JBSplitGroup[] memory splitGroups = new JBSplitGroup[](1);
        splitGroups[0] = JBSplitGroup({groupId: JBSplitGroupIds.RESERVED_TOKENS, splits: stageConfiguration.splits});

        return JBRulesetConfig({
            mustStartAtOrAfter: stageConfiguration.startsAtOrAfter,
            duration: stageConfiguration.issuanceCutFrequency,
            weight: stageConfiguration.initialIssuance,
            weightCutPercent: stageConfiguration.issuanceCutPercent,
            approvalHook: IJBRulesetApprovalHook(address(0)),
            metadata: metadata,
            splitGroups: splitGroups,
            fundAccessLimitGroups: fundAccessLimitGroups
        });
    }

    /// @notice Build the canonical terminal configuration used by every revnet.
    /// @dev `MULTI_TERMINAL` accepts the revnet's accounting contexts and owns the treasury/loan accounting surface.
    /// When configured, `ROUTER_TERMINAL_REGISTRY` is registered without accounting contexts so users can pay through
    /// the router path without letting callers choose arbitrary terminals or loan sources. Chains without the router
    /// terminal stack use only `MULTI_TERMINAL`.
    /// @param accountingContextsToAccept The accounting contexts the canonical multi terminal should accept.
    /// @return terminalConfigurations The canonical terminal configuration for the revnet.
    function _makeTerminalConfigurations(JBAccountingContext[] calldata accountingContextsToAccept)
        internal
        view
        returns (JBTerminalConfig[] memory terminalConfigurations)
    {
        bool hasRouterTerminalRegistry = address(ROUTER_TERMINAL_REGISTRY) != address(0);
        terminalConfigurations = new JBTerminalConfig[](hasRouterTerminalRegistry ? 2 : 1);
        terminalConfigurations[0] =
            JBTerminalConfig({terminal: MULTI_TERMINAL, accountingContextsToAccept: accountingContextsToAccept});
        if (hasRouterTerminalRegistry) {
            terminalConfigurations[1] = JBTerminalConfig({
                terminal: ROUTER_TERMINAL_REGISTRY, accountingContextsToAccept: new JBAccountingContext[](0)
            });
        }
    }

    /// @notice Calculate a Uniswap V4 sqrt price, returning zero if the ratio is out of range.
    /// @param numerator The numerator of the raw token price ratio.
    /// @param denominator The denominator of the raw token price ratio.
    /// @return sqrtPriceX96 The encoded sqrt price, or zero when it cannot be represented.
    function _sqrtPriceX96From(uint256 numerator, uint256 denominator) internal pure returns (uint160 sqrtPriceX96) {
        // Q192 is the fixed-point scale Uniswap uses before taking the square root.
        uint256 q192 = 1 << 192;

        // `mulDiv` reverts if `numerator * Q192 / denominator` exceeds uint256.
        uint256 maxRatio = type(uint256).max / q192;

        // Cap the numerator at a conservative bound that keeps the scaled ratio representable.
        uint256 maxNumerator = denominator > type(uint256).max / maxRatio ? type(uint256).max : maxRatio * denominator;

        // A zero denominator is invalid, and an out-of-range numerator means this pool price should be skipped.
        if (denominator == 0 || numerator > maxNumerator) return 0;

        // The bounded ratio fits in uint256, and its square root always fits in uint160.
        sqrtPriceX96 = uint160(sqrt(mulDiv({x: numerator, y: q192, denominator: denominator})));
    }

    /// @notice Try to initialize a Uniswap V4 buyback pool for a terminal token at its fair issuance price.
    /// @dev Called after the ERC-20 token is deployed so the pool can be initialized in the PoolManager.
    /// Computes `sqrtPriceX96` from `initialIssuance` so the pool starts at the same price as the bonding curve.
    /// Silently catches failures (e.g., if the pool is already initialized).
    /// @param revnetId The ID of the revnet to initialize a pool for.
    /// @param terminalToken The terminal token to create a buyback pool for.
    /// @param terminalTokenDecimals The number of decimals the terminal token uses.
    /// @param terminalCurrency The currency identifier of the terminal token's accounting context.
    /// @param baseCurrency The revnet's base currency (the currency `initialIssuance` is denominated against).
    /// @param initialIssuance The initial issuance rate (project tokens per unit of `baseCurrency`, 18 decimals).
    function _tryInitializeBuybackPoolFor(
        uint256 revnetId,
        address terminalToken,
        uint8 terminalTokenDecimals,
        uint32 terminalCurrency,
        uint32 baseCurrency,
        uint112 initialIssuance
    )
        internal
    {
        uint160 sqrtPriceX96;
        uint256 terminalTokenUnit = 10 ** terminalTokenDecimals;

        // When the terminal token's accounting currency differs from the revnet's base currency, convert the
        // issuance rate to the terminal currency before seeding the pool. Without this, a USDC-accepting revnet
        // with an ETH base currency seeds the pool at the ETH rate — 1000s of times off — and lets the first
        // organic swap get sandwiched at the corrected price. When no price feed exists for the pair, skip
        // pool initialization rather than reverting the whole deploy; the operator can wire the pool later via
        // the buyback hook permission.
        uint256 adjustedInitialIssuance;
        if (initialIssuance == 0) {
            adjustedInitialIssuance = 0;
        } else if (terminalCurrency == baseCurrency) {
            adjustedInitialIssuance = uint256(initialIssuance);
        } else {
            try CONTROLLER.PRICES()
                .pricePerUnitOf({
                projectId: revnetId,
                pricingCurrency: terminalCurrency,
                unitCurrency: baseCurrency,
                decimals: terminalTokenDecimals
            }) returns (
                uint256 rate
            ) {
                if (rate == 0) return;
                adjustedInitialIssuance = mulDiv({x: uint256(initialIssuance), y: terminalTokenUnit, denominator: rate});
            } catch {
                return;
            }
        }

        if (adjustedInitialIssuance == 0) {
            sqrtPriceX96 = uint160(1 << 96);
        } else {
            address normalizedTerminalToken = terminalToken == JBConstants.NATIVE_TOKEN ? address(0) : terminalToken;
            address projectToken = address(CONTROLLER.TOKENS().tokenOf(revnetId));

            if (projectToken == address(0) || projectToken == normalizedTerminalToken) {
                sqrtPriceX96 = uint160(1 << 96);
            } else if (normalizedTerminalToken < projectToken) {
                // token0 = terminal, token1 = project → price = adjustedIssuance / terminalTokenUnit
                sqrtPriceX96 = _sqrtPriceX96From({numerator: adjustedInitialIssuance, denominator: terminalTokenUnit});
            } else {
                // token0 = project, token1 = terminal → price = terminalTokenUnit / adjustedIssuance
                sqrtPriceX96 = _sqrtPriceX96From({numerator: terminalTokenUnit, denominator: adjustedInitialIssuance});
            }

            // Some extreme cross-currency prices are outside Uniswap's usable sqrt-price range. In those cases,
            // leave the pool uninitialized instead of reverting the whole revnet deployment.
            if (sqrtPriceX96 == 0) return;
        }

        try BUYBACK_HOOK.initializePoolFor({
            projectId: revnetId,
            fee: DEFAULT_BUYBACK_POOL_FEE,
            tickSpacing: DEFAULT_BUYBACK_TICK_SPACING,
            twapWindow: DEFAULT_BUYBACK_TWAP_WINDOW,
            terminalToken: terminalToken,
            sqrtPriceX96: sqrtPriceX96
        }) {}
            catch {
            // Two failure modes both end up here and both must not block the revnet deploy:
            //  1. The V4 pool is already initialized at the expected price (idempotent re-deploy). The buyback
            //     hook's strict price check inside `initializePoolFor` would still call `_setPoolFor`, so the
            //     try-branch already covered this. We reach this catch only when the check rejected the existing
            //     price.
            //  2. The V4 pool was front-run and pre-initialized at an attacker-chosen `sqrtPriceX96`. The buyback
            //     hook's strict price check reverts with `JBBuybackHook_PoolInitializedAtWrongPrice`, which lands
            //     here. We deliberately swallow that revert so an attacker cannot DoS the revnet deploy by
            //     squatting on the predictable pool address — the revnet ships without buyback configured and
            //     can be configured manually post-deploy.
        }
    }

    //*********************************************************************//
    // --------------------- external transactions ----------------------- //
    //*********************************************************************//

    /// @notice Launch a revnet, or initialize an existing Juicebox project as a revnet.
    /// @dev When initializing an existing project (revnetId != 0):
    /// - The project must not yet have a controller or rulesets. `JBController.launchRulesetsFor` enforces this —
    ///   it reverts if rulesets have already been launched, and `JBDirectory.setControllerOf` only allows setting the
    ///   first controller. This means conversion only works for blank projects: an ID with no on-chain state.
    /// - This is useful in deploy scripts where the project ID is needed before configuration (e.g. for cross-chain
    ///   sucker peer mappings): create the project first, then initialize it as a revnet here.
    /// - Initialization is a one-way operation: the project's ownership NFT is permanently transferred to this
    ///   REVDeployer, and the project becomes subject to immutable revnet rules. This cannot be undone.
    /// @param revnetId The ID of the Juicebox project to initialize as a revnet. Send 0 to deploy a new revnet.
    /// @param configuration Core revnet configuration. See `REVConfig`.
    /// @param accountingContextsToAccept The accounting contexts the canonical multi terminal should accept.
    /// @param suckerDeploymentConfiguration The suckers to set up for cross-chain token transfers.
    /// @param tiered721HookConfiguration How to configure the tiered ERC-721 hook for the revnet.
    /// @param allowedPosts Restrictions on which Croptop posts to allow on the revnet's ERC-721 tiers.
    /// @return revnetId The ID of the newly created revnet.
    /// @return hook The address of the tiered ERC-721 hook deployed for the revnet.
    // The deployment flow makes external setup calls, but any observed state is revnet-scoped and reverts atomically.
    function deployFor(
        uint256 revnetId,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration,
        REVDeploy721TiersHookConfig calldata tiered721HookConfiguration,
        REVCroptopAllowedPost[] calldata allowedPosts
    )
        external
        payable
        override
        returns (uint256, IJB721TiersHook hook)
    {
        // Keep a reference to the revnet ID which was passed in.
        bool shouldDeployNewRevnet = revnetId == 0;

        // If the caller is deploying a new revnet, reserve its project ID before deriving hook/sucker config.
        if (shouldDeployNewRevnet) {
            // Expose the resolved fee payer so the fee receiver attributes the creation fee to the true payer, not this
            // deployer. Cleared immediately after.
            originalPayer = JBPayerTrackerLib.resolve(_msgSender());
            revnetId = PROJECTS.createFor{value: msg.value}(address(this));
            originalPayer = address(0);
        } else if (msg.value != 0) {
            revert REVDeployer_ProjectCreationFeeNotNeeded({revnetId: revnetId, value: msg.value});
        }

        // Deploy the revnet with the specified tiered ERC-721 hook and Croptop posting criteria.
        hook = _deploy721RevnetFor({
            revnetId: revnetId,
            shouldDeployNewRevnet: shouldDeployNewRevnet,
            configuration: configuration,
            accountingContextsToAccept: accountingContextsToAccept,
            suckerDeploymentConfiguration: suckerDeploymentConfiguration,
            tiered721HookConfiguration: tiered721HookConfiguration,
            allowedPosts: allowedPosts
        });

        return (revnetId, hook);
    }

    /// @notice Deploy a revnet with a default empty tiered ERC-721 hook.
    /// @dev Convenience overload — constructs an empty 721 config internally and delegates to the 6-arg version.
    /// @param revnetId The ID of the Juicebox project to initialize. Send 0 to deploy a new revnet.
    /// @param configuration Core revnet configuration.
    /// @param accountingContextsToAccept The accounting contexts the canonical multi terminal should accept.
    /// @param suckerDeploymentConfiguration The suckers to set up for cross-chain token transfers.
    /// @return The ID of the newly created or initialized revnet.
    /// @return hook The tiered ERC-721 hook deployed for the revnet.
    // The deployment flow makes external setup calls, but any observed state is revnet-scoped and reverts atomically.
    function deployFor(
        uint256 revnetId,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration
    )
        external
        payable
        override
        returns (uint256, IJB721TiersHook hook)
    {
        bool shouldDeployNewRevnet = revnetId == 0;
        if (shouldDeployNewRevnet) {
            // Expose the resolved fee payer so the fee receiver attributes the creation fee to the true payer, not this
            // deployer. Cleared immediately after.
            originalPayer = JBPayerTrackerLib.resolve(_msgSender());
            revnetId = PROJECTS.createFor{value: msg.value}(address(this));
            originalPayer = address(0);
        } else if (msg.value != 0) {
            revert REVDeployer_ProjectCreationFeeNotNeeded({revnetId: revnetId, value: msg.value});
        }

        // Deploy the revnet (project, rulesets, ERC-20, suckers, etc.).
        (bytes32 encodedConfigurationHash, REVOwnerRevnetInit memory ownerInit) = _deployRevnetFor({
            revnetId: revnetId,
            shouldDeployNewRevnet: shouldDeployNewRevnet,
            configuration: configuration,
            accountingContextsToAccept: accountingContextsToAccept,
            suckerDeploymentConfiguration: suckerDeploymentConfiguration
        });

        // Deploy a default empty 721 hook for the revnet.
        {
            JBDeploy721TiersHookConfig memory deployConfig;
            deployConfig.tiersConfig.currency = configuration.baseCurrency;
            deployConfig.tiersConfig.decimals = 18;

            hook = HOOK_DEPLOYER.deployHookFor({
                projectId: revnetId,
                deployTiersHookConfig: deployConfig,
                salt: keccak256(abi.encode(bytes32(0), encodedConfigurationHash, _msgSender()))
            });
        }

        // Scope the hook's permissions to REVOwner, where the operator permissions are granted.
        JBOwnable(address(hook)).transferOwnership(OWNER);

        // Grant the operator all 721 permissions (no prevent* flags for default config).
        ownerInit.extraOperatorPermissionIds = new uint256[](4);
        ownerInit.extraOperatorPermissionIds[0] = JBPermissionIds.ADJUST_721_TIERS;
        ownerInit.extraOperatorPermissionIds[1] = JBPermissionIds.SET_721_METADATA;
        ownerInit.extraOperatorPermissionIds[2] = JBPermissionIds.MINT_721;
        ownerInit.extraOperatorPermissionIds[3] = JBPermissionIds.SET_721_DISCOUNT_PERCENT;

        ownerInit.tiered721Hook = hook;
        ownerInit.operator = configuration.operator;

        // Bind every piece of revnet-scoped state on the owner contract in a single call.
        REVOwner(OWNER).initializeRevnet({revnetId: revnetId, init: ownerInit});

        return (revnetId, hook);
    }

    /// @notice Deploy new suckers for an existing revnet.
    /// @dev Only the revnet's operator can deploy new suckers.
    /// @param revnetId The ID of the revnet to deploy suckers for.
    /// @param suckerDeploymentConfiguration The suckers to set up for the revnet.
    /// @return suckers The addresses of the suckers deployed for the revnet.
    function deploySuckersFor(
        uint256 revnetId,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration
    )
        external
        override
        returns (address[] memory suckers)
    {
        // Make sure the caller is the revnet's operator.
        _checkIfIsOperatorOf({revnetId: revnetId, operator: _msgSender()});

        // Check if the current ruleset allows deploying new suckers.
        (, JBRulesetMetadata memory metadata) = CONTROLLER.currentRulesetOf(revnetId);

        // Check the third bit, it indicates if the ruleset allows new suckers to be deployed.
        bool allowsDeployingSuckers = ((metadata.metadata >> 2) & 1) == 1;

        if (!allowsDeployingSuckers) {
            revert REVDeployer_RulesetDoesNotAllowDeployingSuckers({revnetId: revnetId});
        }

        // Deploy the suckers.
        suckers = _deploySuckersFor({
            revnetId: revnetId,
            encodedConfigurationHash: hashedEncodedConfigurationOf[revnetId],
            suckerDeploymentConfiguration: suckerDeploymentConfiguration
        });
    }

    //*********************************************************************//
    // --------------------- internal transactions ----------------------- //
    //*********************************************************************//

    /// @notice Deploy a revnet which sells tiered ERC-721s and optionally allows Croptop posts to its ERC-721 tiers.
    /// @return hook The address of the tiered ERC-721 hook deployed for the revnet.
    // The helper performs external hook/post setup after core revnet setup; any failure reverts the whole deployment.
    function _deploy721RevnetFor(
        uint256 revnetId,
        bool shouldDeployNewRevnet,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration,
        REVDeploy721TiersHookConfig memory tiered721HookConfiguration,
        REVCroptopAllowedPost[] memory allowedPosts
    )
        internal
        returns (IJB721TiersHook hook)
    {
        // Deploy the revnet (project, rulesets, ERC-20, suckers, etc.).
        (bytes32 encodedConfigurationHash, REVOwnerRevnetInit memory ownerInit) = _deployRevnetFor({
            revnetId: revnetId,
            shouldDeployNewRevnet: shouldDeployNewRevnet,
            configuration: configuration,
            accountingContextsToAccept: accountingContextsToAccept,
            suckerDeploymentConfiguration: suckerDeploymentConfiguration
        });

        // Convert the REVBaseline721HookConfig to JBDeploy721TiersHookConfig, forcing issueTokensForSplits to false.
        // Revnets do their own weight adjustment for splits, so the 721 hook must not also adjust.
        hook = HOOK_DEPLOYER.deployHookFor({
            projectId: revnetId,
            deployTiersHookConfig: JBDeploy721TiersHookConfig({
                name: tiered721HookConfiguration.baseline721HookConfiguration.name,
                symbol: tiered721HookConfiguration.baseline721HookConfiguration.symbol,
                baseUri: tiered721HookConfiguration.baseline721HookConfiguration.baseUri,
                tokenUriResolver: tiered721HookConfiguration.baseline721HookConfiguration.tokenUriResolver,
                contractUri: tiered721HookConfiguration.baseline721HookConfiguration.contractUri,
                tiersConfig: tiered721HookConfiguration.baseline721HookConfiguration.tiersConfig,
                flags: JB721TiersHookFlags({
                    noNewTiersWithReserves: tiered721HookConfiguration.baseline721HookConfiguration.flags
                    .noNewTiersWithReserves,
                    noNewTiersWithVotes: tiered721HookConfiguration.baseline721HookConfiguration.flags
                        .noNewTiersWithVotes,
                    noNewTiersWithOwnerMinting: tiered721HookConfiguration.baseline721HookConfiguration.flags
                        .noNewTiersWithOwnerMinting,
                    preventOverspending: tiered721HookConfiguration.baseline721HookConfiguration.flags
                        .preventOverspending,
                    issueTokensForSplits: false
                })
            }),
            salt: keccak256(abi.encode(tiered721HookConfiguration.salt, encodedConfigurationHash, _msgSender()))
        });

        // Build the 721 permission additions based on the deployer's `preventOperator*` flags.
        {
            uint256 extraCount;
            if (!tiered721HookConfiguration.preventOperatorAdjustingTiers) ++extraCount;
            if (!tiered721HookConfiguration.preventOperatorUpdatingMetadata) ++extraCount;
            if (!tiered721HookConfiguration.preventOperatorMinting) ++extraCount;
            if (!tiered721HookConfiguration.preventOperatorIncreasingDiscountPercent) ++extraCount;

            uint256[] memory extraPermissions = new uint256[](extraCount);
            uint256 idx;
            if (!tiered721HookConfiguration.preventOperatorAdjustingTiers) {
                extraPermissions[idx++] = JBPermissionIds.ADJUST_721_TIERS;
            }
            if (!tiered721HookConfiguration.preventOperatorUpdatingMetadata) {
                extraPermissions[idx++] = JBPermissionIds.SET_721_METADATA;
            }
            if (!tiered721HookConfiguration.preventOperatorMinting) {
                extraPermissions[idx++] = JBPermissionIds.MINT_721;
            }
            if (!tiered721HookConfiguration.preventOperatorIncreasingDiscountPercent) {
                extraPermissions[idx++] = JBPermissionIds.SET_721_DISCOUNT_PERCENT;
            }
            ownerInit.extraOperatorPermissionIds = extraPermissions;
        }

        ownerInit.tiered721Hook = hook;
        ownerInit.operator = configuration.operator;

        // If there are posts to allow, configure them.
        if (allowedPosts.length != 0) {
            // Keep a reference to the formatted allowed posts.
            CTAllowedPost[] memory formattedAllowedPosts = new CTAllowedPost[](allowedPosts.length);

            // Iterate through each post to add it to the formatted list.
            for (uint256 i; i < allowedPosts.length;) {
                // Set the post being iterated on.
                REVCroptopAllowedPost memory post = allowedPosts[i];

                // Set the formatted post.
                formattedAllowedPosts[i] = CTAllowedPost({
                    hook: address(hook),
                    category: post.category,
                    minimumPrice: post.minimumPrice,
                    minimumTotalSupply: post.minimumTotalSupply,
                    maximumTotalSupply: post.maximumTotalSupply,
                    maximumSplitPercent: post.maximumSplitPercent,
                    allowedAddresses: post.allowedAddresses
                });
                unchecked {
                    ++i;
                }
            }

            // Set up the allowed posts while this deployer is still the hook owner.
            // `CTPublisher.configurePostingCriteriaFor` checks the hook owner's ADJUST_721_TIERS permission, and the
            // deployer passes that check directly only before ownership is scoped to REVOwner below.
            PUBLISHER.configurePostingCriteriaFor({allowedPosts: formattedAllowedPosts});

            // Give the Croptop publisher permission to post new ERC-721 tiers on the revnet's behalf.
            ownerInit.extraGrants = new REVOwnerExtraGrant[](1);
            ownerInit.extraGrants[0] =
                REVOwnerExtraGrant({operator: address(PUBLISHER), permissionId: JBPermissionIds.ADJUST_721_TIERS});
        }

        // Scope the hook's permissions to REVOwner, where the operator permissions are granted.
        JBOwnable(address(hook)).transferOwnership(OWNER);

        // Bind every piece of revnet-scoped state on the owner contract in a single call.
        REVOwner(OWNER).initializeRevnet({revnetId: revnetId, init: ownerInit});
    }

    /// @notice Deploy a revnet, or initialize an existing Juicebox project as a revnet.
    /// @dev When initializing an existing project (`shouldDeployNewRevnet == false`):
    /// - The project must be blank — no controller or rulesets. This is enforced by `JBController.launchRulesetsFor`,
    ///   which reverts if rulesets exist, and by `JBDirectory.setControllerOf`, which only allows setting the first
    ///   controller. Without a controller, no tokens or terminals can exist, guaranteeing the project is uninitialized.
    /// - The project's JBProjects NFT is permanently transferred to this contract. This is irreversible.
    /// @param revnetId The ID of the Juicebox project to initialize as a revnet. Send 0 to deploy a new revnet.
    /// @param shouldDeployNewRevnet Whether the revnet ID was reserved by this deployment call, or the caller is
    /// converting an existing Juicebox project into a revnet.
    /// @param configuration Core revnet configuration. See `REVConfig`.
    /// @param accountingContextsToAccept The accounting contexts the canonical multi terminal should accept.
    /// @param suckerDeploymentConfiguration The suckers to set up for cross-chain token transfers.
    /// @return encodedConfigurationHash A hash that represents the revnet's configuration.
    /// @return ownerInit The revnet-scoped initialization state for `REVOwner`, populated during deployment.
    function _deployRevnetFor(
        uint256 revnetId,
        bool shouldDeployNewRevnet,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration
    )
        internal
        returns (bytes32 encodedConfigurationHash, REVOwnerRevnetInit memory ownerInit)
    {
        // Normalize and encode the configurations.
        JBRulesetConfig[] memory rulesetConfigurations;
        (rulesetConfigurations, encodedConfigurationHash, ownerInit.autoIssuances) = _makeRulesetConfigurations({
            revnetId: revnetId, configuration: configuration, accountingContextsToAccept: accountingContextsToAccept
        });

        // Build the canonical terminal set from the deployer's immutable terminal choices.
        JBTerminalConfig[] memory terminalConfigurations =
            _makeTerminalConfigurations({accountingContextsToAccept: accountingContextsToAccept});

        // Store the hash before setup callbacks so reentrant readers cannot observe a zero configuration hash. Any
        // subsequent revert rolls this write back.
        hashedEncodedConfigurationOf[revnetId] = encodedConfigurationHash;

        if (!shouldDeployNewRevnet) {
            // Keep a reference to the Juicebox project's owner.
            address owner = PROJECTS.ownerOf(revnetId);

            // Make sure the caller is the owner of the Juicebox project.
            if (_msgSender() != owner) revert REVDeployer_Unauthorized(revnetId, _msgSender());

            // Initialize the existing Juicebox project as a revnet by transferring the `JBProjects` NFT to this
            // deployer. This is irreversible.
            IERC721(PROJECTS).safeTransferFrom({from: owner, to: address(this), tokenId: revnetId});
        }

        // Launch the revnet rulesets for the reserved or pre-existing blank project.
        CONTROLLER.launchRulesetsFor({
            projectId: revnetId,
            projectUri: configuration.description.uri,
            rulesetConfigurations: rulesetConfigurations,
            terminalConfigurations: terminalConfigurations,
            memo: ""
        });

        // Compute the cash-out delay if the revnet's stages are already in progress. This prevents cash-out
        // liquidity/arbitrage issues for existing revnets which are deploying to a new chain.
        ownerInit.cashOutDelay =
            _computeCashOutDelayIfNeeded({revnetId: revnetId, firstStageConfig: configuration.stageConfigurations[0]});

        // Deploy the revnet's ERC-20 token.
        CONTROLLER.deployERC20For({
            projectId: revnetId,
            name: configuration.description.name,
            symbol: configuration.description.ticker,
            salt: keccak256(abi.encode(configuration.description.salt, encodedConfigurationHash, _msgSender()))
        });

        // With the ERC-20 deployed, initialize buyback pools for each accepted treasury token.
        for (uint256 i; i < accountingContextsToAccept.length;) {
            _tryInitializeBuybackPoolFor({
                revnetId: revnetId,
                terminalToken: accountingContextsToAccept[i].token,
                terminalTokenDecimals: accountingContextsToAccept[i].decimals,
                terminalCurrency: accountingContextsToAccept[i].currency,
                baseCurrency: configuration.baseCurrency,
                initialIssuance: configuration.stageConfigurations[0].initialIssuance
            });
            unchecked {
                ++i;
            }
        }

        // Transfer the JBProjects NFT to REVOwner. REVOwner is the project's authoritative owner.
        IERC721(PROJECTS).safeTransferFrom({from: address(this), to: OWNER, tokenId: revnetId});

        // Deploy the suckers (if applicable).
        if (suckerDeploymentConfiguration.salt != bytes32(0)) {
            _deploySuckersFor({
                revnetId: revnetId,
                encodedConfigurationHash: encodedConfigurationHash,
                suckerDeploymentConfiguration: suckerDeploymentConfiguration
            });
        }

        emit DeployRevnet({
            revnetId: revnetId,
            configuration: configuration,
            terminalConfigurations: terminalConfigurations,
            suckerDeploymentConfiguration: suckerDeploymentConfiguration,
            rulesetConfigurations: rulesetConfigurations,
            encodedConfigurationHash: encodedConfigurationHash,
            caller: _msgSender()
        });
    }

    /// @notice Deploy suckers for a revnet against the sucker registry, scoped on REVOwner's account.
    /// @param revnetId The ID of the revnet to deploy suckers for.
    /// @param encodedConfigurationHash A hash that represents the revnet's configuration.
    /// @param suckerDeploymentConfiguration The suckers to set up for the revnet.
    /// @return suckers The addresses of the suckers deployed for the revnet.
    function _deploySuckersFor(
        uint256 revnetId,
        bytes32 encodedConfigurationHash,
        REVSuckerDeploymentConfig calldata suckerDeploymentConfiguration
    )
        internal
        returns (address[] memory suckers)
    {
        emit DeploySuckers({
            revnetId: revnetId,
            encodedConfigurationHash: encodedConfigurationHash,
            suckerDeploymentConfiguration: suckerDeploymentConfiguration,
            caller: _msgSender()
        });

        suckers = SUCKER_REGISTRY.deploySuckersFor({
            projectId: revnetId,
            salt: keccak256(abi.encode(encodedConfigurationHash, suckerDeploymentConfiguration.salt, _msgSender())),
            configurations: suckerDeploymentConfiguration.deployerConfigurations
        });
    }

    /// @notice Convert a revnet's stages into a series of Juicebox project rulesets.
    /// @dev Stage transitions affect outstanding loan health. When a new stage activates, parameters such as
    /// `cashOutTaxRate` and `weight` change, which directly impact the borrowable amount calculated by
    /// `REVLoans._borrowableAmountFrom`. Loans originated under a previous stage's parameters may become
    /// under-collateralized if the new stage has a higher `cashOutTaxRate` (reducing the borrowable amount per unit
    /// of collateral) or lower issuance weight (reducing the surplus-per-token ratio). Borrowers should monitor
    /// upcoming stage transitions and adjust their positions accordingly, as loans that fall below their required
    /// collateralization may become eligible for liquidation.
    /// @dev `cashOutTaxRate` changes at stage boundaries may allow users to cash out just before a rate increase.
    /// This is accepted behavior — the arbitrage window is bounded by the ruleset design, and all stages are
    /// configured immutably at deployment time.
    /// @param revnetId The ID of the revnet to build rulesets for.
    /// @param configuration The configuration containing the revnet's stages.
    /// @param accountingContextsToAccept The accounting contexts the canonical multi terminal should accept.
    /// @return rulesetConfigurations A list of ruleset configurations derived from the stages.
    /// @return encodedConfigurationHash A hash that represents the revnet's configuration.
    function _makeRulesetConfigurations(
        uint256 revnetId,
        REVConfig calldata configuration,
        JBAccountingContext[] calldata accountingContextsToAccept
    )
        internal
        returns (
            JBRulesetConfig[] memory rulesetConfigurations,
            bytes32 encodedConfigurationHash,
            REVOwnerAutoIssuance[] memory autoIssuances
        )
    {
        // If there are no stages, revert.
        if (configuration.stageConfigurations.length == 0) {
            revert REVDeployer_StagesRequired({stageCount: configuration.stageConfigurations.length});
        }

        // Initialize the array of rulesets.
        rulesetConfigurations = new JBRulesetConfig[](configuration.stageConfigurations.length);

        // Add the base configuration to the byte-encoded configuration.
        bytes memory encodedConfiguration = abi.encode(
            configuration.baseCurrency,
            configuration.scopeCashOutsToLocalBalances,
            configuration.description.name,
            configuration.description.ticker,
            configuration.description.salt
        );

        // Initialize fund access limit groups for the loan contract.
        JBFundAccessLimitGroup[] memory fundAccessLimitGroups =
            _makeLoanFundAccessLimits({accountingContextsToAccept: accountingContextsToAccept});

        // Pre-count auto-issuances that will land on this chain so the owner-init array can be sized exactly.
        uint256 autoIssuanceCount;
        for (uint256 i; i < configuration.stageConfigurations.length;) {
            REVAutoIssuance[] calldata stageAutoIssuances = configuration.stageConfigurations[i].autoIssuances;
            for (uint256 j; j < stageAutoIssuances.length;) {
                if (stageAutoIssuances[j].count != 0 && stageAutoIssuances[j].chainId == block.chainid) {
                    ++autoIssuanceCount;
                }
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
        autoIssuances = new REVOwnerAutoIssuance[](autoIssuanceCount);
        uint256 autoIssuanceIdx;

        // Track the previous stage's effective start time for ordering validation.
        // When stage 0 uses `startsAtOrAfter == 0`, the effective value is `block.timestamp`.
        // Subsequent stages must be validated against this normalized value, not the raw calldata,
        // so that cross-chain deployments can reproduce the same encoded configuration hash.
        uint256 previousStageStart;

        // Iterate through each stage to set up its ruleset.
        for (uint256 i; i < configuration.stageConfigurations.length;) {
            // Read the stage being converted into a ruleset.
            REVStageConfig calldata stageConfiguration = configuration.stageConfigurations[i];

            // Make sure the revnet has at least one split if it has a split percent.
            // Otherwise, the reserved-token residue would stay with this contract as the revnet's owner.
            if (stageConfiguration.splitPercent > 0 && stageConfiguration.splits.length == 0) {
                revert REVDeployer_MustHaveSplits({stageIndex: i, splitPercent: stageConfiguration.splitPercent});
            }

            // Compute the effective start time for this stage.
            uint256 effectiveStart = (i == 0 && stageConfiguration.startsAtOrAfter == 0)
                ? block.timestamp
                : stageConfiguration.startsAtOrAfter;

            // If the stage's start time is not after the previous stage's start time, revert.
            if (i > 0 && effectiveStart <= previousStageStart) {
                revert REVDeployer_StageTimesMustIncrease({
                    stageIndex: i, previousStageStart: previousStageStart, effectiveStart: effectiveStart
                });
            }

            // Store for the next iteration's ordering check.
            previousStageStart = effectiveStart;

            // Make sure the revnet does not disable cash-outs completely.
            if (stageConfiguration.cashOutTaxRate >= JBConstants.MAX_CASH_OUT_TAX_RATE) {
                revert REVDeployer_CashOutsCantBeTurnedOffCompletely({
                    cashOutTaxRate: stageConfiguration.cashOutTaxRate,
                    maxCashOutTaxRate: JBConstants.MAX_CASH_OUT_TAX_RATE
                });
            }

            // Set up the ruleset.
            rulesetConfigurations[i] = _makeRulesetConfiguration({
                baseCurrency: configuration.baseCurrency,
                scopeCashOutsToLocalBalances: configuration.scopeCashOutsToLocalBalances,
                stageConfiguration: stageConfiguration,
                fundAccessLimitGroups: fundAccessLimitGroups
            });

            // Add the stage's immutable economics to the byte-encoded configuration. `extraMetadata` is Juicebox
            // ruleset metadata forwarded to the revnet data hook, so it remains part of the revnet identity.
            // Reserved-token split recipients and individual weights are intentionally excluded below: the split
            // limit (`splitPercent`) is the economic commitment, while split routing can change over time.
            encodedConfiguration = abi.encode(
                encodedConfiguration,
                // Use the effective start time (normalized from 0 to block.timestamp for the first stage).
                // Cross-chain deployments reproduce the hash by specifying the origin chain's timestamp.
                effectiveStart,
                stageConfiguration.splitPercent,
                stageConfiguration.initialIssuance,
                stageConfiguration.issuanceCutFrequency,
                stageConfiguration.issuanceCutPercent,
                stageConfiguration.cashOutTaxRate,
                stageConfiguration.extraMetadata
            );

            // Add each auto-mint to the byte-encoded representation.
            for (uint256 j; j < stageConfiguration.autoIssuances.length; j++) {
                REVAutoIssuance calldata autoIssuance = stageConfiguration.autoIssuances[j];

                // Make sure the beneficiary is not the zero address.
                if (autoIssuance.beneficiary == address(0)) {
                    revert REVDeployer_AutoIssuanceBeneficiaryZeroAddress({stageIndex: i, autoIssuanceIndex: j});
                }

                // If there's nothing to auto-mint, continue.
                if (autoIssuance.count == 0) continue;

                encodedConfiguration = abi.encode(
                    encodedConfiguration, autoIssuance.chainId, autoIssuance.beneficiary, autoIssuance.count
                );

                // If the issuance config is for another chain, skip it.
                if (autoIssuance.chainId != block.chainid) continue;

                emit StoreAutoIssuanceAmount({
                    revnetId: revnetId,
                    stageId: block.timestamp + i,
                    beneficiary: autoIssuance.beneficiary,
                    count: autoIssuance.count,
                    caller: _msgSender()
                });

                // Record the amount of tokens that can be auto-minted on this chain during this stage. The stage
                // ID is `block.timestamp + i`. This matches the ruleset ID that JBRulesets assigns because
                // JBRulesets uses `latestId >= block.timestamp ? latestId + 1 : block.timestamp`
                // (JBRulesets.sol L172), producing the same sequential IDs when all stages are queued in one tx.
                // `REVOwner.autoIssueFor` later calls `getRulesetOf(revnetId, stageId)` — the returned
                // `ruleset.start` is the derived start time (not the queue time), so the timing guard works
                // correctly.
                autoIssuances[autoIssuanceIdx++] = REVOwnerAutoIssuance({
                    stageId: block.timestamp + i, beneficiary: autoIssuance.beneficiary, count: autoIssuance.count
                });
            }
            unchecked {
                ++i;
            }
        }

        // Hash the encoded configuration.
        encodedConfigurationHash = keccak256(encodedConfiguration);
    }

    /// @notice Compute the cash-out delay for the revnet's first stage if its stages are already in progress.
    /// @dev Returns 0 when no delay is needed. Emits `SetCashOutDelay` so deployer-side telemetry stays unchanged
    /// even though the actual storage write happens later inside `REVOwner.initializeRevnet`.
    /// @param revnetId The ID of the revnet to compute the cash-out delay for.
    /// @param firstStageConfig The revnet's first stage.
    /// @return cashOutDelay The timestamp after which cash-outs are allowed, or 0 if no delay applies.
    function _computeCashOutDelayIfNeeded(
        uint256 revnetId,
        REVStageConfig calldata firstStageConfig
    )
        internal
        returns (uint256 cashOutDelay)
    {
        // If this is the first revnet being deployed (with a `startsAtOrAfter` of 0),
        // or if the first stage hasn't started yet, we don't need to set a cash-out delay.
        // forge-lint: disable-next-line(block-timestamp)
        if (firstStageConfig.startsAtOrAfter == 0 || firstStageConfig.startsAtOrAfter >= block.timestamp) return 0;

        // Calculate the timestamp at which the cash-out delay ends.
        cashOutDelay = block.timestamp + CASH_OUT_DELAY;

        emit SetCashOutDelay({revnetId: revnetId, cashOutDelay: cashOutDelay, caller: _msgSender()});
    }
}
