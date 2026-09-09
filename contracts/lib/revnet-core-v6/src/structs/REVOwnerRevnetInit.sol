// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IJB721TiersHook} from "@bananapus/721-hook-v6/src/interfaces/IJB721TiersHook.sol";

import {REVOwnerAutoIssuance} from "./REVOwnerAutoIssuance.sol";
import {REVOwnerExtraGrant} from "./REVOwnerExtraGrant.sol";

/// @notice The full per-revnet initialization payload that `REVDeployer` sends to `REVOwner` in a single
/// `initializeRevnet` call. Bundles every runtime-state write required to bring a fresh revnet online so the deployer
/// crosses the trust boundary into `REVOwner` exactly once.
/// @custom:member cashOutDelay The timestamp after which cash outs are allowed. Use `0` when no delay applies.
/// @custom:member tiered721Hook The tiered ERC-721 hook deployed for the revnet. Use `address(0)` when no hook
/// applies.
/// @custom:member operator The initial operator address. Use `address(0)` to relinquish operator powers up front.
/// @custom:member extraOperatorPermissionIds Permission IDs to merge into the revnet's default operator permission
/// set before the operator is bootstrapped.
/// @custom:member autoIssuances Auto-issuance allocations recorded on the revnet for this chain.
/// @custom:member extraGrants Per-revnet permission grants applied after the operator is bootstrapped (e.g., the
/// Croptop publisher's `ADJUST_721_TIERS` grant).
struct REVOwnerRevnetInit {
    uint256 cashOutDelay;
    IJB721TiersHook tiered721Hook;
    address operator;
    uint256[] extraOperatorPermissionIds;
    REVOwnerAutoIssuance[] autoIssuances;
    REVOwnerExtraGrant[] extraGrants;
}
