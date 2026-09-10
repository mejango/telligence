# Inference authentication signer

This Railway private service holds independently generated inference signer keys. It signs only the versioned Venice authentication envelope accepted by `TelligenceVeniceAuth`; it has no asset transaction endpoint. The public gateway gives creators a separate Telligence key.

Start with `npm run start:signer` from `services/`. Required variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Private PostgreSQL connection as the `telligence_signer` role: vault identity, encrypted signer material, reservation state, and preparations only. |
| `AUTH_SIGNER_GATEWAY_SECRET` | The gateway's bearer credential, at least 32 characters. It may prepare signers and request inference signatures for a durable, undispatched reservation of the named project. |
| `AUTH_SIGNER_WORKER_SECRET` | The worker's distinct bearer credential. It may only request the free balance resource (3). |
| `SIGNER_ENCRYPTION_KEY` | Canonical base64 encoding of 32 random bytes, stored only in this service's sealed variables. |
| `SIGNER_ENCRYPTION_KEY_PREVIOUS` | Only during rotation; see `rotate-encryption-key.mjs`. |
| `PORT` | Private listener port; defaults to 3001. |

Do not assign this service a Railway public domain. The client accepts only Railway private DNS names or loopback origins and refuses redirects. `/healthz` exposes only health. All other operations require one of the two caller credentials and enforce a bounded JSON body and concurrency ceiling. Protection of key material (the encryption key, present only here) is distinct from protection against unauthorized signing requests (caller scopes plus the reservation binding): a stolen gateway credential can obtain a signature only for a reservation that already exists in the ledger, so every signature is accounted for; a stolen worker credential obtains only balance signatures.

Key rotation: set the new `SIGNER_ENCRYPTION_KEY`, move the old value to `SIGNER_ENCRYPTION_KEY_PREVIOUS`, run `node auth-signer/rotate-encryption-key.mjs --check` then `--rotate` on this host, and remove the previous key when `--check` reports nothing left to rotate. Rotation is atomic; a row neither key decrypts aborts it, and that signer must be rotated onchain instead.

## Private API

- `POST /v1/prepare-signer` takes `{creatorAddress, preparationId}`. It persists a dedicated encrypted signing key and returns only `{inferenceSigner, preparationId, expiresAt}`. The gateway first authenticates the creator and later claims the preparation only after validating the deployed factory instance and signer. Preparations expire after 24 hours.
- `POST /v1/projects/:uuid/venice-signature` takes exactly one of `{resource}`, `{challenge}`, or `{message}`, plus `reservationId` for anything other than the balance resource. It verifies that reservation is `reserved` and not yet dispatched for that project before touching key material, loads the project's registered vault, signer and generation from PostgreSQL, and returns `{headerName, headerValue, expiresAt}`. Neither caller-specified vaults nor arbitrary signing digests are supported.

Resource IDs are 0 chat completions, 1 responses, 2 embeddings, and 3 the vault's own x402 balance. These represent authentication formats; the gateway independently permits inference endpoints and pricing. Pending bindings may authenticate only to read balance. Inference requires a ready binding; the control plane separately requires funded canary approval.

The signature ABI is `abi.encode(uint8(1), uint64 generation, uint8 resource, string nonce, string issuedAt, string expirationTime, bytes innerSignature)`. The inner EIP-712 domain is `TelligenceVeniceAuth`, version `1`, Base chain `8453`, and the vault address. Its type is `VeniceAuthentication(bytes32 messageHash,uint64 generation)`, where `messageHash` is the EIP-191 hash of the exact SIWE text. Only the fixed Venice domain, statement, resource, checksummed vault, alphanumeric nonce and canonical millisecond timestamps are accepted. Lifetime is at most 300 seconds. Generated challenges are backdated five seconds to tolerate Base block precision and delay.

The [shared test vector](test/venice-auth-vector.json) is reproducible with `node auth-signer/test/generate-vector.mjs` from `services/`. Its publicly known test key is never suitable for deployment. The Solidity authentication tests consume the same vector to detect ABI, checksum, message or EIP-712 drift.

## Boundaries and operations

Signer ciphertext uses AES-256-GCM with a fresh nonce and authenticated context tied to the signer's lowercase address. Decryption also verifies the derived address against the registered binding. The encryption key is absent from PostgreSQL. JavaScript key material exists in process memory; this is an isolated hosted signer, not a hardware security boundary. A stolen signer can consume provider credit until effective revocation. Provider credential/session revocation must accompany onchain signer rotation where applicable.

Rotating a vault signer or toggling authentication increments its onchain generation. Reconcile that generation before issuing new headers. Permanent vault shutdown cannot be undone through the signer service. This service does not bootstrap unverified Venice accounts, pay USDC, retry paid inference, or mark the funded activation canary complete.

The `creator-auth.mjs` helper builds a separate Base SIWE login message bound to the configured Telligence origin and requested wallet. Verification supports local EOA signatures and smart wallets via a supplied Base public client. The gateway owns challenge generation, database persistence, atomic one-time consumption, session lifetime, and recent-authentication policy; never verify a challenge supplied directly by an unauthenticated client.

Provider format evidence: [Venice's manual wallet flow](https://github.com/veniceai/api-docs/blob/main/guides/integrations/x402-venice-api.mdx), [pinned wallet balance documentation](https://github.com/veniceai/skills/blob/be69bebc470353da07d7284ec1d283d5a2f0a168/skills/venice-x402/SKILL.md), and the repository's saved challenge. Transport of the full ERC-1271 envelope, DIEM account linkage, and provider session revocation still require the funded canary described in `docs/venice-integration.md`.
