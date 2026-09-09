// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice The policy-controlled, inference-only authentication surface of a compute vault.
interface ITelligenceVeniceAuth is IERC1271 {
    /// @notice Emitted when authentication is enabled, disabled, or permanently shut down.
    /// @param enabled Whether authentication can succeed.
    /// @param permanentlyDisabled Whether policy can ever enable authentication again.
    /// @param generation The signer generation after the change.
    event SetAuthenticationEnabled(bool enabled, bool permanentlyDisabled, uint64 generation);

    /// @notice Emitted when policy replaces the inference signer and invalidates outstanding signatures.
    /// @param signer The inference-only signer.
    /// @param generation The signer generation after the change.
    event SetInferenceSigner(address indexed signer, uint64 generation);

    /// @notice The immutable policy authorized to administer authentication.
    /// @return policy The policy contract.
    function AUTH_POLICY() external view returns (address policy);

    /// @notice The maximum signed challenge lifetime in milliseconds.
    /// @return duration The maximum lifetime.
    function MAX_AUTH_LIFETIME_MS() external view returns (uint256 duration);

    /// @notice Whether inference authentication is enabled.
    /// @return enabled Whether authentication can succeed.
    function authenticationEnabled() external view returns (bool enabled);

    /// @notice Whether permanent shutdown forbids re-enabling authentication.
    /// @return disabled Whether authentication is permanently disabled.
    function authenticationPermanentlyDisabled() external view returns (bool disabled);

    /// @notice The currently authorized inference-only signer.
    /// @return signer The signer, or zero before configuration.
    function inferenceSigner() external view returns (address signer);

    /// @notice The generation bound into every inference signature.
    /// @return generation The current generation.
    function signerGeneration() external view returns (uint64 generation);

    /// @notice Enables or disables authentication and invalidates outstanding signatures.
    /// @param enabled Whether inference authentication should be enabled.
    function setAuthenticationEnabled(bool enabled) external;

    /// @notice Replaces the inference signer and invalidates outstanding signatures.
    /// @param signer The nonzero inference-only signer.
    function setInferenceSigner(address signer) external;
}
