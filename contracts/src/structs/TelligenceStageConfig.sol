// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice The economic fields exposed when launching a compute Revnet.
/// @dev Routing, automatic issuance and bridging are fixed by the factory for every stage. Compute must be positive
/// and compute plus creator allocation must be below 100%. Their ratio cannot change between stages.
/// @custom:member startsAtOrAfter Earliest stage start; stages must be strictly ordered.
/// @custom:member splitPercent Compute allocation of all new token issuance, out of 10,000.
/// @custom:member initialIssuance Tokens issued per VVV, scaled by 1e18; zero inherits after the first stage.
/// @custom:member issuanceCutFrequency Seconds between issuance reductions.
/// @custom:member issuanceCutPercent Reduction per interval, out of 1,000,000,000.
/// @custom:member cashOutTaxRate Treasury retention on holder cashouts, out of 10,000.
/// @custom:member operatorSplitPercent Creator allocation of all new token issuance, out of 10,000.
struct TelligenceStageConfig {
    uint48 startsAtOrAfter;
    uint16 splitPercent;
    uint112 initialIssuance;
    uint32 issuanceCutFrequency;
    uint32 issuanceCutPercent;
    uint16 cashOutTaxRate;
    uint16 operatorSplitPercent;
}
