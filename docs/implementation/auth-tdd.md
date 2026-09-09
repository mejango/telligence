# Venice authentication implementation and TDD evidence

The authentication base is `contracts/src/abstract/TelligenceVeniceAuth.sol`. The compute vault inherits it, with policy authority isolated from its hosted inference signer. No generic signature approval or bootstrap-digest registration exists.

## Red → green

1. Wrote the canonical Venice challenge acceptance test and unrelated financial-digest rejection test against a compileable base whose validation returned `0xffffffff`.
2. Ran `forge test ... --match-contract TelligenceVeniceAuthTest --match-test testAcceptsCanonicalVeniceChallenge -vv`. The actual red result was `0 passed; 1 failed`, with expected `0x1626ba7e` and actual `0xffffffff`. Before this red run, the test helper needed `via_ir` compilation and unrelated in-progress fixture files were excluded; neither compilation error is counted as the red assertion.
3. Implemented the bounded decoder, canonical SIWE reconstruction, Gregorian UTC parsing, EIP-712 signer binding, revocation generations, and permanent disable. Both initial tests passed.
4. Expanded coverage to all permitted resources; expiry, clock skew, five-minute lifetime, malformed calendar dates and nonces; unrelated financial and raw signatures; wrong signer, chain, and vault; rotation, pause, restart, and irreversible shutdown; huge ABI offsets, nonzero padding, and high-S signatures. Three fuzz tests exercise accepted nonce lengths, arbitrary envelopes, and single-byte mutation of valid envelopes.
5. Verified a public Node-generated signer fixture in the Solidity contract and independently reproduced its exact message hash and signature bytes with `vm.sign`. The vector test first failed because Foundry's fixture storage copy did not initialize the deterministic address; explicit test-harness initialization corrected the fixture. Production authentication did not change to accommodate the vector.
6. Added independent Gregorian epoch vectors for 1970, leap years 2000/2024/2400, the non-leap century 2100, and year 9999, plus invalid calendar/encoding tests and an arbitrary-date-bytes fuzz test.

7. Added a derived-vault lifecycle guard after review identified that an announced cutoff must not depend on a keeper transaction. The new test first failed (valid signature accepted after the simulated cutoff), then passed when ERC-1271 checked `_authenticationAllowed()` before decoding. The vault overrides this guard to enforce its exact notice deadline.

8. An independent read-only review found no concrete bug and suggested isolating the inner EIP-712 domain in negative tests. Added valid outer-challenge tests with signatures bound to another vault, chain, and domain name; all are rejected.

Final auth/date verification: 41 passing tests, including four fuzz properties at 4,096 runs each. The production auth and date sources also pass `forge lint ... --deny notes` with zero warnings or notes. A standalone timestamp-lint suppression documents why this short signature lifetime must use the onchain clock; other detected lint issues were corrected.

## Signature wire format

The ABI encoding is a top-level argument list, **not** a tuple with an additional leading offset:

```solidity
abi.encode(
    uint8(1),
    uint64 generation,
    uint8 resource,
    string nonce,
    string issuedAt,
    string expirationTime,
    bytes innerSignature
)
```

- `generation` starts at 1. Every policy signer or enable-state change increments it. Signer rotation preserves the enable flag.
- `nonce` is 8–64 ASCII alphanumeric characters.
- Both timestamps use exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, with validated Gregorian fields and years 1970–9999. Expiry must exceed issue time by at most 300,000 milliseconds, remain later than Base block time, and issue time may be at most 30,000 milliseconds ahead of that block time.
- `innerSignature` is a canonical low-S, 65-byte ECDSA signature with `v` 27 or 28.
- Accepted envelopes have exactly 544 or 576 bytes, canonical dynamic offsets, and zero padding. Malformed envelopes return `0xffffffff` without dynamic ABI decode exceptions.

| Resource | Exact SIWE URI |
| --- | --- |
| 0 | `https://api.venice.ai/api/v1/chat/completions` |
| 1 | `https://api.venice.ai/api/v1/responses` |
| 2 | `https://api.venice.ai/api/v1/embeddings` |
| 3 | `https://api.venice.ai/api/v1/x402/balance/<checksummed vault>` |

The message is constructed exactly as follows, with no trailing newline, optional fields, resources list, request ID, or caller-supplied statement:

```text
api.venice.ai wants you to sign in with your Ethereum account:
<checksummed vault>

Sign in to Venice AI

URI: <selected exact URI>
Version: 1
Chain ID: 8453
Nonce: <nonce>
Issued At: <issuedAt>
Expiration Time: <expirationTime>
```

The EIP-191 hash of that complete message must equal the `hash` passed to ERC-1271. The inner signature is EIP-712 with:

```text
Domain name: TelligenceVeniceAuth
Domain version: 1
Domain chainId: 8453
Domain verifyingContract: vault
Type: VeniceAuthentication(bytes32 messageHash,uint64 generation)
```

This binds every challenge field through `messageHash`, as well as vault, chain, and current revocation generation. Validation itself additionally requires `block.chainid == 8453`.

## Integration surface

```solidity
constructor(address policy, address initialSigner)
setInferenceSigner(address signer) // policy only; nonzero signer; does not unpause
setAuthenticationEnabled(bool enabled) // policy only; every call invalidates issued signatures
_disableAuthentication() // internal; permanent; called by vault winddown
_authenticationAllowed() // internal virtual view; derived vault enforces lifecycle deadlines
```

`AUTH_POLICY` is immutable. `inferenceSigner`, `signerGeneration`, `authenticationEnabled`, and `authenticationPermanentlyDisabled` are public. A zero initial signer starts disabled and must be configured before policy can enable authentication. Once permanently disabled, policy cannot rotate or enable it again.

The public test vector lives in both `services/auth-signer/test/venice-auth-vector.json` and `contracts/test/fixtures/venice-auth-vector.json`. Its signer uses the explicitly public test private key `0xA11CE`; it is never a deployment credential.

## Release boundary

These tests establish contract behavior and byte-level runtime compatibility. They do not establish that Venice transports the full ERC-1271 envelope, links a newly deployed vault, grants its DIEM balance, or restricts provider sessions/admin-key creation. A funded Base canary must prove those properties before activation. Unknown Web3 bootstrap/JWT formats are not accepted by this contract; onboarding must fail closed rather than broaden the hosted signer's contract authority.
