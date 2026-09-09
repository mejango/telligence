// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Identity and metadata for a revnet deployment.
/// @custom:member name The name of the ERC-20 token created for the revnet.
/// @custom:member ticker The ticker symbol of the ERC-20 token created for the revnet.
/// @custom:member uri The metadata URI containing the revnet's off-chain info (logo, description, links).
/// @custom:member salt A deployment salt — revnets deployed across chains by the same address with the same salt get
/// deterministic matching addresses.
struct REVDescription {
    string name;
    string ticker;
    string uri;
    bytes32 salt;
}
