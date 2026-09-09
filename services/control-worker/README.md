# Control worker

The worker turns a project's already committed production policy into compute, tracks the resulting transactions, and reconciles provider credit. It runs as a private Railway service with PostgreSQL. It never receives prompts or application bearer keys.

## Run

From `services/`, run `npm ci`, `npm run migrate`, then `npm run start:worker`. The shared migration imports `WORKER_MIGRATION_SQL` after the project and provider tables. Set Railway's config path to `services/control-worker/railway.toml` with the repository root as build context.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Private PostgreSQL connection; required |
| `BASE_RPC_URL` | Base JSON-RPC endpoint supporting `safe`/`finalized` blocks and historical contract reads |
| `TELLIGENCE_MANIFEST_PATH` | Mounted deployment manifest described below |
| `AUTH_SIGNER_URL` | Private signer origin, such as `http://auth-signer.railway.internal:3001` |
| `AUTH_SIGNER_SERVICE_SECRET` | Private service credential, at least 32 random bytes |
| `PORT` | HTTP health port, default `8082` |
| `KEEPER_EXECUTION_ENABLED` | Literal `true` explicitly enables gas spending; default `false` |
| `KEEPER_PRIVATE_KEY` | Dedicated gas wallet; required only for execution; distinct from every inference signer |
| `KEEPER_CONFIRMATIONS` | Minimum confirmation depth, at least `20`; default `20` |
| `KEEPER_MAX_GAS` | Per-transaction gas limit ceiling, default `3000000` |
| `KEEPER_MAX_FEE_PER_GAS_WEI` | Fee-per-gas ceiling, default `5000000000` |

`GET /healthz` reports process liveness. `GET /readyz` returns 503 until the database, deployment pins, and reconciliation configuration are usable. Health responses contain no credentials. A configured worker can be ready while an individual project or Venice is unavailable; provider bindings and their observation timestamps control project access.

Without execution enabled, the worker refreshes capacity and audits old receipts but does not claim jobs, create plans, sign transactions, or spend gas. No endpoint enables execution remotely. Startup requires configuration; it never creates accounts or inserts example projects.

## Deployment manifest

Use the same manifest as the gateway, with these additional fields. Values must come from the selected deployment and verified source, not from this document:

```text
chainId: 8453
vvvAddress: canonical Base VVV
stakingAddress: canonical Base Venice staking proxy
diemAddress: canonical Base DIEM
factoryAddress: deployed TelligenceFactory
factoryRuntimeHash: keccak256(factory runtime bytecode)
canonicalTerminal: selected stock VVV terminal
controllerAddress: selected stock Juicebox controller
runtimePins: [
  { address, runtimeHash },
  { address: staking proxy, runtimeHash,
    implementation: { address: verified implementation, runtimeHash } }
]
```

`runtimePins` must include the factory, terminal, controller, VVV, staking, and DIEM. The staking implementation is required and resolved through the standard EIP-1967 implementation slot. Additional upstream dependencies and any supported EIP-1967 proxies can be pinned. Duplicate pins, other chains, substituted provider addresses, unpinned implementations, and changed bytecode fail closed. The manifest also carries source revisions and deployment evidence used by the rest of the repository.

Verify a completed manifest without a keeper key:

```sh
node control-worker/check-manifest.mjs
```

The command reads `TELLIGENCE_MANIFEST_PATH` and `BASE_RPC_URL`, checks runtime and implementation hashes, and prints the checked block. This is a comparison against operator-supplied pins, not an audit or an independent proof that those pins are trustworthy. Factory, policy, and vault bindings are checked separately for every project operation. The immutable factory supplies new project identities; a client cannot supply an arbitrary transaction destination.

## Execution and recovery

The planner uses confirmed policy identity and current contract state. It can call only:

- Stock controller `sendReservedTokensToSplitsOf` for that Revnet, so reserved production reaches the wrapper.
- Policy `cashOutProduction` and `allocate`, whose contracts enforce batches, cadence, output floors, cap, and destinations. Standard Revnet buybacks remain enabled.
- Vault cooldown transitions, liquid returns, reward returns, and recovery of donated sVVV.
- Policy return of excess/unallocated VVV and burning of late production after closure or the allocation cap.

Allocation amounts come from held VVV and the remaining lifetime cap. Cashout batches come from the policy's prescribed limits. The planner simulates each exact operation. Winddown waits for actual onchain deadlines; it does not reset cooldowns. Idle reward claims use one operation identity per UTC day. Mature recovery takes priority over maintenance. Every operation returns assets through existing contracts' fixed destinations.

