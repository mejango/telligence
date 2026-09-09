// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @custom:member noNewTiersWithReserves Whether to forbid new tiers with non-zero reserve frequency.
/// @custom:member noNewTiersWithVotes Whether to forbid new tiers with voting units.
/// @custom:member noNewTiersWithOwnerMinting Whether to forbid new tiers with owner minting.
/// @custom:member preventOverspending Whether to prevent payments exceeding the price of minted NFTs.
struct REV721TiersHookFlags {
    bool noNewTiersWithReserves;
    bool noNewTiersWithVotes;
    bool noNewTiersWithOwnerMinting;
    bool preventOverspending;
}
