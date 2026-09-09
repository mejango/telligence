// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice A per-stage token mint that happens without any payment — think of it as a scheduled premint. Each auto
/// issuance specifies a chain, beneficiary, and token count. Can be claimed once per stage via `autoIssueFor`.
/// @custom:member chainId The chain ID where this auto-issuance should be honored (only mints on the matching chain).
/// @custom:member count The number of tokens to mint for the beneficiary.
/// @custom:member beneficiary The address that will receive the minted tokens.
struct REVAutoIssuance {
    uint32 chainId;
    uint104 count;
    address beneficiary;
}
