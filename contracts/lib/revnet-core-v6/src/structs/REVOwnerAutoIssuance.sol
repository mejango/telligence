// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice A flattened auto-issuance allocation passed from `REVDeployer` to `REVOwner` during revnet initialization.
/// Unlike `REVAutoIssuance`, which is grouped by stage at the deployer-facing config layer, this is the per-record
/// shape that `REVOwner` actually stores: stage ID is already resolved and chain filtering already applied.
/// @custom:member stageId The ruleset stage at which the allocation unlocks.
/// @custom:member beneficiary The address that will receive the auto-issued tokens.
/// @custom:member count The number of project tokens to issue.
struct REVOwnerAutoIssuance {
    uint256 stageId;
    address beneficiary;
    uint256 count;
}
