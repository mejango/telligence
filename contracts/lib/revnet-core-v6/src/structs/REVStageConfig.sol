// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {JBSplit} from "@bananapus/core-v6/src/structs/JBSplit.sol";

import {REVAutoIssuance} from "./REVAutoIssuance.sol";

/// @notice A stage in a revnet's lifecycle. Each stage defines the token issuance rate, how quickly it decays, what
/// percentage goes to splits, and the cash-out tax rate. Stages are processed in order — each one activates at or
/// after its `startsAtOrAfter` timestamp.
/// @custom:member startsAtOrAfter The earliest timestamp this stage can begin. Must be strictly increasing across
/// stages.
/// @custom:member autoIssuances Tokens to mint without payment during this stage (per-chain, per-beneficiary).
/// @custom:member splitPercent The percentage of newly issued tokens routed to splits, out of 10,000.
/// @custom:member splits The split recipients for this stage's production allocation.
/// @custom:member initialIssuance Tokens per unit of base currency at stage start (18-decimal fixed point).
/// @custom:member issuanceCutFrequency Seconds between each issuance reduction. Should be >= 24 hours.
/// @custom:member issuanceCutPercent How much issuance decreases each period, out of
/// `JBConstants.MAX_WEIGHT_CUT_PERCENT`. 0 = no decay.
/// @custom:member cashOutTaxRate The tax on cash outs, out of `JBConstants.MAX_CASH_OUT_TAX_RATE`. 0 = no tax (full
/// reclaim). Higher = more tax retained by the treasury.
/// @custom:member extraMetadata Additional metadata bits passed to hooks for stage-specific behavior.
struct REVStageConfig {
    uint48 startsAtOrAfter;
    REVAutoIssuance[] autoIssuances;
    uint16 splitPercent;
    JBSplit[] splits;
    uint112 initialIssuance;
    uint32 issuanceCutFrequency;
    uint32 issuanceCutPercent;
    uint16 cashOutTaxRate;
    uint16 extraMetadata;
}
