// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IJB721TokenUriResolver} from "@bananapus/721-hook-v6/src/interfaces/IJB721TokenUriResolver.sol";
import {JB721InitTiersConfig} from "@bananapus/721-hook-v6/src/structs/JB721InitTiersConfig.sol";

import {REV721TiersHookFlags} from "./REV721TiersHookFlags.sol";

/// @custom:member name The name of the NFT collection.
/// @custom:member symbol The symbol of the NFT collection.
/// @custom:member baseUri The base URI for the NFT collection.
/// @custom:member tokenUriResolver The token URI resolver for the NFT collection.
/// @custom:member contractUri The contract URI for the NFT collection.
/// @custom:member tiersConfig The tier configuration for the NFT collection.
/// @custom:member flags A set of flags that configure the 721 hook. Omits `issueTokensForSplits` since revnets
/// always force it to `false`.
struct REVBaseline721HookConfig {
    string name;
    string symbol;
    string baseUri;
    IJB721TokenUriResolver tokenUriResolver;
    string contractUri;
    JB721InitTiersConfig tiersConfig;
    REV721TiersHookFlags flags;
}
