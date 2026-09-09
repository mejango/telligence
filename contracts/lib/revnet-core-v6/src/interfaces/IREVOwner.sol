// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IJB721TiersHook} from "@bananapus/721-hook-v6/src/interfaces/IJB721TiersHook.sol";
import {IJBBuybackHookRegistry} from "@bananapus/buyback-hook-v6/src/interfaces/IJBBuybackHookRegistry.sol";
import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBPermissions} from "@bananapus/core-v6/src/interfaces/IJBPermissions.sol";
import {IJBProjects} from "@bananapus/core-v6/src/interfaces/IJBProjects.sol";
import {IJBSuckerRegistry} from "@bananapus/suckers-v6/src/interfaces/IJBSuckerRegistry.sol";

import {REVOwnerRevnetInit} from "../structs/REVOwnerRevnetInit.sol";
import {IREVDeployer} from "./IREVDeployer.sol";
import {IREVLoans} from "./IREVLoans.sol";

/// @notice The runtime hook for every revnet and the on-chain owner of the underlying Juicebox project NFTs.
interface IREVOwner {
    /// @notice Emitted when tokens are auto-issued for a beneficiary during a stage.
    /// @param revnetId The ID of the revnet.
    /// @param stageId The ID of the stage.
    /// @param beneficiary The address receiving the auto-issued tokens.
    /// @param count The number of tokens auto-issued.
    /// @param caller The address that triggered the auto-issuance.
    event AutoIssue(
        uint256 indexed revnetId, uint256 indexed stageId, address indexed beneficiary, uint256 count, address caller
    );

    /// @notice Emitted when held tokens are burned from this contract.
    /// @param revnetId The ID of the revnet whose tokens were burned.
    /// @param count The number of tokens burned.
    /// @param caller The address that triggered the burn.
    event BurnHeldTokens(uint256 indexed revnetId, uint256 count, address caller);

    /// @notice Emitted once when a revnet's initial runtime state is bound on this contract.
    /// @param revnetId The ID of the revnet that was initialized.
    /// @param caller The address that initialized the revnet (always the canonical deployer).
    event InitializeRevnet(uint256 indexed revnetId, address caller);

    /// @notice Emitted when the operator of a revnet is replaced.
    /// @param revnetId The ID of the revnet.
    /// @param newOperator The address of the new operator.
    /// @param caller The address that replaced the operator.
    event ReplaceOperator(uint256 indexed revnetId, address indexed newOperator, address caller);

    /// @notice The buyback hook used as a data hook to route payments through buyback pools.
    /// @return The buyback hook registry instance.
    function BUYBACK_HOOK() external view returns (IJBBuybackHookRegistry);

    /// @notice The controller used by every revnet to manage its underlying Juicebox project.
    /// @return The controller instance.
    function CONTROLLER() external view returns (IJBController);

    /// @notice The directory of terminals and controllers for Juicebox projects.
    /// @return The directory instance.
    function DIRECTORY() external view returns (IJBDirectory);

    /// @notice The Juicebox project ID of the revnet that receives cash-out fees.
    /// @return The fee revnet's Juicebox project ID.
    function FEE_REVNET_ID() external view returns (uint256);

    /// @notice The loan contract used by every revnet.
    /// @return The loan contract instance.
    function LOANS() external view returns (IREVLoans);

    /// @notice The permissions registry used to grant operator authority over revnets.
    /// @return The permissions instance.
    function PERMISSIONS() external view returns (IJBPermissions);

    /// @notice The Juicebox project NFT contract.
    /// @return The projects instance.
    function PROJECTS() external view returns (IJBProjects);

    /// @notice The registry that deploys and tracks suckers for revnets.
    /// @return The sucker registry instance.
    function SUCKER_REGISTRY() external view returns (IJBSuckerRegistry);

    /// @notice The amount of project tokens to auto-issue at a given stage to a given beneficiary.
    /// @param revnetId The ID of the revnet.
    /// @param stageId The ID of the stage.
    /// @param beneficiary The address that will receive the auto-issued tokens.
    /// @return The number of tokens available to auto-issue.
    function amountToAutoIssue(uint256 revnetId, uint256 stageId, address beneficiary) external view returns (uint256);

    /// @notice The timestamp at which cash-outs become available for a specific revnet's participants.
    /// @param revnetId The ID of the revnet.
    /// @return The cash-out delay timestamp (0 if no delay applies).
    function cashOutDelayOf(uint256 revnetId) external view returns (uint256);

    /// @notice The canonical deployer that manages runtime hook state.
    /// @return The revnet deployer instance.
    function deployer() external view returns (IREVDeployer);

    /// @notice Whether an address holds a revnet's operator permissions.
    /// @param revnetId The ID of the revnet.
    /// @param addr The address to check.
    /// @return A flag indicating whether the address is the revnet's operator.
    function isOperatorOf(uint256 revnetId, address addr) external view returns (bool);

    /// @notice The tiered ERC-721 hook deployed for a revnet (if any).
    /// @param revnetId The ID of the revnet.
    /// @return The tiered ERC-721 hook instance.
    function tiered721HookOf(uint256 revnetId) external view returns (IJB721TiersHook);

    /// @notice Auto-mint a revnet's tokens from a stage for a beneficiary.
    /// @dev Permissionless once the stage has started.
    /// @param revnetId The ID of the revnet to auto-mint tokens for.
    /// @param stageId The ID of the ruleset stage to auto-mint tokens from.
    /// @param beneficiary The address to send auto-minted tokens to.
    function autoIssueFor(uint256 revnetId, uint256 stageId, address beneficiary) external;

    /// @notice Burn any of a revnet's project tokens that have accumulated on this contract.
    /// @param revnetId The ID of the revnet to burn tokens for.
    function burnHeldTokensOf(uint256 revnetId) external;

    /// @notice Bind every piece of revnet-scoped state managed by this contract in a single deployer call. Stores
    /// the cash-out delay, the tiered ERC-721 hook, auto-issuance allocations, extra operator permissions, the
    /// initial operator, and any integration-specific permission grants.
    /// @dev Only callable by the canonical deployer during a revnet's initial configuration.
    /// @param revnetId The ID of the revnet being initialized.
    /// @param init The full initialization payload.
    function initializeRevnet(uint256 revnetId, REVOwnerRevnetInit calldata init) external;

    /// @notice Bind the canonical deployer address exactly once.
    /// @param newDeployer The canonical deployer that will manage runtime hook state.
    function setDeployer(IREVDeployer newDeployer) external;

    /// @notice Change a revnet's operator. Only the current operator can call this.
    /// @param revnetId The ID of the revnet to change the operator for.
    /// @param newOperator The new operator's address. Use `address(0)` to relinquish operator powers.
    function setOperatorOf(uint256 revnetId, address newOperator) external;
}
