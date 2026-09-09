// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {REVBaseline721HookConfig} from "./REVBaseline721HookConfig.sol";

/// @custom:member baseline721HookConfiguration The base tiered ERC-721 hook config.
/// @custom:member salt The salt to derive the collection's address from.
/// @custom:member preventOperatorAdjustingTiers Whether to prevent the operator from adding and removing tiers.
/// @custom:member preventOperatorUpdatingMetadata Whether to prevent the operator from updating the 721's metadata.
/// @custom:member preventOperatorMinting Whether to prevent the operator from minting 721s from tiers that allow it.
/// @custom:member preventOperatorIncreasingDiscountPercent Whether to prevent the operator from increasing a tier's
/// discount.
struct REVDeploy721TiersHookConfig {
    REVBaseline721HookConfig baseline721HookConfiguration;
    bytes32 salt;
    bool preventOperatorAdjustingTiers;
    bool preventOperatorUpdatingMetadata;
    bool preventOperatorMinting;
    bool preventOperatorIncreasingDiscountPercent;
}
