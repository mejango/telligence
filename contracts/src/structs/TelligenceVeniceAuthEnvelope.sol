// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice The bounded authentication fields reconstructed into a canonical Venice SIWE message.
/// @custom:member generation The current inference signer generation, invalidated on every policy change.
/// @custom:member resource The permitted Venice resource: chat, responses, embeddings, or the vault's balance.
/// @custom:member nonce The provider's 8 to 64 character alphanumeric challenge nonce.
/// @custom:member issuedAt The provider's exact UTC timestamp with millisecond precision.
/// @custom:member expirationTime The provider's exact UTC expiry with millisecond precision.
/// @custom:member signature The 65 byte EIP-712 signature of the inference signer.
struct TelligenceVeniceAuthEnvelope {
    uint64 generation;
    uint8 resource;
    string nonce;
    string issuedAt;
    string expirationTime;
    bytes signature;
}
