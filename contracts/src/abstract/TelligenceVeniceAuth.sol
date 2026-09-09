// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {ITelligenceVeniceAuth} from "../interfaces/ITelligenceVeniceAuth.sol";
import {TelligenceDateTime} from "../libraries/TelligenceDateTime.sol";
import {TelligenceVeniceAuthEnvelope} from "../structs/TelligenceVeniceAuthEnvelope.sol";

/// @notice Validates narrowly scoped Venice authentication while keeping the hosted signer outside asset authority.
/// @dev Only canonical Venice SIWE messages on Base can validate. ERC-1271 is read-only and cannot meter inference,
/// consume nonces, or revoke provider sessions; the provider and gateway must enforce their own replay and access
/// rules.
abstract contract TelligenceVeniceAuth is ITelligenceVeniceAuth {
    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice Thrown when policy tries to restore authentication after permanent compute shutdown.
    error TelligenceVeniceAuth_AuthenticationPermanentlyDisabled();

    /// @notice Thrown when a zero policy would make authentication administration inaccessible.
    error TelligenceVeniceAuth_InvalidPolicy();

    /// @notice Thrown when enabling authentication or rotating requires a nonzero inference signer.
    error TelligenceVeniceAuth_InvalidSigner();

    /// @notice Thrown when the caller is not the immutable authentication policy.
    /// @param caller The unauthorized caller.
    error TelligenceVeniceAuth_Unauthorized(address caller);

    //*********************************************************************//
    // ------------------------- public constants ------------------------ //
    //*********************************************************************//

    /// @inheritdoc ITelligenceVeniceAuth
    uint256 public constant override MAX_AUTH_LIFETIME_MS = 300_000;

    //*********************************************************************//
    // ------------------------ private constants ------------------------ //
    //*********************************************************************//

    /// @notice The EIP-712 domain binds hosted signatures to this contract and Base.
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice The inner signature commits to the complete reconstructed SIWE hash and revocation generation.
    bytes32 private constant _AUTH_TYPEHASH = keccak256("VeniceAuthentication(bytes32 messageHash,uint64 generation)");

    /// @notice The greatest permitted difference between provider issue time and the Base block clock.
    uint256 private constant _MAX_FUTURE_SKEW_MS = 30_000;

    //*********************************************************************//
    // ---------------- public immutable stored properties --------------- //
    //*********************************************************************//

    /// @inheritdoc ITelligenceVeniceAuth
    address public immutable override AUTH_POLICY;

    //*********************************************************************//
    // ---------------------- public stored properties ------------------- //
    //*********************************************************************//

    /// @inheritdoc ITelligenceVeniceAuth
    bool public override authenticationEnabled;

    /// @inheritdoc ITelligenceVeniceAuth
    bool public override authenticationPermanentlyDisabled;

    /// @inheritdoc ITelligenceVeniceAuth
    address public override inferenceSigner;

    /// @inheritdoc ITelligenceVeniceAuth
    uint64 public override signerGeneration = 1;

    //*********************************************************************//
    // ---------------------------- constructor -------------------------- //
    //*********************************************************************//

    /// @notice Sets immutable policy authority and the optional initial inference signer.
    /// @param policy The nonzero policy contract which administers authentication.
    /// @param initialSigner The inference-only signer, or zero to start with authentication disabled.
    constructor(address policy, address initialSigner) {
        if (policy == address(0)) revert TelligenceVeniceAuth_InvalidPolicy();
        AUTH_POLICY = policy;
        inferenceSigner = initialSigner;
        authenticationEnabled = initialSigner != address(0);
    }

    //*********************************************************************//
    // ---------------------------- modifiers ---------------------------- //
    //*********************************************************************//

    /// @notice Restricts authentication changes to policy, independently of the hosted signer.
    modifier onlyAuthPolicy() {
        if (msg.sender != AUTH_POLICY) revert TelligenceVeniceAuth_Unauthorized(msg.sender);
        _;
    }

    //*********************************************************************//
    // ----------------------- external transactions --------------------- //
    //*********************************************************************//

    /// @inheritdoc ITelligenceVeniceAuth
    function setAuthenticationEnabled(bool enabled) external override onlyAuthPolicy {
        if (authenticationPermanentlyDisabled) revert TelligenceVeniceAuth_AuthenticationPermanentlyDisabled();
        if (enabled && inferenceSigner == address(0)) revert TelligenceVeniceAuth_InvalidSigner();

        // Invalidate issued envelopes even when enabling again with the same signer after an incident.
        signerGeneration++;
        authenticationEnabled = enabled;
        emit SetAuthenticationEnabled({enabled: enabled, permanentlyDisabled: false, generation: signerGeneration});
    }

    /// @inheritdoc ITelligenceVeniceAuth
    function setInferenceSigner(address signer) external override onlyAuthPolicy {
        if (authenticationPermanentlyDisabled) revert TelligenceVeniceAuth_AuthenticationPermanentlyDisabled();
        if (signer == address(0)) revert TelligenceVeniceAuth_InvalidSigner();

        // Rotation deliberately preserves the enable flag so key maintenance cannot override a pause.
        signerGeneration++;
        inferenceSigner = signer;
        emit SetInferenceSigner({signer: signer, generation: signerGeneration});
    }

    //*********************************************************************//
    // --------------------------- external views ------------------------ //
    //*********************************************************************//

    /// @notice Validates a canonical Venice SIWE challenge and its bounded inference-only signing envelope.
    /// @dev The wire format is `abi.encode(uint8(1), uint64 generation, uint8 resource, string nonce,
    /// string issuedAt, string expirationTime, bytes innerSignature)`. Resources 0 through 3 select chat completions,
    /// responses, embeddings, and the vault's x402 balance. Malformed envelopes return the invalid ERC-1271 value.
    /// @param hash The EIP-191 hash Venice asks the vault to verify.
    /// @param signature The versioned canonical ABI envelope containing the EIP-712 inner signature.
    /// @return magicValue The ERC-1271 magic value for valid authentication, or `0xffffffff` otherwise.
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    )
        external
        view
        override
        returns (bytes4 magicValue)
    {
        if (
            !authenticationEnabled || authenticationPermanentlyDisabled || block.chainid != 8453
                || !_authenticationAllowed()
        ) {
            return 0xffffffff;
        }
        (bool decoded, TelligenceVeniceAuthEnvelope memory envelope) = _decodeEnvelope(signature);
        if (!decoded || envelope.generation != signerGeneration) return 0xffffffff;
        if (!_validChallenge(envelope)) return 0xffffffff;

        // Financial digests and messages for other wallets fail before the signer is consulted.
        if (MessageHashUtils.toEthSignedMessageHash(bytes(_message(envelope))) != hash) return 0xffffffff;
        bytes32 domain = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH, keccak256("TelligenceVeniceAuth"), keccak256("1"), uint256(8453), address(this)
            )
        );
        bytes32 payload = keccak256(abi.encode(_AUTH_TYPEHASH, hash, envelope.generation));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover({
            hash: MessageHashUtils.toTypedDataHash({domainSeparator: domain, structHash: payload}),
            signature: envelope.signature
        });
        if (err != ECDSA.RecoverError.NoError || signer == address(0) || signer != inferenceSigner) return 0xffffffff;
        return 0x1626ba7e;
    }

    //*********************************************************************//
    // ---------------------- internal transactions ---------------------- //
    //*********************************************************************//

    /// @notice Permanently stops authentication when the owning vault begins shutdown.
    /// @dev Policy cannot restore a signer after backing starts leaving its active compute position.
    function _disableAuthentication() internal {
        signerGeneration++;
        authenticationEnabled = false;
        authenticationPermanentlyDisabled = true;
        emit SetAuthenticationEnabled({enabled: false, permanentlyDisabled: true, generation: signerGeneration});
    }

    //*********************************************************************//
    // ------------------------- internal views -------------------------- //
    //*********************************************************************//

    /// @notice Allows the owning vault to stop authentication automatically when its lifecycle deadline arrives.
    /// @dev Derived vaults can enforce time-based cutoffs without waiting for a keeper transaction.
    /// @return allowed Whether the owning vault's current state permits authentication.
    function _authenticationAllowed() internal view virtual returns (bool allowed) {
        return true;
    }

    //*********************************************************************//
    // ------------------------ private helpers -------------------------- //
    //*********************************************************************//

    /// @notice Reads only bounded, canonical ABI offsets without letting malformed dynamic data revert decoding.
    /// @param data The complete signature envelope.
    /// @return valid Whether version, fields, dynamic offsets, lengths, and padding are canonical.
    /// @return envelope The decoded fields when valid.
    function _decodeEnvelope(bytes calldata data)
        private
        pure
        returns (bool valid, TelligenceVeniceAuthEnvelope memory envelope)
    {
        // Exact total lengths bound every later read before dynamic lengths or offsets can influence allocation.
        if (data.length != 544 && data.length != 576) return (false, envelope);
        if (_word({data: data, offset: 0}) != 1 || _word({data: data, offset: 32}) > type(uint64).max) {
            return (false, envelope);
        }
        if (_word({data: data, offset: 64}) > 3 || _word({data: data, offset: 96}) != 224) return (false, envelope);
        uint256 nonceLength = _word({data: data, offset: 224});
        if (nonceLength < 8 || nonceLength > 64) return (false, envelope);
        uint256 issuedOffset = nonceLength <= 32 ? 288 : 320;
        uint256 expirationOffset = issuedOffset + 64;
        uint256 signatureOffset = expirationOffset + 64;
        if (
            _word({data: data, offset: 128}) != issuedOffset || _word({data: data, offset: 160}) != expirationOffset
                || _word({data: data, offset: 192}) != signatureOffset
                || _word({data: data, offset: issuedOffset}) != 24
                || _word({data: data, offset: expirationOffset}) != 24
                || _word({data: data, offset: signatureOffset}) != 65 || data.length != signatureOffset + 128
        ) return (false, envelope);

        // Padding must remain zero so there is a single accepted byte encoding for the same challenge fields.
        if (
            !_zeroPadding({data: data, start: 256 + nonceLength, end: issuedOffset})
                || !_zeroPadding({data: data, start: issuedOffset + 56, end: expirationOffset})
                || !_zeroPadding({data: data, start: expirationOffset + 56, end: signatureOffset})
                || !_zeroPadding({data: data, start: signatureOffset + 97, end: data.length})
        ) return (false, envelope);
        envelope = TelligenceVeniceAuthEnvelope({
            generation: uint64(_word({data: data, offset: 32})),
            resource: uint8(_word({data: data, offset: 64})),
            nonce: string(data[256:256 + nonceLength]),
            issuedAt: string(data[issuedOffset + 32:issuedOffset + 56]),
            expirationTime: string(data[expirationOffset + 32:expirationOffset + 56]),
            signature: data[signatureOffset + 32:signatureOffset + 97]
        });
        return (true, envelope);
    }

    /// @notice Reconstructs the provider message without accepting arbitrary statements, fields, or destinations.
    /// @param envelope The validated envelope fields.
    /// @return message The canonical EIP-4361 message.
    function _message(TelligenceVeniceAuthEnvelope memory envelope) private view returns (string memory message) {
        string memory account = Strings.toChecksumHexString(address(this));
        string memory uri = envelope.resource == 0
            ? "https://api.venice.ai/api/v1/chat/completions"
            : envelope.resource == 1
                ? "https://api.venice.ai/api/v1/responses"
                : envelope.resource == 2
                    ? "https://api.venice.ai/api/v1/embeddings"
                    : string.concat("https://api.venice.ai/api/v1/x402/balance/", account);
        return string.concat(
            "api.venice.ai wants you to sign in with your Ethereum account:\n",
            account,
            "\n\nSign in to Venice AI\n\nURI: ",
            uri,
            "\nVersion: 1\nChain ID: 8453\nNonce: ",
            envelope.nonce,
            "\nIssued At: ",
            envelope.issuedAt,
            "\nExpiration Time: ",
            envelope.expirationTime
        );
    }

    /// @notice Rejects injected nonce fields and challenges outside the short, canonical validity window.
    /// @param envelope The bounded decoded challenge fields.
    /// @return valid Whether the nonce and dates satisfy the authentication policy.
    function _validChallenge(TelligenceVeniceAuthEnvelope memory envelope) private view returns (bool valid) {
        bytes memory nonce = bytes(envelope.nonce);
        for (uint256 i; i < nonce.length; i++) {
            bytes1 character = nonce[i];
            if (
                !(character >= "0" && character <= "9") && !(character >= "A" && character <= "Z")
                    && !(character >= "a" && character <= "z")
            ) return false;
        }
        (bool issuedValid, uint256 issued) = TelligenceDateTime.parseMilliseconds(bytes(envelope.issuedAt));
        (bool expiryValid, uint256 expiry) = TelligenceDateTime.parseMilliseconds(bytes(envelope.expirationTime));
        if (!issuedValid || !expiryValid || expiry <= issued || expiry - issued > MAX_AUTH_LIFETIME_MS) return false;

        // A short clock allowance accommodates the provider and Base timestamps without extending signed expiry.
        // Block time is the onchain clock for this short TTL; provider time is separately restricted above.
        // forge-lint: disable-next-line(block-timestamp)
        return issued <= block.timestamp * 1000 + _MAX_FUTURE_SKEW_MS && expiry > block.timestamp * 1000;
    }

    /// @notice Loads one word after the caller has bounded the complete calldata layout.
    /// @param data The complete signature envelope.
    /// @param offset The bounded byte offset of the ABI word.
    /// @return value The ABI word.
    function _word(bytes calldata data, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") {
            value := calldataload(add(data.offset, offset))
        }
    }

    /// @notice Checks padding bytes whose positions have already been bounded by the envelope layout.
    /// @param data The complete signature envelope.
    /// @param start The first padding byte.
    /// @param end The exclusive end of padding.
    /// @return zero Whether all padding bytes are zero.
    function _zeroPadding(bytes calldata data, uint256 start, uint256 end) private pure returns (bool zero) {
        for (uint256 i = start; i < end; i++) {
            if (data[i] != 0) return false;
        }
        return true;
    }
}
