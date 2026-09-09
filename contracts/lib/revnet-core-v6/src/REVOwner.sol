// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IJB721TiersHook} from "@bananapus/721-hook-v6/src/interfaces/IJB721TiersHook.sol";
import {IJBBuybackHookRegistry} from "@bananapus/buyback-hook-v6/src/interfaces/IJBBuybackHookRegistry.sol";
import {IJBCashOutHook} from "@bananapus/core-v6/src/interfaces/IJBCashOutHook.sol";
import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBPermissions} from "@bananapus/core-v6/src/interfaces/IJBPermissions.sol";
import {IJBProjects} from "@bananapus/core-v6/src/interfaces/IJBProjects.sol";
import {IJBRulesetDataHook} from "@bananapus/core-v6/src/interfaces/IJBRulesetDataHook.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {JBCashOuts} from "@bananapus/core-v6/src/libraries/JBCashOuts.sol";
import {JBConstants} from "@bananapus/core-v6/src/libraries/JBConstants.sol";
import {JBFees} from "@bananapus/core-v6/src/libraries/JBFees.sol";
import {JBAccountingContext} from "@bananapus/core-v6/src/structs/JBAccountingContext.sol";
import {JBAfterCashOutRecordedContext} from "@bananapus/core-v6/src/structs/JBAfterCashOutRecordedContext.sol";
import {JBBeforeCashOutRecordedContext} from "@bananapus/core-v6/src/structs/JBBeforeCashOutRecordedContext.sol";
import {JBBeforePayRecordedContext} from "@bananapus/core-v6/src/structs/JBBeforePayRecordedContext.sol";
import {JBCashOutHookSpecification} from "@bananapus/core-v6/src/structs/JBCashOutHookSpecification.sol";
import {JBPayHookSpecification} from "@bananapus/core-v6/src/structs/JBPayHookSpecification.sol";
import {JBPermissionsData} from "@bananapus/core-v6/src/structs/JBPermissionsData.sol";
import {JBRuleset} from "@bananapus/core-v6/src/structs/JBRuleset.sol";
import {JBPermissionIds} from "@bananapus/permission-ids-v6/src/JBPermissionIds.sol";
import {IJBPeerChainAdjustedAccounts} from "@bananapus/suckers-v6/src/interfaces/IJBPeerChainAdjustedAccounts.sol";
import {IJBSuckerRegistry} from "@bananapus/suckers-v6/src/interfaces/IJBSuckerRegistry.sol";
import {JBSourceContext} from "@bananapus/suckers-v6/src/structs/JBSourceContext.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {mulDiv} from "@prb/math/src/Common.sol";

import {IREVDeployer} from "./interfaces/IREVDeployer.sol";
import {IREVLoans} from "./interfaces/IREVLoans.sol";
import {IREVOwner} from "./interfaces/IREVOwner.sol";
import {REVOwnerAutoIssuance} from "./structs/REVOwnerAutoIssuance.sol";
import {REVOwnerExtraGrant} from "./structs/REVOwnerExtraGrant.sol";
import {REVOwnerRevnetInit} from "./structs/REVOwnerRevnetInit.sol";

