// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Monotonic compute shutdown, with a return-only recovery loop for unsolicited sVVV donations.
enum TelligenceVaultState {
    Active,
    Notice,
    DiemCooldown,
    VVVCooldown,
    Closed
}
