// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TelligenceVeniceAuth} from "../../src/abstract/TelligenceVeniceAuth.sol";

/// @notice Exposes the permanent disable transition for isolated authentication tests.
contract TelligenceVeniceAuthHarness is TelligenceVeniceAuth {
    /// @notice Whether the harness lifecycle currently allows inference.
    bool internal _lifecycleAllowsAuthentication = true;
    /// @notice Initializes the policy and inference signer under test.
    /// @param policy The test policy authority.
    /// @param signer The test inference signer.
    constructor(address policy, address signer) TelligenceVeniceAuth(policy, signer) {}

    /// @notice Initializes fixture storage after placing harness bytecode at a deterministic vector address.
    /// @param signer The public test signer.
    function initializeFixture(address signer) external {
        inferenceSigner = signer;
        signerGeneration = 1;
        authenticationEnabled = true;
        _lifecycleAllowsAuthentication = true;
    }

    /// @notice Sets a test lifecycle cutoff independently of signer policy.
    /// @param allowed Whether the simulated vault lifecycle permits authentication.
    function setAuthenticationAllowed(bool allowed) external {
        _lifecycleAllowsAuthentication = allowed;
    }

    /// @notice Applies the simulated vault lifecycle cutoff.
    /// @return allowed Whether inference is permitted by the simulated vault lifecycle.
    function _authenticationAllowed() internal view override returns (bool allowed) {
        return _lifecycleAllowsAuthentication;
    }

    /// @notice Triggers the internal shutdown used by the compute vault's winddown lifecycle.
    function disablePermanently() external {
        _disableAuthentication();
    }
}