/// @notice The runtime hook for every revnet — set as each revnet's `dataHook` in ruleset metadata. At pay time, it
/// coordinates the 721 hook (NFT tier minting) with the buyback hook (secondary market swap routing) and scales weight
/// for split deductions. At cash-out time, it aggregates cross-chain total supply and surplus (including outstanding
/// loan debt and collateral), grants suckers 0% tax, splits a 2.5% fee from non-sucker cash-outs with a non-zero
/// cash-out tax, and routes fee proceeds to the fee revnet via `afterCashOutRecordedWith`.
/// @dev Separated from `REVDeployer` to stay within the EIP-170 contract size limit. Also implements
/// `IJBPeerChainAdjustedAccounts` to expose loan state to peer-chain supply/surplus snapshots. The trusted forwarder
/// is constructor-pinned so operator and permissionless runtime calls can be relayed through ERC-2771.
contract REVOwner is
    ERC2771Context,
    IREVOwner,
    IJBRulesetDataHook,
    IJBCashOutHook,
    IJBPeerChainAdjustedAccounts,
    IERC721Receiver
{
    // A library that adds default safety checks to ERC20 functionality.
    using SafeERC20 for IERC20;

    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice Thrown when initializing a revnet whose deployer binding has already been set.
    error REVOwner_AlreadyInitialized(address deployer);

    /// @notice Thrown when cashing out before the revnet's cash-out delay has elapsed.
    error REVOwner_CashOutDelayNotFinished(uint256 cashOutDelay, uint256 blockTimestamp);

    /// @notice Thrown when a loan source token has no matching accounting context on the multi terminal.
    error REVOwner_InvalidLoanSourceToken(uint256 revnetId, address token);

    /// @notice Thrown when the native value sent does not match the forwarded fee amount being processed.
    error REVOwner_NativeFeeValueMismatch(uint256 expected, uint256 actual);

    /// @notice Thrown when there are no tokens left to auto-issue for the given stage and beneficiary.
    error REVOwner_NothingToAutoIssue(uint256 revnetId, uint256 stageId, address beneficiary);

    /// @notice Thrown when there are no held tokens to burn for the revnet.
    error REVOwner_NothingToBurn(uint256 revnetId, address holder);

    /// @notice Thrown when a value exceeds the peer-snapshot wire type it must fit within.
    error REVOwner_OverflowAlert(uint256 value, uint256 limit);

    /// @notice Thrown when auto-issuing from a stage whose ruleset has not started yet.
    error REVOwner_StageNotStarted(uint256 stageId);

    /// @notice Thrown when the buyback hook returns more cash-out hook specifications than the fee path can compose.
    error REVOwner_TooManyBuybackHookSpecifications(uint256 count);

    /// @notice Thrown when the caller is not the expected deployer.
    error REVOwner_Unauthorized(address caller, address expectedCaller);

    /// @notice Thrown when the address is not the revnet's current operator.
    error REVOwner_UnauthorizedOperator(uint256 revnetId, address caller);

    /// @notice Thrown when a cross-currency local loan source returns a zero price per unit.
    error REVOwner_ZeroPrice(uint256 revnetId, uint256 pricingCurrency, uint256 unitCurrency);

    //*********************************************************************//
    // --------------- public immutable stored properties ---------------- //
    //*********************************************************************//

    /// @notice The buyback hook used as a data hook to route payments through buyback pools.
    IJBBuybackHookRegistry public immutable override BUYBACK_HOOK;

    /// @notice The directory of terminals and controllers for Juicebox projects.
    IJBDirectory public immutable override DIRECTORY;

    /// @notice The Juicebox project ID of the revnet that receives cash-out fees.
    uint256 public immutable override FEE_REVNET_ID;

    /// @notice The loan contract used by every revnet.
    IREVLoans public immutable override LOANS;

    /// @notice Deploys and tracks suckers for revnets.
    IJBSuckerRegistry public immutable override SUCKER_REGISTRY;

    //*********************************************************************//
    // --------------------- public stored properties -------------------- //
    //*********************************************************************//

    /// @notice The timestamp when cash-outs become available to a specific revnet's participants.
    /// @dev Only applies to existing revnets deploying onto a new network.
    /// @custom:param revnetId The ID of the revnet to check the cash-out delay for.
    mapping(uint256 revnetId => uint256 cashOutDelay) public override cashOutDelayOf;

    /// @notice Each revnet's tiered ERC-721 hook.
    /// @custom:param revnetId The ID of the revnet to look up.
    mapping(uint256 revnetId => IJB721TiersHook tiered721Hook) public override tiered721HookOf;

    /// @notice The amount of project tokens to auto-issue at a given stage to a given beneficiary.
    /// @custom:param revnetId The ID of the revnet to look up.
    /// @custom:param stageId The ID of the ruleset stage to look up.
    /// @custom:param beneficiary The address that will receive the auto-issued tokens.
    mapping(uint256 revnetId => mapping(uint256 stageId => mapping(address beneficiary => uint256 count)))
        public
        override amountToAutoIssue;

    /// @notice The deployer that manages revnet state.
    /// @dev Set once via `setDeployer()` using the precomputed canonical REVDeployer address.
    IREVDeployer public override deployer;

    /// @notice The controller used by every revnet to manage its project.
    /// @dev Cached from the deployer at `setDeployer()` time.
    IJBController public override CONTROLLER;

    /// @notice The permissions registry used to grant operator authority over revnets.
    /// @dev Cached from the deployer at `setDeployer()` time.
    IJBPermissions public override PERMISSIONS;

    /// @notice The Juicebox project NFT contract.
    /// @dev Cached from the deployer at `setDeployer()` time. Required for `onERC721Received` authentication.
    IJBProjects public override PROJECTS;

    //*********************************************************************//
    // -------------------- internal stored properties ------------------- //
    //*********************************************************************//

    /// @notice Additional operator permissions configured per revnet on top of the protocol-default set.
    /// @custom:param revnetId The ID of the revnet to look up.
    mapping(uint256 revnetId => uint256[] permissionIds) internal _extraOperatorPermissions;

    //*********************************************************************//
    // -------------------- private stored properties -------------------- //
    //*********************************************************************//

    /// @notice The account allowed to bind the canonical deployer exactly once.
    address private immutable _DEPLOYER;

    //*********************************************************************//
    // -------------------------- constructor ---------------------------- //
    //*********************************************************************//

    /// @param buybackHook The buyback hook used to route payments.
    /// @param directory The directory of terminals and controllers.
    /// @param feeRevnetId The Juicebox project ID of the fee revnet.
    /// @param suckerRegistry The sucker registry.
    /// @param loans The loan contract.
    /// @param trustedForwarder The trusted forwarder for the ERC2771Context.
    /// @param deployerAddress The account allowed to bind the canonical deployer via `setDeployer`. Passed explicitly
    /// because CREATE2 deployments set `msg.sender` to the factory, not the intended operator.
    constructor(
        IJBBuybackHookRegistry buybackHook,
        IJBDirectory directory,
        uint256 feeRevnetId,
        IJBSuckerRegistry suckerRegistry,
        IREVLoans loans,
        address trustedForwarder,
        address deployerAddress
    )
        ERC2771Context(trustedForwarder)
    {
        BUYBACK_HOOK = buybackHook;
        DIRECTORY = directory;
        FEE_REVNET_ID = feeRevnetId;
        SUCKER_REGISTRY = suckerRegistry;
        LOANS = loans;
        _DEPLOYER = deployerAddress;
    }

    //*********************************************************************//
    // ------------------------- external views -------------------------- //
    //*********************************************************************//

    /// @notice Hook called by the JBTerminalStore during cash-out to enforce revnet-specific tax/fee/aggregation logic.
    /// @dev This function is the policy boundary between three distinct cash-out semantics:
    ///
    /// 1. **Sucker cash-outs (registered bridge contracts):** returns tax=0 and uses LOCAL supply/surplus only.
    ///    Lines 209-211. Bridges cash out tokens at the originating chain's local backing rate to move value
    ///    across chains. This is the bridge accounting primitive — keep value moving out of this chain
    ///    proportional to this chain's local backing, regardless of cross-chain aggregation. This deliberate
    ///    asymmetry vs. ordinary cash-outs is what enables the cross-chain rebalancing arbitrage path described
    ///    in ARBITRAGE.md (Path 1). See also INVARIANTS.md Section D2 at the monorepo root.
    ///
    /// 2. **Ordinary cash-outs during the cash-out delay window:** revert. Lines around 217-220. The delay
    ///    blocks direct exits (cash-out/borrow) on new chains so they can prime via bridges before users
    ///    start drawing value. Note the delay does NOT apply to sucker cash-outs (item 1) — priming requires
    ///    bridges to remain open.
    ///
    /// 3. **Ordinary cash-outs after delay:** aggregate cross-chain state when `scopeCashOutsToLocalBalances`
    ///    is false, then route through the buyback hook to potentially settle via AMM (Path 2 floor arb in
    ///    ARBITRAGE.md) or pass through to bonding curve. The buyback hook auto-applies floor arbitrage for
    ///    users who would otherwise underpay themselves.
    ///
    /// The interaction of these three semantics — together with the buyback hook's pay-side ceiling arbitrage
    /// (Path 3, in nana-buyback-hook-v6) — is what makes a multi-chain revnet self-equilibrating. See
    /// ARBITRAGE.md for the full taxonomy.
    ///
    /// Part of `IJBRulesetDataHook`. In the non-zero-tax fee path, REVOwner is intentionally not registered as a
    /// feeless address — the protocol fee (2.5%) applies on top of the rev fee. The fee hook spec amount sent to
    /// `afterCashOutRecordedWith` will have the protocol fee deducted by the terminal before reaching this contract.
    /// The fee path composes at most one buyback hook spec ahead of its own fee spec.
    /// @param context Standard Juicebox cash-out context. See `JBBeforeCashOutRecordedContext`.
    /// @return cashOutTaxRate The cash-out tax rate, which influences the amount of terminal tokens reclaimed.
    /// @return cashOutCount The number of revnet tokens to cash out.
    /// @return totalSupply The total token supply across all chains (for both proportional reclaim and tax).
    /// @return effectiveSurplusValue The global surplus across all chains for proportional reclaim.
    /// @return hookSpecifications The amount of funds and data to send to cash-out hooks (this contract).
    function beforeCashOutRecordedWith(JBBeforeCashOutRecordedContext calldata context)
        external
        view
        override
        returns (
            uint256 cashOutTaxRate,
            uint256 cashOutCount,
            uint256 totalSupply,
            uint256 effectiveSurplusValue,
            JBCashOutHookSpecification[] memory hookSpecifications
        )
    {
        // Treat outstanding local loans as temporarily off-terminal revnet assets. Borrowed funds are owed back to
        // the revnet, while burned loan collateral can be re-minted on repayment, so both affect fair cash-out math.
        (uint256 totalBorrowed, uint256 totalCollateral) = _localLoanStateOf({
            revnetId: context.projectId, decimals: context.surplus.decimals, currency: context.surplus.currency
        });

        // Start with local supply and surplus (including collateral and borrowed amounts).
        totalSupply = context.totalSupply + totalCollateral;
        effectiveSurplusValue = context.surplus.value + totalBorrowed;

        // If the cash-out is from a sucker, return the full cash-out amount without taxes or fees.
        // Sucker cash-outs are the bridge accounting path: the value moving out of this chain must stay
        // proportional to this chain's local backing. Do not add remote supply/surplus here, even for
        // unscoped revnets. This is deliberate — the asymmetry vs. ordinary cash-outs (which aggregate
        // cross-chain) is what enables the cross-chain rebalancing arbitrage that primes new chains and
        // equalizes per-chain backing divergence. See ARBITRAGE.md (Path 1).
        // This relies on the sucker registry to only contain trusted sucker contracts deployed via
        // the registry's own deploySuckersFor flow — external addresses cannot register as suckers.
        if (_isSuckerOf({revnetId: context.projectId, addr: context.holder})) {
            return (0, context.cashOutCount, totalSupply, effectiveSurplusValue, hookSpecifications);
        }

        // Keep a reference to the cash-out delay of the revnet.
        uint256 cashOutDelay = cashOutDelayOf[context.projectId];

        // Enforce the cash-out delay on ordinary cash-outs.
        // Note: the sucker branch above returns BEFORE this check by design — bridges remain open during
        // the delay so a new chain can prime its local backing via inbound bridges before any holder can
        // directly exit. See ARBITRAGE.md (Path 1) and INVARIANTS.md Section D2 for the rationale.
        // forge-lint: disable-next-line(block-timestamp)
        if (cashOutDelay > block.timestamp) {
            revert REVOwner_CashOutDelayNotFinished({cashOutDelay: cashOutDelay, blockTimestamp: block.timestamp});
        }

        // Get the terminal that will receive the cash-out fee.
        IJBTerminal feeTerminal = DIRECTORY.primaryTerminalOf({projectId: FEE_REVNET_ID, token: context.surplus.token});

        // If the ruleset aggregates cross-chain state, add remote supply and surplus.
        if (!context.scopeCashOutsToLocalBalances) {
            totalSupply += SUCKER_REGISTRY.remoteTotalSupplyOf(context.projectId);
            effectiveSurplusValue += SUCKER_REGISTRY.totalRemoteSurplusOf({
                projectId: context.projectId,
                decimals: context.surplus.decimals,
                currency: uint256(context.surplus.currency)
            });
        }

        // If there is no cash-out tax, no fee terminal, or a feeless beneficiary (e.g. the router terminal routing
        // value between projects), proxy to the buyback hook with our totalSupply and
        // effectiveSurplusValue. Zero-tax ordinary cash-outs do not add the revnet fee hook.
        if (context.cashOutTaxRate == 0 || address(feeTerminal) == address(0) || context.beneficiaryIsFeeless) {
            // Build a modified context with cross-chain-adjusted values so the buyback hook sees the global state
            // for its swap-vs-passthrough routing decision.
            JBBeforeCashOutRecordedContext memory routedContext = context;
            routedContext.totalSupply = totalSupply;
            routedContext.surplus.value = effectiveSurplusValue;
            (cashOutTaxRate, cashOutCount,,, hookSpecifications) = BUYBACK_HOOK.beforeCashOutRecordedWith(routedContext);
            return (cashOutTaxRate, cashOutCount, totalSupply, effectiveSurplusValue, hookSpecifications);
        }

        // Split the cashed-out tokens into a fee portion and a non-fee portion.
        // The fee is applied to TOKEN COUNT (2.5% of tokens), not to value. The fee revnet receives the bonding-curve
        // reclaim of its 2.5% token share regardless of whether the remaining 97.5% routes through a buyback pool at
        // a better price. This is by design.
        // Micro cash-outs (< 40 wei at 2.5% fee) round feeCashOutCount to zero. This accepted floor is economically
        // negligible because gas dominates the avoided fee.
        uint256 feeCashOutCount = JBFees.standardFeeAmountFrom(context.cashOutCount);
        uint256 nonFeeCashOutCount = context.cashOutCount - feeCashOutCount;

        // Compute the gross (effective-surplus) reclaim and fee amounts. The bonding curve uses cross-chain effective
        // surplus, which can exceed what this chain's terminal actually holds.
        uint256 postFeeReclaimedAmount = JBCashOuts.cashOutFrom({
            surplus: effectiveSurplusValue,
            cashOutCount: nonFeeCashOutCount,
            totalSupply: totalSupply,
            cashOutTaxRate: context.cashOutTaxRate
        });
        uint256 feeAmount = JBCashOuts.cashOutFrom({
            surplus: effectiveSurplusValue > postFeeReclaimedAmount
                ? effectiveSurplusValue - postFeeReclaimedAmount
                : 0,
            cashOutCount: feeCashOutCount,
            totalSupply: totalSupply - nonFeeCashOutCount,
            cashOutTaxRate: context.cashOutTaxRate
        });

        // Snapshot the unscaled reclaim before the local-liquidity proportional scaling below mutates it. This is
        // what `JBTerminalStore._cashOutWithDataHook` will recompute when it calls
        // `JBCashOuts.cashOutFrom(effectiveSurplusValue, cashOutCount, totalSupply, cashOutTaxRate)` — same inputs,
        // same output. Used to cap the surplus we report to the store so the recompute leaves room for the fee.
        uint256 unscaledReclaim = postFeeReclaimedAmount;

        // If the gross outflow exceeds local terminal liquidity, scale reclaim AND fee proportionally so the fee
        // is preserved instead of being capped to zero when the reclaim alone consumes all local surplus.
        uint256 grossOutflow = postFeeReclaimedAmount + feeAmount;
        if (grossOutflow > context.surplus.value) {
            if (grossOutflow == 0) {
                // Defensive — both grossOutflow > localSurplus and grossOutflow == 0 can't both hold, but keep
                // the explicit branch so a non-zero gross outflow is guaranteed before the division.
                postFeeReclaimedAmount = 0;
                feeAmount = 0;
            } else {
                uint256 localSurplus = context.surplus.value;
                postFeeReclaimedAmount = mulDiv({x: postFeeReclaimedAmount, y: localSurplus, denominator: grossOutflow});
                feeAmount = mulDiv({x: feeAmount, y: localSurplus, denominator: grossOutflow});
            }
        }

        // Build a context for the buyback hook using the non-fee token count and the surplus that
        // produces the LOCALLY-CAPPED direct reclaim. The buyback hook compares this direct reclaim
        // against its pool route to decide noop-vs-swap; passing the global pre-cap surplus would
        // make it score the direct path against an amount the terminal cannot actually deliver,
        // so the hook would skip pools that would have paid more than the final local reclaim.
        // `cashOutFrom` is linear in surplus, so scaling the surplus by the same factor that
        // scaled the reclaim recovers the locally-capped reclaim at the same cashOutCount/
        // totalSupply/tax inputs.
        uint256 buybackSurplus = effectiveSurplusValue;
        if (postFeeReclaimedAmount != unscaledReclaim && unscaledReclaim != 0) {
            buybackSurplus = mulDiv({x: effectiveSurplusValue, y: postFeeReclaimedAmount, denominator: unscaledReclaim});
        }

        JBBeforeCashOutRecordedContext memory buybackHookContext = context;
        buybackHookContext.cashOutCount = nonFeeCashOutCount;
        buybackHookContext.totalSupply = totalSupply;
        buybackHookContext.surplus.value = buybackSurplus;

        // Let the buyback hook adjust the cash-out parameters and optionally return a hook specification.
        JBCashOutHookSpecification[] memory buybackHookSpecifications;
        (cashOutTaxRate, cashOutCount,,, buybackHookSpecifications) =
            BUYBACK_HOOK.beforeCashOutRecordedWith(buybackHookContext);

        // If the fee rounds down to zero, return the buyback hook's response directly — no fee to process.
        if (feeAmount == 0) {
            return (cashOutTaxRate, cashOutCount, totalSupply, effectiveSurplusValue, buybackHookSpecifications);
        }

        // The store will recompute the beneficiary reclaim as `cashOutFrom(effectiveSurplusValue, cashOutCount,
        // totalSupply, cashOutTaxRate)` and add the fee spec on top. When local liquidity is the binding cap, that
        // sum can exceed local surplus and revert. `cashOutFrom` is linear in `surplus`, so scale the surplus we
        // report so the store-side reclaim is at most `localSurplus - feeAmount`, preserving room for the fee.
        // The fee was already scaled, if needed, by the local-liquidity block above. Only the store-facing surplus is
        // touched; the buyback hook already received the full pre-cap value for its routing decision.
        //
        // Worked example (local=10, global=100, 500 of 1000 tokens at 50% tax):
        //   local-liquidity scaling above:
        //     unscaledReclaim = cashOutFrom(100, 487.5, 1000, 5000)            ≈ 36 ETH        (global)
        //     feeAmount       = cashOutFrom(64, 12.5, 512.5, 5000)             ≈ 0.78 ETH      (global)
        //     grossOutflow ≈ 36.78 > 10  →  scale both proportionally to local liquidity:
        //       postFeeReclaimedAmount *= 10/36.78 ≈ 9.79 ETH
        //       feeAmount              *= 10/36.78 ≈ 0.214 ETH                 (preserved, nonzero)
        //   this block:
        //     reclaimCap = 10 − 0.214 = 9.786 ETH
        //     unscaledReclaim (36) > reclaimCap (9.786)  →  cap the surplus we report:
        //       effectiveSurplusValue = 100 × 9.786 / 36 ≈ 27.18 ETH
        //   store recompute (linear in surplus):
        //     storeReclaim = 36 × (27.18 / 100) ≈ 9.786 ETH
        //     balanceDiff  = 9.786 + 0.214 = 10 ETH = localSurplus              ✓ no revert
        //
        // Underflow safety: `feeAmount <= localSurplus` holds in both branches.
        // In the scaling branch, `feeAmount <= grossOutflow` and the multiplier is
        // `localSurplus / grossOutflow <= 1`. In the else branch, `feeAmount <= grossOutflow <= localSurplus`.
        uint256 reclaimCap = context.surplus.value - feeAmount;
        if (unscaledReclaim > reclaimCap) {
            effectiveSurplusValue = mulDiv({x: effectiveSurplusValue, y: reclaimCap, denominator: unscaledReclaim});
        }

        // Build a hook spec that routes the fee amount to this contract's `afterCashOutRecordedWith` for processing.
        JBCashOutHookSpecification memory feeSpec = JBCashOutHookSpecification({
            hook: IJBCashOutHook(address(this)), noop: false, amount: feeAmount, metadata: abi.encode(feeTerminal)
        });

        // The fee path preserves one buyback cash-out spec ahead of its fee spec. More specs require a composition
        // strategy this hook contract does not define.
        if (buybackHookSpecifications.length > 1) {
            revert REVOwner_TooManyBuybackHookSpecifications({count: buybackHookSpecifications.length});
        }

        // Compose the final hook specifications: buyback spec (if any) + fee spec.
        if (buybackHookSpecifications.length > 0) {
            // The buyback hook returned a spec — include it before the fee spec.
            hookSpecifications = new JBCashOutHookSpecification[](2);
            hookSpecifications[0] = buybackHookSpecifications[0];
            hookSpecifications[1] = feeSpec;
        } else {
            // No buyback spec — only the fee spec.
            hookSpecifications = new JBCashOutHookSpecification[](1);
            hookSpecifications[0] = feeSpec;
        }

        return (cashOutTaxRate, cashOutCount, totalSupply, effectiveSurplusValue, hookSpecifications);
    }

    /// @notice Called before a payment is recorded. Coordinates the 721 hook (NFT tier minting with split deductions)
    /// with the buyback hook (which may route funds through a Uniswap pool for a better token price). Merges their hook
    /// specifications and scales the minting weight so payers only receive tokens proportional to funds entering the
    /// project (not the split portion).
    /// @dev Part of `IJBRulesetDataHook`. The 721 hook spec comes first in the returned array.
    /// @param context Standard Juicebox payment context. See `JBBeforePayRecordedContext`.
    /// @return weight The weight which revnet tokens are minted relative to. This can be used to customize how many
    /// tokens get minted by a payment.
    /// @return hookSpecifications Amounts (out of what's paid in) to send to pay hooks instead of adding to the
    /// revnet. Useful for automatically routing funds from a treasury as payments come in.
    function beforePayRecordedWith(JBBeforePayRecordedContext calldata context)
        external
        view
        override
        returns (uint256 weight, JBPayHookSpecification[] memory hookSpecifications)
    {
        // Get the 721 hook's spec and total split amount.
        IJB721TiersHook tiered721Hook = tiered721HookOf[context.projectId];
        JBPayHookSpecification memory tiered721HookSpec;
        uint256 totalSplitAmount;
        bool usesTiered721Hook = address(tiered721Hook) != address(0);
        if (usesTiered721Hook) {
            JBPayHookSpecification[] memory specs;
            (, specs) = IJBRulesetDataHook(address(tiered721Hook)).beforePayRecordedWith(context);
            // The 721 hook returns a single spec (itself) whose amount is the total split amount.
            if (specs.length > 0) {
                tiered721HookSpec = specs[0];
                totalSplitAmount = tiered721HookSpec.amount;
            }
        }

        // The amount entering the project after tier splits.
        uint256 projectAmount = totalSplitAmount >= context.amount.value ? 0 : context.amount.value - totalSplitAmount;

        // Get the buyback hook's weight and specs. Reduce the amount so it only considers funds entering the project.
        JBPayHookSpecification[] memory buybackHookSpecs;
        {
            JBBeforePayRecordedContext memory buybackHookContext = context;
            buybackHookContext.amount.value = projectAmount;
            (weight, buybackHookSpecs) = BUYBACK_HOOK.beforePayRecordedWith(buybackHookContext);
        }

        // Scale the buyback hook's weight for splits so the terminal mints tokens only for the project's share.
        // The terminal uses the full context.amount.value for minting (tokenCount = amount * weight / weightRatio),
        // but only projectAmount actually enters the project. Without scaling, payers get token credit for the split
        // portion too. Preserves weight=0 from the buyback hook (buying back, not minting).
        if (projectAmount == 0) {
            weight = 0;
        } else if (projectAmount < context.amount.value) {
            weight = mulDiv({x: weight, y: projectAmount, denominator: context.amount.value});
        }

        // Merge hook specifications: 721 hook spec first, then buyback hook spec.
        bool usesBuybackHook = buybackHookSpecs.length > 0;
        hookSpecifications = new JBPayHookSpecification[]((usesTiered721Hook ? 1 : 0) + (usesBuybackHook ? 1 : 0));

        if (usesTiered721Hook) hookSpecifications[0] = tiered721HookSpec;
        if (usesBuybackHook) hookSpecifications[usesTiered721Hook ? 1 : 0] = buybackHookSpecs[0];
    }

    /// @notice Returns whether an address may mint a revnet's tokens on-demand. Grants permission to: the loans
    /// contract (re-mints collateral on repayment), buyback hook and its delegates (mints tokens from pool swaps),
    /// and suckers (mints bridged tokens on the destination chain).
    /// @dev Part of `IJBRulesetDataHook`.
    /// @param revnetId The ID of the revnet to check.
    /// @param ruleset The ruleset to check against.
    /// @param addr The address to check.
    /// @return flag A flag indicating whether the address has permission to mint the revnet's tokens on-demand.
    function hasMintPermissionFor(
        uint256 revnetId,
        JBRuleset calldata ruleset,
        address addr
    )
        external
        view
        override
        returns (bool)
    {
        // The loans contract, buyback hook (and its delegates), and suckers are allowed to mint the revnet's tokens.
        return addr == address(LOANS) || addr == address(BUYBACK_HOOK)
            || BUYBACK_HOOK.hasMintPermissionFor({projectId: revnetId, ruleset: ruleset, addr: addr})
            || _isSuckerOf({revnetId: revnetId, addr: addr});
    }

    /// @notice Adjusts local accounts for outstanding loans when reporting peer-chain state.
    /// @dev Used by remote chains' aggregate cash-out math to correctly account for value temporarily
    /// held outside this chain's terminal (in active REVLoans). Critical for the conservation invariant
    /// described in INVARIANTS.md Section D2.5 — without this adjustment, outstanding-loan value would
    /// silently inflate apparent surplus on the peer-chain side.
    ///
    /// Each loan source token's outstanding debt is reported as its own context, raw and un-valued in the
    /// token's own currency and decimals, counted as both surplus and balance: it is value owed back to this
    /// chain's revnet and travels to peer snapshots with the collateral supply, where the receiving chain folds
    /// it into the matching same-asset local context at par.
    /// @param revnetId The ID of the revnet to snapshot.
    /// @return supply The loan-collateral supply to include in the peer snapshot.
    /// @return contexts One entry per loan source token with outstanding debt, as both surplus and balance.
    function peerChainAdjustedAccountsOf(uint256 revnetId)
        external
        view
        override
        returns (uint256 supply, JBSourceContext[] memory contexts)
    {
        IREVLoans loans = LOANS;
        if (address(loans) == address(0) || address(loans).code.length == 0) {
            return (0, new JBSourceContext[](0));
        }

        // Burned loan collateral re-enters supply when the loan is repaid, so it travels with the snapshot.
        supply = loans.totalCollateralOf(revnetId);

        address[] memory sources = loans.loanSourceTokensOf(revnetId);
        if (sources.length == 0) return (supply, new JBSourceContext[](0));

        // Read each source's outstanding debt once, so the contexts array can be sized to only the active sources.
        uint256[] memory loaned = new uint256[](sources.length);
        uint256 activeCount;
        for (uint256 i; i < sources.length; i++) {
            loaned[i] = loans.totalBorrowedFrom({revnetId: revnetId, token: sources[i]});
            if (loaned[i] != 0) activeCount++;
        }

        contexts = new JBSourceContext[](activeCount);
        if (activeCount == 0) return (supply, contexts);

        IJBTerminal multiTerminal = deployer.MULTI_TERMINAL();
        uint256 count;
        for (uint256 i; i < sources.length; i++) {
            if (loaned[i] == 0) continue;
            address sourceToken = sources[i];

            // Loan sources live as accounting contexts on the canonical multi terminal; the declared decimals are
            // carried verbatim so the receiving chain can match the context to its same-asset local one.
            JBAccountingContext memory sourceContext =
                multiTerminal.accountingContextForTokenOf({projectId: revnetId, token: sourceToken});
            if (sourceContext.token != sourceToken) {
                revert REVOwner_InvalidLoanSourceToken({revnetId: revnetId, token: sourceToken});
            }

            // Peer snapshots carry debt in uint128 fields. Revert instead of wrapping debt that cannot be represented.
            if (loaned[i] > type(uint128).max) {
                revert REVOwner_OverflowAlert({value: loaned[i], limit: type(uint128).max});
            }

            // forge-lint: disable-next-line(unsafe-typecast)
            uint128 debt = uint128(loaned[i]);
            contexts[count++] = JBSourceContext({
                token: bytes32(uint256(uint160(sourceToken))),
                decimals: sourceContext.decimals,
                surplus: debt,
                balance: debt
            });
        }
    }

    //*********************************************************************//
    // --------------------- external transactions ----------------------- //
    //*********************************************************************//

    /// @notice Process the fee from a cash-out.
    /// @param context Cash out context passed in by the terminal.
    function afterCashOutRecordedWith(JBAfterCashOutRecordedContext calldata context) external payable override {
        // No caller validation needed — this hook only pays fees to the fee project using funds forwarded by the
        // caller. A non-terminal caller would donate their own funds as fees. There's nothing to exploit.

        if (context.forwardedAmount.token == JBConstants.NATIVE_TOKEN) {
            // Native fee processing must be value-balanced by the current call. Otherwise a non-terminal caller could
            // spend ETH that was forcibly sent or accidentally stranded in this hook.
            if (msg.value != context.forwardedAmount.value) {
                revert REVOwner_NativeFeeValueMismatch({expected: context.forwardedAmount.value, actual: msg.value});
            }
        } else {
            if (msg.value != 0) revert REVOwner_NativeFeeValueMismatch({expected: 0, actual: msg.value});

            // If there's sufficient approval, transfer normally.
            IERC20(context.forwardedAmount.token)
                .safeTransferFrom({from: msg.sender, to: address(this), value: context.forwardedAmount.value});
        }

        // Parse the metadata forwarded from the data hook to get the fee terminal.
        // See `beforeCashOutRecordedWith(…)`.
        (IJBTerminal feeTerminal) = abi.decode(context.hookMetadata, (IJBTerminal));

        // Determine how much to pay in `msg.value` (in the native currency).
        uint256 payValue = _beforeTransferTo({
            to: address(feeTerminal), token: context.forwardedAmount.token, amount: context.forwardedAmount.value
        });

        // Pay the fee.
        try feeTerminal.pay{value: payValue}({
            projectId: FEE_REVNET_ID,
            token: context.forwardedAmount.token,
            amount: context.forwardedAmount.value,
            beneficiary: context.holder,
            minReturnedTokens: 0,
            memo: "",
            metadata: bytes(abi.encodePacked(context.projectId))
        }) {
            _afterTransferTo({to: address(feeTerminal), token: context.forwardedAmount.token});
        } catch (bytes memory) {
            // Decrease the allowance for the fee terminal if the token is not the native token.
            if (context.forwardedAmount.token != JBConstants.NATIVE_TOKEN) {
                IERC20(context.forwardedAmount.token)
                    .safeDecreaseAllowance({
                    spender: address(feeTerminal), requestedDecrease: context.forwardedAmount.value
                });
            }

            // If the fee can't be processed, return the funds to the project.
            payValue = _beforeTransferTo({
                to: msg.sender, token: context.forwardedAmount.token, amount: context.forwardedAmount.value
            });

            IJBTerminal(msg.sender).addToBalanceOf{value: payValue}({
                projectId: context.projectId,
                token: context.forwardedAmount.token,
                amount: context.forwardedAmount.value,
                shouldReturnHeldFees: false,
                memo: "",
                metadata: bytes(abi.encodePacked(FEE_REVNET_ID))
            });
            _afterTransferTo({to: msg.sender, token: context.forwardedAmount.token});
        }
    }

    /// @notice Bind every piece of revnet-scoped state managed by this contract in a single deployer call. Stores
    /// the cash-out delay, the tiered ERC-721 hook, auto-issuance allocations, extra operator permissions, the
    /// initial operator, and any integration-specific permission grants.
    /// @dev Only callable by the canonical deployer during a revnet's initial configuration. Extra operator
    /// permissions are appended before bootstrap, so the operator receives the merged set in one permissions write.
    /// @param revnetId The ID of the revnet being initialized.
    /// @param init The full initialization payload.
    function initializeRevnet(uint256 revnetId, REVOwnerRevnetInit calldata init) external override {
        // Only the canonical deployer may bind a revnet's runtime state. Any other caller would let an outsider
        // overwrite cash-out delays, hook addresses, or operator permissions for an existing revnet.
        if (msg.sender != address(deployer)) {
            revert REVOwner_Unauthorized({caller: msg.sender, expectedCaller: address(deployer)});
        }

        // Store the cash-out delay if the deployer computed one (existing revnet landing on a new chain). A zero
        // delay means cash-outs are unlocked immediately, so skip the storage write to save gas in the common case.
        if (init.cashOutDelay != 0) {
            cashOutDelayOf[revnetId] = init.cashOutDelay;
        }

        // Bind the tiered ERC-721 hook the deployer created for this revnet so `beforePayRecordedWith` can route
        // NFT-tier mints through it. The deployer always deploys a hook (empty or pre-tiered), so the zero guard is
        // defensive.
        if (address(init.tiered721Hook) != address(0)) {
            tiered721HookOf[revnetId] = init.tiered721Hook;
        }

        // Record every auto-issuance allocation that lands on this chain. The deployer pre-filtered by `chainId`
        // and resolved each stage ID to its canonical ruleset ID, so each entry is ready to be claimed later via
        // `autoIssueFor`. `+=` (instead of `=`) lets the deployer split the same beneficiary across multiple stage
        // entries without one overwriting another.
        for (uint256 i; i < init.autoIssuances.length;) {
            REVOwnerAutoIssuance calldata autoIssuance = init.autoIssuances[i];
            amountToAutoIssue[revnetId][autoIssuance.stageId][autoIssuance.beneficiary] += autoIssuance.count;
            unchecked {
                ++i;
            }
        }

        // Append any deployer-supplied extra permissions (e.g. 721 hook admin permissions) to this revnet's
        // operator set BEFORE bootstrapping the operator below — `_setOperatorOf` reads the merged set, so the
        // operator must see these extras on its first permissions write.
        for (uint256 i; i < init.extraOperatorPermissionIds.length;) {
            _extraOperatorPermissions[revnetId].push(init.extraOperatorPermissionIds[i]);
            unchecked {
                ++i;
            }
        }

        // Grant the operator the merged default + extra permission set in a single permissions write. Passing
        // `address(0)` here is the explicit way to launch a revnet with no operator — no permissions get written
        // because `_setPermissionsFor` is called with the zero address as the holder.
        _setOperatorOf({revnetId: revnetId, operator: init.operator});

        // Apply per-revnet permission grants for integrations that aren't the operator (e.g. the Croptop
        // publisher needs `ADJUST_721_TIERS` to post NFTs on the revnet's behalf). Each grant is scoped to a
        // specific (revnet, operator, permissionId) triple on this contract's account so it does not leak into
        // the operator's general authority.
        for (uint256 i; i < init.extraGrants.length;) {
            REVOwnerExtraGrant calldata grant = init.extraGrants[i];
            uint8[] memory permissionIds = new uint8[](1);
            permissionIds[0] = grant.permissionId;
            _setPermissionsFor({
                account: address(this), operator: grant.operator, revnetId: revnetId, permissionIds: permissionIds
            });
            unchecked {
                ++i;
            }
        }

        // Emit a single marker event for off-chain indexers — the deployer side already emits granular events
        // (`DeployRevnet`, `StoreAutoIssuanceAmount`, `SetCashOutDelay`) with the underlying data.
        emit InitializeRevnet({revnetId: revnetId, caller: msg.sender});
    }

    /// @notice Bind the canonical deployer address exactly once.
    /// @dev The deployer address is precomputed and supplied by the account that created this REVOwner instance.
    /// Only that deploy-time binder may call this, which avoids an ambient public initializer where any first caller
    /// could seize the deployer role before the deterministic REVDeployer is actually deployed.
    /// @param newDeployer The canonical REVDeployer instance that will manage revnet runtime state.
    function setDeployer(IREVDeployer newDeployer) external override {
        address sender = _msgSender();
        // Only the account that deployed this REVOwner may complete the one-time deployer binding.
        if (sender != _DEPLOYER) revert REVOwner_Unauthorized({caller: sender, expectedCaller: _DEPLOYER});
        // Prevent the deployer binding from being overwritten after initialization.
        if (address(deployer) != address(0)) revert REVOwner_AlreadyInitialized({deployer: address(deployer)});
        // Store the canonical REVDeployer that is authorized to manage runtime hook state.
        deployer = newDeployer;
        // Cache references read from the deployer so on-chain ownership operations don't need to re-traverse the
        // deployer for each call. These are immutable on the deployer side so a single snapshot is sufficient.
        CONTROLLER = newDeployer.CONTROLLER();
        PERMISSIONS = newDeployer.PERMISSIONS();
        PROJECTS = newDeployer.PROJECTS();

        // Grant the wildcard operator permissions used by every revnet, scoped on this contract's account.
        // The loan contract is the singleton shared by every revnet and uses the surplus allowance of each
        // revnet's terminal. The buyback hook registry configures pools on every revnet.
        uint8[] memory loanPermissionIds = new uint8[](1);
        loanPermissionIds[0] = JBPermissionIds.USE_ALLOWANCE;
        _setPermissionsFor({
            account: address(this), operator: address(LOANS), revnetId: 0, permissionIds: loanPermissionIds
        });

        uint8[] memory buybackPermissionIds = new uint8[](1);
        buybackPermissionIds[0] = JBPermissionIds.SET_BUYBACK_POOL;
        _setPermissionsFor({
            account: address(this), operator: address(BUYBACK_HOOK), revnetId: 0, permissionIds: buybackPermissionIds
        });

        // The deployer drives sucker setup for every revnet (initial deploy + post-deploy via
        // `REVDeployer.deploySuckersFor`). Grant it `DEPLOY_SUCKERS` and `MAP_SUCKER_TOKEN` against this contract's
        // account so the sucker registry sees an authorized caller acting for the project owner (this contract).
        uint8[] memory deployerPermissionIds = new uint8[](2);
        deployerPermissionIds[0] = JBPermissionIds.DEPLOY_SUCKERS;
        deployerPermissionIds[1] = JBPermissionIds.MAP_SUCKER_TOKEN;
        _setPermissionsFor({
            account: address(this), operator: address(newDeployer), revnetId: 0, permissionIds: deployerPermissionIds
        });
    }

    /// @notice Auto-mint a revnet's tokens from a stage for a beneficiary.
    /// @dev Permissionless: anyone can trigger the mint once the stage has started. The recorded amount is consumed
    /// (reset to zero) after the mint executes.
    /// @param revnetId The ID of the revnet to auto-mint tokens for.
    /// @param stageId The ID of the ruleset stage to auto-mint tokens from.
    /// @param beneficiary The address to send auto-minted tokens to.
    function autoIssueFor(uint256 revnetId, uint256 stageId, address beneficiary) external override {
        // Get the ruleset for the stage to check if it has started.
        (JBRuleset memory ruleset,) = CONTROLLER.getRulesetOf({projectId: revnetId, rulesetId: stageId});

        // Make sure the stage has started.
        // forge-lint: disable-next-line(block-timestamp)
        if (ruleset.start > block.timestamp) {
            revert REVOwner_StageNotStarted({stageId: stageId});
        }

        uint256 count = amountToAutoIssue[revnetId][stageId][beneficiary];
        if (count == 0) {
            revert REVOwner_NothingToAutoIssue({revnetId: revnetId, stageId: stageId, beneficiary: beneficiary});
        }

        // Reset before the external call to prevent re-entry from re-claiming.
        amountToAutoIssue[revnetId][stageId][beneficiary] = 0;

        emit AutoIssue({
            revnetId: revnetId, stageId: stageId, beneficiary: beneficiary, count: count, caller: _msgSender()
        });

        CONTROLLER.mintTokensOf({
            projectId: revnetId, tokenCount: count, beneficiary: beneficiary, memo: "", useReservedPercent: false
        });
    }

    /// @notice Burn any of a revnet's project tokens that have accumulated on this contract.
    /// @dev Tokens accrue here from reserved-token distributions when splits don't sum to 100% (the JBController
    /// mints the leftover to the project owner — which is this contract).
    /// @param revnetId The ID of the revnet to burn tokens for.
    function burnHeldTokensOf(uint256 revnetId) external override {
        // Ask the controller's token registry for this contract's combined credit + ERC-20 balance for the revnet.
        // This is the residue from reserved-token distributions where the splits don't sum to 100% — the
        // controller mints the leftover to the project owner, which is this contract.
        uint256 balance = CONTROLLER.TOKENS().totalBalanceOf({holder: address(this), projectId: revnetId});

        // If there's nothing held, fail early — burning zero would silently no-op and waste the caller's gas.
        if (balance == 0) revert REVOwner_NothingToBurn({revnetId: revnetId, holder: address(this)});

        // Burn the full held balance through the controller. The controller drains credits first, then any
        // ERC-20 supply on this contract, so a single call always clears the residue regardless of how it accrued.
        CONTROLLER.burnTokensOf({holder: address(this), projectId: revnetId, tokenCount: balance, memo: ""});

        // Record the burn for off-chain accounting. Relayed calls attribute `caller` to the signer, and this
        // entrypoint remains intentionally permissionless.
        emit BurnHeldTokens({revnetId: revnetId, count: balance, caller: _msgSender()});
    }

    /// @notice Change a revnet's operator.
    /// @dev Only a revnet's current operator can rotate the operator. Passing `address(0)` relinquishes operator
    /// powers permanently — the permissions move to the zero address which cannot execute transactions.
    /// @param revnetId The ID of the revnet to change the operator for.
    /// @param newOperator The new operator's address. Use `address(0)` to relinquish operator powers.
    function setOperatorOf(uint256 revnetId, address newOperator) external override {
        address sender = _msgSender();
        _checkIfIsOperatorOf({revnetId: revnetId, operator: sender});

        emit ReplaceOperator({revnetId: revnetId, newOperator: newOperator, caller: sender});

        // Remove operator permissions from the old operator.
        _setPermissionsFor({
            account: address(this), operator: sender, revnetId: revnetId, permissionIds: new uint8[](0)
        });

        // Grant the default operator permissions to the new operator (no-op if `newOperator == address(0)`).
        _setOperatorOf({revnetId: revnetId, operator: newOperator});
    }

    /// @notice Required to receive the JBProjects NFT for each revnet that this contract owns.
    /// @dev Only accepts NFTs from the canonical `JBProjects` contract.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(PROJECTS)) revert();
        return IERC721Receiver.onERC721Received.selector;
    }

    //*********************************************************************//
    // -------------------------- public views --------------------------- //
    //*********************************************************************//

    /// @notice Check whether an address is a revnet's operator.
    /// @param revnetId The ID of the revnet to check.
    /// @param addr The address to check.
    /// @return flag A flag indicating whether the address holds the revnet's operator permissions.
    function isOperatorOf(uint256 revnetId, address addr) public view override returns (bool) {
        return PERMISSIONS.hasPermissions({
            operator: addr,
            account: address(this),
            projectId: revnetId,
            permissionIds: _operatorPermissionIndexesOf(revnetId),
            includeRoot: false,
            includeWildcardProjectId: false
        });
    }

    /// @notice Indicates if this contract adheres to the specified interface.
    /// @dev See `IERC165.supportsInterface`.
    /// @param interfaceId The interface ID to check.
    /// @return flag A flag indicating whether the interface is supported.
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool flag) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IJBRulesetDataHook).interfaceId
            || interfaceId == type(IJBCashOutHook).interfaceId
            || interfaceId == type(IJBPeerChainAdjustedAccounts).interfaceId;
    }

    //*********************************************************************//
    // -------------------------- internal views ------------------------- //
    //*********************************************************************//

    /// @notice A flag indicating whether an address is a revnet's sucker.
    /// @param revnetId The ID of the revnet to check.
    /// @param addr The address to check.
    /// @return isSucker A flag indicating whether the address is one of the revnet's suckers.
    function _isSuckerOf(uint256 revnetId, address addr) internal view returns (bool) {
        return SUCKER_REGISTRY.isSuckerOf({projectId: revnetId, addr: addr});
    }

    /// @notice The default + custom operator permissions that should be held by a revnet's operator.
    /// @param revnetId The ID of the revnet to look up.
    /// @return allOperatorPermissions The merged permission ID list.
    function _operatorPermissionIndexesOf(uint256 revnetId)
        internal
        view
        returns (uint256[] memory allOperatorPermissions)
    {
        uint256[] memory customOperatorPermissionIndexes = _extraOperatorPermissions[revnetId];

        allOperatorPermissions = new uint256[](9 + customOperatorPermissionIndexes.length);
        allOperatorPermissions[0] = JBPermissionIds.SET_SPLIT_GROUPS;
        allOperatorPermissions[1] = JBPermissionIds.SET_BUYBACK_POOL;
        allOperatorPermissions[2] = JBPermissionIds.SET_BUYBACK_TWAP;
        allOperatorPermissions[3] = JBPermissionIds.SET_PROJECT_URI;
        allOperatorPermissions[4] = JBPermissionIds.SUCKER_SAFETY;
        allOperatorPermissions[5] = JBPermissionIds.SET_BUYBACK_HOOK;
        allOperatorPermissions[6] = JBPermissionIds.SET_ROUTER_TERMINAL;
        allOperatorPermissions[7] = JBPermissionIds.SET_TOKEN_METADATA;
        allOperatorPermissions[8] = JBPermissionIds.SIGN_FOR_ERC20;

        for (uint256 i; i < customOperatorPermissionIndexes.length;) {
            allOperatorPermissions[9 + i] = customOperatorPermissionIndexes[i];
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Reverts if `operator` is not the revnet's current operator.
    /// @param revnetId The ID of the revnet to check.
    /// @param operator The address to check.
    function _checkIfIsOperatorOf(uint256 revnetId, address operator) internal view {
        if (!isOperatorOf({revnetId: revnetId, addr: operator})) {
            revert REVOwner_UnauthorizedOperator({revnetId: revnetId, caller: operator});
        }
    }

    /// @notice Total outstanding local loan debt and collateral for a revnet.
    /// @dev This is included in cash-out and peer-snapshot math because borrowed funds are still owed to the revnet
    /// and collateral can re-enter supply when the loan is repaid.
    /// @param revnetId The ID of the revnet to check.
    /// @param decimals The decimals to use for the resulting fixed point debt value.
    /// @param currency The currency to denominate the resulting debt value in.
    /// @return borrowedAmount The local outstanding loan debt converted into `currency`.
    /// @return collateralCount The local burned loan collateral count.
    function _localLoanStateOf(
        uint256 revnetId,
        uint256 decimals,
        uint256 currency
    )
        internal
        view
        returns (uint256 borrowedAmount, uint256 collateralCount)
    {
        IREVLoans loans = LOANS;
        if (address(loans) == address(0) || address(loans).code.length == 0) return (0, 0);

        collateralCount = loans.totalCollateralOf(revnetId);

        address[] memory sources = loans.loanSourceTokensOf(revnetId);
        if (sources.length == 0) return (0, collateralCount);

        IJBTerminal multiTerminal = deployer.MULTI_TERMINAL();
        // Loan sources are tokens whose accounting contexts live on the canonical multi terminal.
        for (uint256 i; i < sources.length; i++) {
            address sourceToken = sources[i];
            // Each configured source must be queried live so cash-out math includes current outstanding debt.
            uint256 tokensLoaned = loans.totalBorrowedFrom({revnetId: revnetId, token: sourceToken});
            if (tokensLoaned == 0) continue;

            JBAccountingContext memory sourceContext =
                multiTerminal.accountingContextForTokenOf({projectId: revnetId, token: sourceToken});
            if (sourceContext.token != sourceToken) {
                revert REVOwner_InvalidLoanSourceToken({revnetId: revnetId, token: sourceToken});
            }

            // Normalize each source from its native token decimals into the caller's requested decimals.
            uint256 normalizedTokens;
            if (sourceContext.decimals > decimals) {
                normalizedTokens = tokensLoaned / (10 ** (sourceContext.decimals - decimals));
            } else if (sourceContext.decimals < decimals) {
                normalizedTokens = tokensLoaned * (10 ** (decimals - sourceContext.decimals));
            } else {
                normalizedTokens = tokensLoaned;
            }

            if (sourceContext.currency == currency) {
                borrowedAmount += normalizedTokens;
            } else {
                // Convert source-token debt into the requested currency using the loans contract's shared prices.
                uint256 pricePerUnit = loans.PRICES()
                    .pricePerUnitOf({
                    projectId: revnetId,
                    pricingCurrency: sourceContext.currency,
                    unitCurrency: currency,
                    decimals: decimals
                });
                // A zero denominator would either panic or hide outstanding debt. Revert so cash-out math does not
                // undercount local loans.
                if (pricePerUnit == 0) {
                    revert REVOwner_ZeroPrice({
                        revnetId: revnetId, pricingCurrency: sourceContext.currency, unitCurrency: currency
                    });
                }

                borrowedAmount += mulDiv({x: normalizedTokens, y: 10 ** decimals, denominator: pricePerUnit});
            }
        }
    }

    //*********************************************************************//
    // --------------------- internal transactions ----------------------- //
    //*********************************************************************//

    /// @notice Clears any token allowance granted by `_beforeTransferTo`.
    /// @param to The address that was approved by `_beforeTransferTo`.
    /// @param token The token whose allowance should be revoked.
    function _afterTransferTo(address to, address token) internal {
        if (token == JBConstants.NATIVE_TOKEN) return;
        IERC20(token).forceApprove({spender: to, value: 0});
    }

    /// @notice Logic to trigger before transferring tokens from this contract.
    /// @param to The address to transfer to.
    /// @param token The token to transfer.
    /// @param amount The number of tokens to transfer, as a fixed point number with the same number of decimals
    /// as the token specifies.
    /// @return payValue The value to attach to the transaction.
    function _beforeTransferTo(address to, address token, uint256 amount) internal returns (uint256) {
        // If the token is the native token, no allowance needed.
        if (token == JBConstants.NATIVE_TOKEN) return amount;
        IERC20(token).safeIncreaseAllowance({spender: to, value: amount});
        return 0;
    }

    /// @notice Grant the revnet's default operator permission set to `operator`.
    /// @param revnetId The ID of the revnet to scope the permissions for.
    /// @param operator The address to grant operator permissions to.
    function _setOperatorOf(uint256 revnetId, address operator) internal {
        uint256[] memory permissionIndexes = _operatorPermissionIndexesOf(revnetId);
        uint8[] memory permissionIds = new uint8[](permissionIndexes.length);

        for (uint256 i; i < permissionIndexes.length;) {
            // forge-lint: disable-next-line(unsafe-typecast)
            permissionIds[i] = uint8(permissionIndexes[i]);
            unchecked {
                ++i;
            }
        }

        _setPermissionsFor({
            account: address(this), operator: operator, revnetId: revnetId, permissionIds: permissionIds
        });
    }

    /// @notice Set the permissions on the JB permissions registry, scoped to this revnet.
    /// @param account The account whose permission slot is being updated. Always `address(this)`.
    /// @param operator The address whose permissions are being set.
    /// @param revnetId The ID of the revnet to scope the permissions for.
    /// @param permissionIds The permission IDs to grant (empty array revokes).
    function _setPermissionsFor(
        address account,
        address operator,
        uint256 revnetId,
        uint8[] memory permissionIds
    )
        internal
    {
        JBPermissionsData memory permissionData =
        // forge-lint: disable-next-line(unsafe-typecast)
        JBPermissionsData({operator: operator, projectId: uint64(revnetId), permissionIds: permissionIds});

        PERMISSIONS.setPermissionsFor({account: account, permissionsData: permissionData});
    }
}