There is one in-flight job per project. PostgreSQL serializes planning and assigns a project lease with an increasing fence. Every job mutation checks the current fence. Persisted attempt timestamps rotate planning and capacity refresh pages even when earlier projects repeatedly fail. A separate transaction-scoped advisory lock serializes the keeper's nonce across projects. The database transaction commits a nonce, deterministic hash, signed transaction, exact calldata, and preconditions before any broadcast. The signer never broadcasts from inside that transaction.

On restart, the worker recovers the same bytes, recomputes their hash, recovers their signer, and checks their chain, destination, zero ETH value, nonce, and typed calldata. An ambiguous RPC send may only resend those bytes. It never silently replaces the transaction or assigns a fresh nonce to the same operation. A consumed nonce without the expected receipt is quarantined for reconciliation.

Successful and reverted receipts remain in flight until their block reaches Base's `finalized` tag and the configured confirmation depth. Successful receipts also require a canonical block and matching contract effects/historical state. This finality wait prevents a normal unsafe-chain reorg from reviving an earlier transaction after a new allocation was admitted. An orphaned receipt disables capacity. Completed and reverted receipts are revisited; a deeper reorg quarantines affected work and disables its capacity. Quarantined projects cannot admit more jobs or capacity. No transaction success alone grants API access.

Do not delete a transaction intent to retry a job. A transaction can remain executable after the process or RPC reported failure. To resolve a quarantined job, independently establish the canonical receipt/nonce history and contract state, retain that evidence, then repair its recorded state. Fee replacement is deliberately outside this automatic worker; perform an explicit same-nonce reconciliation procedure before accepting a replacement. After restoring a database backup, disable execution and reconcile all keeper nonces and receipts before restarting it. A dedicated gas wallet must not be used for unrelated transactions.

## Provider capacity

The worker generates a resource-3 signature through the private signer and calls only the documented, free `GET https://api.venice.ai/api/v1/x402/balance/{vault}` route. It requires the exact successful response envelope and matching wallet. It accepts DIEM-backed remaining allowance and rejects any nonzero USDC balance, including fractions smaller than one micro-dollar. It never probes a paid inference route, follows a redirect, tops up USDC, or activates a project's canary marker.

Daily capacity uses the conservative minimum of the vault's DIEM stake at the Base `safe` block and current block. The latest chain head must be fresh. The observed provider balance must fit that capacity; identity, UTC epoch, timing, authentication state, and signer generation must reconcile. Decimal conversion uses integer arithmetic and floors available credit. A request crossing the UTC reset is discarded.

Observation writes lock the project, retain all gateway reservations and settled usage, and cannot overwrite a newer observation. The saved observation must still match the bound signer address and generation. A canary is still required before the gateway serves inference. Signer rotation invalidates capacity until the encrypted signer binding is explicitly reconciled; observing a new address does not overwrite the old credential.

Venice account bootstrap, funded ERC-1271 acceptance, paid usage, and full cooldown recovery remain separate live acceptance tests. This worker implementation and its deterministic fixtures do not claim those external tests have run. Upstream administrative upgrades remain an external trust dependency; periodic pin checks cannot stop an upgrade that occurs during transaction inclusion.

## Tests and evidence

Tests were introduced before the transaction/capacity implementation, first failing because the modules did not exist. Later regression tests failed on missing persisted-intent validation and on the provider envelope before those implementations were corrected.

```sh
node --test control-worker/test/*.test.mjs
TEST_DATABASE_URL=postgres://user@localhost:5432/telligence_test node --test control-worker/test/*.test.mjs
```

The PostgreSQL suite creates a randomly named temporary schema, applies the shared and worker schemas there, and removes only that schema. It requires permission to create schemas in a disposable test database. It checks concurrent enqueue/planning, lease takeover, stale fences, durable transaction recovery, nonce serialization, reorg isolation, signer binding, monotonic capacity snapshots, and truthful HTTP readiness. Production code has no in-memory store.

The unit fixtures cover ambiguous broadcasts, consumed nonces, orphaned/reverted receipts, effect verification, unsigned preflight expiry, runtime upgrades, typed calldata, production distribution, cooldown timing, USD fallback, wrong wallets, malformed balances, UTC reset, and stale observations. HTTP failures are retained as redacted error codes; provider bodies and authentication headers are never logged.

Primary provider references: [wallet-only balance flow](https://docs.venice.ai/guides/integrations/x402-venice-api) and [balance response schema](https://docs.venice.ai/api-reference/endpoint/x402/balance), inspected September 9, 2026. These establish the interface implemented here; they do not establish a funded Telligence deployment.

Generated deployment manifests include the supported `policyVersion` observed from the factory at the same pinned safe block as its runtime. The worker checks that declared version with its runtime pins before proceeding. Older manifests without this field retain their runtime verification; the gateway independently reads the actual factory version before configuration or registration.
