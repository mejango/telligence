// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {REVDescription} from "./REVDescription.sol";
import {REVStageConfig} from "./REVStageConfig.sol";

/// @notice Top-level configuration for deploying a revnet. Defines the revnet's identity, base currency for issuance
/// pricing, the operator (who receives production splits and can reassign that role), and the ordered list of
/// stages that govern the revnet's lifecycle.
/// @custom:member description The revnet's name, ticker, metadata URI, and deployment salt.
/// @custom:member baseCurrency The currency that issuance pricing is denominated in (e.g. ETH or USD).
/// @custom:member operator The address that receives production splits and can reassign the operator role.
/// Only the current operator can replace itself after deployment.
/// @custom:member scopeCashOutsToLocalBalances If true, cash-out calculations use only the local terminal's surplus.
/// When false, the bonding curve considers surplus from every terminal across all chains.
/// @custom:member stageConfigurations The ordered stages that define how the revnet's tokenomics evolve over time.
struct REVConfig {
    REVDescription description;
    uint32 baseCurrency;
    address operator;
    bool scopeCashOutsToLocalBalances;
    REVStageConfig[] stageConfigurations;
}
