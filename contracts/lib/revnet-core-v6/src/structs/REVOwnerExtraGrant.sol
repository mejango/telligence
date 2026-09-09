// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice A single non-operator permission grant scoped to a revnet, applied during `REVOwner.initializeRevnet`. Used
/// for integrations that need to act on a revnet's behalf without holding full operator authority (e.g., the Croptop
/// publisher).
/// @custom:member operator The address being granted the permission.
/// @custom:member permissionId The permission ID to grant.
struct REVOwnerExtraGrant {
    address operator;
    uint8 permissionId;
}
