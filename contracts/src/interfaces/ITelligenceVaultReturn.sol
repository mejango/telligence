// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice The sole destination for a vault's realized VVV; implementations pull the exact approved amount.
interface ITelligenceVaultReturn {
    function returnToRevnet(uint256 amount) external;
}
