// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {TelligenceVeniceAuth} from "../src/abstract/TelligenceVeniceAuth.sol";

import {TelligenceVeniceAuthHarness} from "./helpers/TelligenceVeniceAuthHarness.sol";

contract TelligenceVeniceAuthTest is Test {
    TelligenceVeniceAuthHarness internal auth;
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    address internal policy = makeAddr("policy");
    string internal constant ISSUED = "2026-09-09T14:48:27.529Z";
    string internal constant EXPIRES = "2026-09-09T14:53:27.529Z";
    string internal constant NONCE = "W0Qbv46Qn9o5717ULywyE";
    bytes4 internal constant VALID = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;

    function setUp() public {
        vm.chainId(8453);
        vm.warp(1_788_965_400);
        auth = new TelligenceVeniceAuthHarness(policy, vm.addr(SIGNER_KEY));
    }

    function testAcceptsCanonicalVeniceChallenge() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), VALID);
    }

    function testRejectsFinancialDigest() public view {
        (, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(keccak256("Permit(address spender,uint256 value)"), envelope), INVALID);
    }

    function testAcceptsEachPermittedResource() public view {
        for (uint8 resource; resource < 4; resource++) {
            (bytes32 messageHash, bytes memory envelope) =
                _signed(auth, resource, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
            assertEq(auth.isValidSignature(messageHash, envelope), VALID);
        }
    }

    function testRejectsUnrecognizedResource() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 4, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsExpiredChallenge() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        vm.warp(1_788_965_608);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsFarFutureChallenge() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        vm.warp(1_788_965_276);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testAcceptsRuntimeGeneratedSignatureVector() public {
        string memory fixture = vm.readFile("test/fixtures/venice-auth-vector.json");
        address vault = vm.parseJsonAddress(fixture, ".vault");
        bytes32 messageHash = vm.parseJsonBytes32(fixture, ".messageHash");
        bytes memory envelope = vm.parseJsonBytes(fixture, ".signatureEnvelope");
        vm.etch(vault, address(auth).code);
        TelligenceVeniceAuthHarness(vault).initializeFixture(vm.addr(SIGNER_KEY));
        assertEq(TelligenceVeniceAuthHarness(vault).signerGeneration(), 1);
        assertTrue(TelligenceVeniceAuthHarness(vault).authenticationEnabled());
        assertEq(TelligenceVeniceAuthHarness(vault).isValidSignature(messageHash, envelope), VALID);
        (bytes32 solidityHash, bytes memory solidityEnvelope) =
            _signed(TelligenceVeniceAuthHarness(vault), 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(solidityHash, messageHash);
        assertEq(solidityEnvelope, envelope);
    }

    function testLifecycleCutoffRejectsOtherwiseValidAuthentication() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), VALID);
        auth.setAuthenticationAllowed(false);
        assertTrue(auth.authenticationEnabled());
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testAcceptsBoundedProviderClockSkew() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        vm.warp(1_788_965_280);
        assertEq(auth.isValidSignature(messageHash, envelope), VALID);
    }

    function testRejectsLifetimeOverFiveMinutes() public view {
        (bytes32 messageHash, bytes memory envelope) =
            _signed(auth, 0, NONCE, ISSUED, "2026-09-09T14:53:27.530Z", 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsReversedDates() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, EXPIRES, ISSUED, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsZeroLifetime() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, ISSUED, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsNonceLineInjection() public view {
        (bytes32 messageHash, bytes memory envelope) =
            _signed(auth, 0, "Nonce123\nResources: Permit2", ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsInvalidCalendarDate() public view {
        (bytes32 messageHash, bytes memory envelope) =
            _signed(auth, 0, NONCE, "2026-02-29T14:48:27.529Z", "2026-02-29T14:53:27.529Z", 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsInvalidTimestampDelimiter() public view {
        (bytes32 messageHash, bytes memory envelope) =
            _signed(auth, 0, NONCE, "2026-09-09 14:48:27.529Z", EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsTimestampWithoutMilliseconds() public view {
        (bytes32 messageHash, bytes memory envelope) =
            _signed(auth, 0, NONCE, "2026-09-09T14:48:27Z", EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsWrongSigner() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY + 1);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsCrossVaultReplay() public {
        TelligenceVeniceAuthHarness other = new TelligenceVeniceAuthHarness(policy, vm.addr(SIGNER_KEY));
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(other.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsInnerSignatureForAnotherVault() public view {
        (bytes32 messageHash,) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        bytes memory envelope = _envelopeWithDomain(messageHash, address(0xBEEF), 8453, "TelligenceVeniceAuth");
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsInnerSignatureForAnotherChain() public view {
        (bytes32 messageHash,) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        bytes memory envelope = _envelopeWithDomain(messageHash, address(auth), 1, "TelligenceVeniceAuth");
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsInnerSignatureForAnotherDomainName() public view {
        (bytes32 messageHash,) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        bytes memory envelope = _envelopeWithDomain(messageHash, address(auth), 8453, "FinancialAuthorization");
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsWrongChain() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        vm.chainId(1);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testPolicyRotationInvalidatesEnvelopes() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        vm.prank(policy);
        auth.setInferenceSigner(vm.addr(SIGNER_KEY + 1));
        assertEq(auth.signerGeneration(), 2);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
        (messageHash, envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 2, SIGNER_KEY + 1);
        assertEq(auth.isValidSignature(messageHash, envelope), VALID);
    }

    function testReenablingSameSignerDoesNotRestoreSignatures() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        vm.startPrank(policy);
        auth.setAuthenticationEnabled(false);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
        auth.setAuthenticationEnabled(true);
        vm.stopPrank();
        assertEq(auth.signerGeneration(), 3);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
        (messageHash, envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 3, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), VALID);
    }

    function testRotationDoesNotEnableAuthentication() public {
        vm.startPrank(policy);
        auth.setAuthenticationEnabled(false);
        auth.setInferenceSigner(vm.addr(SIGNER_KEY + 1));
        vm.stopPrank();
        assertFalse(auth.authenticationEnabled());
    }

    function testHostedSignerCannotAdministerAuthentication() public {
        vm.startPrank(vm.addr(SIGNER_KEY));
        vm.expectRevert(
            abi.encodeWithSelector(TelligenceVeniceAuth.TelligenceVeniceAuth_Unauthorized.selector, vm.addr(SIGNER_KEY))
        );
        auth.setAuthenticationEnabled(false);
        vm.expectRevert(
            abi.encodeWithSelector(TelligenceVeniceAuth.TelligenceVeniceAuth_Unauthorized.selector, vm.addr(SIGNER_KEY))
        );
        auth.setInferenceSigner(vm.addr(SIGNER_KEY + 1));
        vm.stopPrank();
    }

    function testPermanentShutdownCannotBeReversed() public {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        auth.disablePermanently();
        assertTrue(auth.authenticationPermanentlyDisabled());
        assertFalse(auth.authenticationEnabled());
        assertEq(auth.signerGeneration(), 2);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
        vm.startPrank(policy);
        vm.expectRevert(TelligenceVeniceAuth.TelligenceVeniceAuth_AuthenticationPermanentlyDisabled.selector);
        auth.setAuthenticationEnabled(true);
        vm.expectRevert(TelligenceVeniceAuth.TelligenceVeniceAuth_AuthenticationPermanentlyDisabled.selector);
        auth.setInferenceSigner(vm.addr(SIGNER_KEY + 1));
        vm.stopPrank();
    }

    function testZeroSignerStartsDisabledAndMustBeConfiguredBeforeEnabling() public {
        TelligenceVeniceAuthHarness empty = new TelligenceVeniceAuthHarness(policy, address(0));
        assertFalse(empty.authenticationEnabled());
        vm.startPrank(policy);
        vm.expectRevert(TelligenceVeniceAuth.TelligenceVeniceAuth_InvalidSigner.selector);
        empty.setAuthenticationEnabled(true);
        vm.expectRevert(TelligenceVeniceAuth.TelligenceVeniceAuth_InvalidSigner.selector);
        empty.setInferenceSigner(address(0));
        empty.setInferenceSigner(vm.addr(SIGNER_KEY));
        empty.setAuthenticationEnabled(true);
        vm.stopPrank();
        (bytes32 messageHash, bytes memory envelope) = _signed(empty, 0, NONCE, ISSUED, EXPIRES, 3, SIGNER_KEY);
        assertEq(empty.isValidSignature(messageHash, envelope), VALID);
    }

    function testRejectsZeroPolicy() public {
        vm.expectRevert(TelligenceVeniceAuth.TelligenceVeniceAuth_InvalidPolicy.selector);
        new TelligenceVeniceAuthHarness(address(0), vm.addr(SIGNER_KEY));
    }

    function testRejectsRawSignature() public view {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, keccak256("financial order"));
        assertEq(auth.isValidSignature(keccak256("financial order"), abi.encodePacked(r, s, v)), INVALID);
    }

    function testRejectsChangedGeneration() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 2, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsNonzeroPadding() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        envelope[256 + bytes(NONCE).length] = 0x01;
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsHugeDynamicOffsetWithoutReverting() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        assembly ("memory-safe") { mstore(add(envelope, 160), not(0)) }
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testRejectsHighSSignature() public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        for (uint256 i = 480; i < 512; i++) {
            envelope[i] = 0xff;
        }
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testFuzzRejectsArbitraryEnvelope(bytes32 digest, bytes memory envelope) public view {
        assertEq(auth.isValidSignature(digest, envelope), INVALID);
    }

    function testFuzzRejectsSingleByteMutation(uint256 index, uint8 value) public view {
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, NONCE, ISSUED, EXPIRES, 1, SIGNER_KEY);
        index = bound(index, 0, envelope.length - 1);
        vm.assume(envelope[index] != bytes1(value));
        envelope[index] = bytes1(value);
        assertEq(auth.isValidSignature(messageHash, envelope), INVALID);
    }

    function testFuzzAcceptsBoundedAlphanumericNonce(uint8 length) public view {
        length = uint8(bound(length, 8, 64));
        bytes memory nonce = new bytes(length);
        for (uint256 i; i < length; i++) {
            nonce[i] = bytes1(uint8(65 + i % 26));
        }
        (bytes32 messageHash, bytes memory envelope) = _signed(auth, 0, string(nonce), ISSUED, EXPIRES, 1, SIGNER_KEY);
        assertEq(auth.isValidSignature(messageHash, envelope), VALID);
    }

    function _envelopeWithDomain(
        bytes32 messageHash,
        address vault,
        uint256 chainId,
        string memory name
    )
        internal
        pure
        returns (bytes memory envelope)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256("1"),
                chainId,
                vault
            )
        );
        bytes32 payload = keccak256(
            abi.encode(keccak256("VeniceAuthentication(bytes32 messageHash,uint64 generation)"), messageHash, uint64(1))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, keccak256(abi.encodePacked("\x19\x01", domain, payload)));
        return abi.encode(uint8(1), uint64(1), uint8(0), NONCE, ISSUED, EXPIRES, abi.encodePacked(r, s, v));
    }

    function _signed(
        TelligenceVeniceAuthHarness vault,
        uint8 resource,
        string memory nonce,
        string memory issued,
        string memory expires,
        uint64 generation,
        uint256 key
    )
        internal
        pure
        returns (bytes32 messageHash, bytes memory envelope)
    {
        string memory uri = resource == 0
            ? "https://api.venice.ai/api/v1/chat/completions"
            : resource == 1
                ? "https://api.venice.ai/api/v1/responses"
                : resource == 2
                    ? "https://api.venice.ai/api/v1/embeddings"
                    : string.concat(
                        "https://api.venice.ai/api/v1/x402/balance/", Strings.toChecksumHexString(address(vault))
                    );
        string memory message = string.concat(
            "api.venice.ai wants you to sign in with your Ethereum account:\n",
            Strings.toChecksumHexString(address(vault)),
            "\n\nSign in to Venice AI\n\nURI: ",
            uri,
            "\nVersion: 1\nChain ID: 8453\nNonce: ",
            nonce,
            "\nIssued At: ",
            issued,
            "\nExpiration Time: ",
            expires
        );
        messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n", Strings.toString(bytes(message).length), message)
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("TelligenceVeniceAuth"),
                keccak256("1"),
                uint256(8453),
                address(vault)
            )
        );
        bytes32 payload = keccak256(
            abi.encode(
                keccak256("VeniceAuthentication(bytes32 messageHash,uint64 generation)"), messageHash, generation
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, payload)));
        envelope = abi.encode(uint8(1), generation, resource, nonce, issued, expires, abi.encodePacked(r, s, v));
    }
}
