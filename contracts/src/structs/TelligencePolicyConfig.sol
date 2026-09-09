// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Immutable limits disclosed before a compute endowment accepts funding.
/// @custom:member conversionCadence Minimum seconds between production cashouts.
/// @custom:member minBatchTokens Minimum economical production-token batch, in 18-decimal units.
/// @custom:member maxBatchTokens Maximum production-token batch, in 18-decimal units.
/// @custom:member minVVVPerProjectToken Minimum received VVV per production token, scaled by 1e18.
/// @custom:member minDiemPerVVV Minimum minted DIEM per VVV allocated, scaled by 1e18.
/// @custom:member maxPrincipal Lifetime VVV allocation ceiling, in 18-decimal units.
struct TelligencePolicyConfig {
    uint48 conversionCadence;
    uint128 minBatchTokens;
    uint128 maxBatchTokens;
    uint128 minVVVPerProjectToken;
    uint128 minDiemPerVVV;
    uint128 maxPrincipal;
}
