// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {JBSuckerDeployerConfig} from "@bananapus/suckers-v6/src/structs/JBSuckerDeployerConfig.sol";

/// @custom:member deployerConfigurations The sucker deployers and token bridge mappings to configure.
/// @custom:member salt Extra caller-provided entropy mixed with the revnet config hash and deployer caller.
struct REVSuckerDeploymentConfig {
    JBSuckerDeployerConfig[] deployerConfigurations;
    bytes32 salt;
}
