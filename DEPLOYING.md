# Deploying Telligence

Current hosting and domain status: [Railway production record](docs/implementation/railway-production.md).

This repository builds deployable artifacts. It does not contain a production
factory manifest, funded Venice account, or completed activation evidence. A
working Railway login does not supply those prerequisites. Deployment and live
funding are explicit operational actions; ordinary build/test commands do not
broadcast transactions or spend provider credit.

## Runtime topology

| Service | Build context / Dockerfile | Port / liveness | Exposure |
| --- | --- | --- | --- |
| Web | `web/` / `web/Dockerfile` | 3000 / `/api/healthz` | Public HTTPS |
| Gateway | repository root / `services/Dockerfile`, `SERVICE=gateway` | 8080 / `/healthz`; DB readiness `/readyz` | Public HTTPS for application inference; private origin for web proxy |
| Authentication signer | repository root / `services/Dockerfile`, `SERVICE=auth-signer` | 3001 / `/healthz` | Private only, `auth-signer.railway.internal` |
| Control worker | repository root / `services/Dockerfile`, `SERVICE=control-worker` | 8082 / `/healthz`; configured readiness `/readyz` | Private only |
| PostgreSQL | managed PostgreSQL 14.20 or compatible tested release | 5432 | Private only |

Build the service image from the repository root: it includes the generated
ABIs under `packages/contracts/`. Setting Railway's service root to
`services/` would omit those files. Keep backend root at `/`.

The web service deploys GitHub repository `mejango/telligence`, branch `main`,
with these explicit Railway settings: root `/web`, Dockerfile `Dockerfile`,
watch path `/web/**`, healthcheck `/api/healthz`, and port `3000`. Leave custom
build/start commands unset so the Dockerfile controls them. Watch paths remain
relative to the repository root.

No Railway config-file override is active. The retained `web/railway.json` and
`services/*/railway.toml` describe legacy settings; their presence does not make
them authoritative for a new service. Railway rejected the deprecated
`railwayConfigFile` setting for this deployment. Configure and verify effective
service settings directly. See [Railway's config-as-code notice](https://docs.railway.com/config-as-code).

Use separate Railway `dev` and `production` environments with independently
generated secrets, databases, public origins, manifests, and provider identities.
Do not assign a production origin before the domain has been selected. Promote
reviewed immutable revisions after CI passes; prevent an older overlapping
deployment from replacing a newer revision.

The signer must have no public domain or public TCP proxy. Private networking
is supplemented by service authentication. The gateway must never receive
`SIGNER_ENCRYPTION_KEY`; the web must never receive database or service
credentials. The worker's optional gas key is separate from the inference signer
and has no controller or creator role.

## Configuration

`services/.env.example` describes backend values. `.env.example` at the root
maps them to Compose. `npm run dev:init` generates local-only credentials;
production secrets must be generated and managed independently.

| Variable | Service | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | gateway, signer, worker | Private PostgreSQL connection **as that service's own role** (`telligence_gateway`, `telligence_signer`, `telligence_worker`); use platform-verified TLS where applicable |
| `MIGRATION_DATABASE_URL` | gateway pre-deploy only | Table-owner connection used by `node db/migrate.mjs`; the gateway process never connects with it |
| `TELLIGENCE_GATEWAY_DB_PASSWORD`, `TELLIGENCE_SIGNER_DB_PASSWORD`, `TELLIGENCE_WORKER_DB_PASSWORD` | one-off `node db/roles.mjs` | Role passwords, at least 32 characters; set only for the role-creation command, never on a running service |
| `API_KEY_PEPPER` | gateway | Independent random secret, at least 32 bytes; changing it invalidates existing application keys |
| `AUTH_SIGNER_SERVICE_SECRET` | gateway, worker | Each caller's own signer credential, at least 32 characters; the gateway's value is the signer's `AUTH_SIGNER_GATEWAY_SECRET`, the worker's is `AUTH_SIGNER_WORKER_SECRET` |
| `AUTH_SIGNER_GATEWAY_SECRET`, `AUTH_SIGNER_WORKER_SECRET` | signer only | Distinct credentials; the worker credential can only request the free balance resource, the gateway credential can only request inference signatures for a durable, undispatched reservation |
| `SIGNER_ENCRYPTION_KEY` | signer only | Exactly 32 random bytes encoded as canonical base64; back up independently of the database |
| `SIGNER_ENCRYPTION_KEY_PREVIOUS` | signer only, during rotation | The previous key while `node auth-signer/rotate-encryption-key.mjs --rotate` re-encrypts rows; remove afterwards |
| `EXPECTED_LEDGER_CHECKPOINT` | gateway | Optional `<ISO time>:<count>` printed by `node db/restore-check.mjs --print-checkpoint` and stored outside the database; a ledger with fewer reservations refuses new requests with `ledger_untrusted` |
| `AUTH_SIGNER_URL` | gateway, worker | `http://auth-signer.railway.internal:3001` |
| `ALLOWED_WEB_ORIGINS` | gateway | Exact comma-separated public web origins; production requires HTTPS |
| `PUBLIC_API_BASE_URL` | gateway | Public HTTPS API endpoint ending in `/api/v1` |
| `BASE_RPC_URL` | gateway, worker | Base RPC endpoint; backend secret URLs never enter public build variables |
| `TELLIGENCE_MANIFEST_PATH` | gateway, worker | Mounted reviewed deployment manifest; no default deployment |
| `MODEL_POLICY_JSON` | gateway | Reviewed model allowlist, price ceilings and limits; refreshes free official DIEM metadata every 60 seconds and expires observations after five minutes |
| `MODEL_PRICES_JSON` | gateway | Alternative manual reviewed catalog, including expiry within 24 hours; mutually exclusive with `MODEL_POLICY_JSON` |
| `KEEPER_EXECUTION_ENABLED` | worker | Defaults to `false`; read-only reconciliation remains available |
| `KEEPER_PRIVATE_KEY` | worker only | Required only when keeper execution is enabled; a gas-only account with no principal authority |
| `KEEPER_MAX_GAS`, `KEEPER_MAX_FEE_PER_GAS_WEI` | worker | Explicit transaction gas/fee ceilings |
| `TELLIGENCE_GATEWAY_URL` | web runtime | Fixed server-only gateway origin; `http://gateway.railway.internal:8080` or public HTTPS |
| `NEXT_PUBLIC_SITE_URL` | web build and runtime | Exact canonical origin for metadata and creator-session proxy validation |
| `NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS` | web build | Optional independently verified Base factory address enabling direct recovery during gateway outages |

Other public web values remain documented in `web/.env.example`: Bendystraw
origins, public Para application key/environment, optional WalletConnect project
ID, and the immutable revision. Public build values are compiled into browser
JavaScript. For GitHub deployments, leave `NEXT_PUBLIC_VERSION` unset: the
Dockerfile uses `RAILWAY_GIT_COMMIT_SHA` at build and runtime. A manual override
would take precedence and could label later releases with an old revision.
Explicit version values are for standalone image or CLI uploads that lack a
GitHub source SHA; remove such overrides when connecting GitHub autodeploys.

`MODEL_POLICY_JSON` has the form `{ "models": { "model-id": { ...limits } } }`.
Each model supplies integer `inputMicroUsdPerMillion`,
`outputMicroUsdPerMillion`, `maxOutputTokens`, `maxInputBytes`, and
`maxContextTokens`. These are reviewed ceilings, not permission to trust an
arbitrary provider response. Fresh official DIEM metadata must confirm the
model's supported text behavior and remain within the reviewed prices/limits.
A price increase, missing model, context reduction, stale metadata, or unsupported
reasoning behavior disables the affected model. No configured policy or manual
catalog means inference stays unavailable. This refresh does not perform paid
inference and does not prove a project's canary.

Browsers use `/api/telligence` on the web origin; the bounded server proxy
forwards only creator session, CSRF, and public project paths. It never carries
inference. Applications use the gateway's public `/api/v1` base URL directly
(the `apiBaseUrl` reported by `GET /v1/config` and shown in the key console),
including `GET /api/v1/requests/:id` for request status, so a website
deployment or outage cannot interrupt inference. Point `PUBLIC_API_BASE_URL`
at a stable gateway hostname such as `https://api.telligence.money/api/v1`
once that custom domain is attached to the gateway service and its DNS record
resolves; until then the Railway-provided gateway domain is the stable endpoint.
For local Next.js, set `TELLIGENCE_GATEWAY_URL=http://localhost:8080` in
`web/.env.local` and `NEXT_PUBLIC_SITE_URL=http://localhost:3002`. Never put a
service secret in a `NEXT_PUBLIC_*` variable.

## Install, build, and database migration

```sh
nvm use
npm install --global npm@12.0.1
npm run setup
npm run audit:production
npm run abi:generate
```

ABI generation requires a successful contract build. The full CI gate installs
locked dependencies, compiles and tests the extension, checks generated ABI
parity, runs real PostgreSQL tests, builds production-shaped web artifacts, and
runs Chromium. It also builds and starts the isolated service stack and checks
that absent deployment/pricing remain unavailable.

For independent local address parity, create the same source checkout as CI:

```sh
git clone --filter=blob:none https://github.com/Bananapus/deploy-all-v6 .contract-source/deploy-all-v6
git -C .contract-source/deploy-all-v6 checkout --detach 316e9d4d3f9e1c5b41a5df7c0ad6183abbeccc7f
export PROTOCOL_DEPLOYMENTS_DIR="$PWD/.contract-source/deploy-all-v6"
```

Without that environment variable, the inherited protocol checker validates the
local fixture only. CI always supplies the independently pinned checkout. The
web schema contract tests query the current live Bendystraw schemas; they are
separate from the deterministic browser fixture and require network access.

Apply the database migration once before starting a new application revision:

```sh
npm --prefix services run migrate
```

Supply `DATABASE_URL` through the deployment environment. The migration runs
inside a transaction with an advisory lock. Do not run migrations against a
production database from a developer shell containing ambiguous environment
files. In Railway, use a dedicated pre-deploy migration command/job and require
its success before starting gateway, signer, and worker processes.

The initial schema is idempotent for first installation. Future schema changes
must be explicit, versioned, compatible migrations; adding a column to a
`CREATE TABLE IF NOT EXISTS` statement does not migrate an existing table.

### Database roles

Each backend connects with its own PostgreSQL role. Create or rotate them once
with the table owner's connection and three independent passwords:

```sh
DATABASE_URL=<owner> TELLIGENCE_GATEWAY_DB_PASSWORD=… TELLIGENCE_SIGNER_DB_PASSWORD=… \
TELLIGENCE_WORKER_DB_PASSWORD=… node services/db/roles.mjs
```

After any migration that adds a table, re-apply the grant matrix with
`node services/db/roles.mjs --grants-only` using the owner connection; a table
the matrix does not cover is unreadable by every service role, so a forgotten
grant fails loudly. Grants are deliberately not part of the migration: a
REVOKE/GRANT over every table can deadlock against the live gateway's
row-locking transactions during a pre-deploy. No service role can `DELETE` or
create tables. The signer reads only vault identity, encrypted signer material, and
reservation state, and writes only preparations. The worker reads no encrypted
signer, key hash, session, or reservation and can update only project status
and capacity observation columns. The gateway cannot read signed keeper
transactions. `services/db/test/operations.test.mjs` exercises each service's
real code paths under its role and asserts the denials.

Remaining impact: the gateway's pre-deploy migration uses
`MIGRATION_DATABASE_URL`, so that container's environment still carries the
owner connection even though the gateway process never opens it. A compromise
that can read the container environment defeats the gateway role boundary; a
compromise limited to the gateway process or its SQL cannot.

## Local containers

```sh
npm run dev:init
npm run dev:services
npm run dev:up
```

Set `POSTGRES_PORT` in `.env` if port 5432 is occupied. The Compose database binds
only loopback. Its volume persists across `npm run dev:down`.

A normal empty startup yields process/database health, `/v1/config` with
`ready:false`, and unavailable inference. It creates no example projects and
marks no provider canary complete. `node scripts/smoke-unconfigured.mjs` checks
this state on an empty local stack.

For a configured deployment, mount its reviewed manifest under
`artifacts/local/` and set `TELLIGENCE_MANIFEST_FILE=/app/runtime/base.json`,
`BASE_RPC_URL`, and reviewed prices in `.env`. Enable the optional worker:

```sh
docker compose --profile compute up --build --wait control-worker
```

Worker readiness fails until its runtime pins and dependencies validate. Keeper
execution remains disabled unless explicitly enabled with a separate gas key.
Local deterministic providers exist only in test transports. Do not set
production database rows to ready or insert fabricated canary timestamps to
make a development screen look live.

## Factory policy versions

New operator-allocation launches require factory policy version **2**. The
frontend checks the verified version before using its version-2 launch ABI;
existing version-1 projects remain fundable and submitted registrations remain
resumable. Generated manifests record the actual onchain version. The gateway
verifies that version with runtime and identity at one safe Base block and
persists the verified value, never client-supplied policy metadata.

Daily compute goals are optional metadata. Existing explicit project caps remain
unchanged during migration; new projects have no cap inferred from a fundraising
goal. Key limits, aggregate verified provider daily credit, remaining credit,
and outstanding reservations always constrain inference.

## Contract deployment and manifest

First run the stock-protocol integration/invariant suites and the explicit Base
fork suite. The fork runs locally and spends no live funds:

```sh
npm run test:contracts
cd contracts
RPC_BASE_MAINNET=https://mainnet.base.org forge test --match-path 'test/fork/**'
forge build src/TelligenceFactory.sol src/TelligenceComputeVaultDeployer.sol --sizes --skip '*/test/**' --skip '*/script/**'
```

The manual **Base integration fork** GitHub workflow runs the same suite with
the repository's explicitly configured `RPC_BASE_MAINNET` secret. It fails if
that archive RPC is missing; it does not skip the suite or broadcast a transaction.

Review the source and actual Base deployment before simulating
`contracts/script/Deploy.s.sol:Deploy`. It requires `REVNET_DEPLOYER` and its
reviewed `REVNET_DEPLOYER_CODEHASH`, checks Base and the expected Venice staking
implementation, and deploys the immutable adapter deployer and factory.
`forge script ... --rpc-url "$RPC_BASE_MAINNET"` simulates. Broadcasting requires
an explicit separate command and a controlled signing account.

Generate a fresh manifest from the deployed factory, the independently reviewed
Revnet deployer address, and a reviewed economic-policy JSON file:

```sh
BASE_RPC_URL="$RPC_BASE_MAINNET" node services/control-worker/create-manifest.mjs \
  --factory "$TELLIGENCE_FACTORY" \
  --revnet-deployer "$REVNET_DEPLOYER" \
  --launch-policy /path/to/reviewed-launch-policy.json \
  --output /path/to/new-base-manifest.json
```

The generator only reads RPC state and local build artifacts. It never signs,
simulates, broadcasts, or funds a transaction. `--factory`,
`--revnet-deployer`, `--launch-policy`, and `--output` are mandatory. Artifacts
come from `contracts/out` by default; `--artifacts` selects another reviewed
build. The output is created with `wx` and cannot replace an existing manifest.
Wait until the deployment exists at Base's `safe` block: the generator does not
fall back to `latest`.

Every getter, runtime, and proxy-slot read uses that same identified safe block
number. Its hash is checked again before output. The generator derives and pins
the factory, Revnet deployer, compute-vault deployer, terminal, controller,
project registry, canonical VVV, staking proxy, and DIEM. It includes detected
EIP-1967 implementations and requires the reviewed Venice implementation
`0xe37A7920dbc11253ac6d031C29f592f71B348DCA`. Changed token identities, decimal
contexts, missing code, or a changing block stop generation.

The factory and compute-vault deployer must match the local compiled runtime,
masking only the compiler's bounded immutable-reference words. The manifest
records raw artifact SHA-256 values, compiler/settings, source-file Keccak
hashes, the normalized-runtime comparison method, policy-file SHA-256, Base
block number/hash/timestamp, and the staking owner observed at that block.
An artifact comparison establishes correspondence with the selected build; it
does not establish an audit or independently verify the upstream Revnet source.
Review that deployment and the recorded provenance before promoting the file.

The policy JSON contains only reviewed decimal-string `conversionCadence`,
`minBatchTokens`, `maxBatchTokens`, `minVVVPerProjectToken`, `minDiemPerVVV`,
`maxPrincipal`, and `initialIssuance`. Choose them from economic simulations and
an explicit pilot cap. The generator validates the exact integer bounds, batch
ordering, and one-hour-to-30-day conversion cadence. It supplies no economic
preset. See `services/gateway/registry.mjs` and
`services/control-worker/README.md` for the runtime schema/checks.

With `BASE_RPC_URL` and `TELLIGENCE_MANIFEST_PATH` configured, run
`node services/control-worker/check-manifest.mjs` to compare every runtime pin
and staking implementation against the current Base state. Source revisions
and administrator changes still require release review; observed bytecode pins
alone are not independent source verification.

## Funded provider acceptance

A published ERC-1271 challenge is capability evidence. It does not prove account
bootstrap, DIEM credit linkage, or an inference request. Complete the bounded
canary in `docs/venice-integration.md` from the intended runtime environment:

1. Launch one capped project through the verified factory and reconcile its
   creator, wrapper, vault, signer, and onchain policy.
2. Complete vault-owned Venice identity activation using the restricted SIWX
   flow. Prove account identity and spendable DIEM agree with the vault's stake.
   The implementation does not authorize raw JWT API-key bootstrap signatures;
   that separate provider endpoint is not an implemented fallback.
3. Execute one explicitly capped request with no USD balance, top-up, fallback,
   or paid retry. Save redacted request identity, reservation, settled usage,
   provider balance changes, and chain evidence.
4. Rotate/disable the onchain signer and prove old credentials fail under the
   provider's actual validation/session behavior. Do not assert instantaneous
   revocation based only on a local mock.
5. Complete the notice and provider cooldown unwind. Reconcile recovered VVV
   and verify return to the same Revnet with no extra token issuance.
6. Review the complete evidence before enabling public contributions or marking
   a project's canary verified. An interrupted paid request keeps its uncertain
   reservation and is investigated before any replacement request.

The one-shot implementation is `services/gateway/canary.mjs`. It requires the
explicit `--execute-canary --project <uuid> --model <reviewed-model>` arguments,
the documented backend environment, and `TELLIGENCE_CANARY_API_KEY` belonging
to that project. The maximum reservation is hard-capped at one cent; startup
never runs this command. It persists prepared/submitted/uncertain states and
does not retry an ambiguous paid request. Use a fresh reviewed manual
`MODEL_PRICES_JSON` catalog for this explicit canary command. Successful mocked
canary tests are distinct from funded live evidence.

Do not hand ownership of DIEM to a hosted EOA to work around an integration
failure. Return-only onchain recovery remains available if the provider account
cannot be activated.

## Health, observability, and incident recovery

Use process liveness for restarts and dependency readiness for traffic admission.
A provider outage must not repeatedly restart every container. The worker's
readiness is stricter than gateway database readiness; neither substitutes for
the project's canary and fresh capacity checks.

Drain gateway connections before replacing a process. Its shutdown allows up
to 130 seconds for requests; Compose gives it a 140-second stop grace period.
Configure the hosting platform's termination window accordingly. An interrupted
request retains its durable reservation even if the process cannot finish
settling it.

### Request lifecycle and crash recovery

Every reservation records the gateway instance that created it. The gateway
commits a `dispatched_at` marker after the signer has produced the request's
authentication and before any bytes reach the provider; a failed marker write
never forwards. Each instance heartbeats every five seconds and marks itself
stopped after draining. At startup and every 30 seconds a gateway recovers
orphans, which are `reserved` rows whose instance is stopped, silent for more
than 60 seconds, or unknown:

| Orphan | Proof | Result |
| --- | --- | --- |
| Tracked instance, no `dispatched_at` | Never sent | `released`, audit `usage.recovered_undispatched` |
| Tracked instance, `dispatched_at` set | May have been billed | `uncertain`, audit `usage.recovered_uncertain` |
| Row predating instance tracking | Unknown | `uncertain` |

Released rows stop counting toward budgets and concurrency. Uncertain rows keep
charging their maximum across epochs until reconciled with provider evidence
(`node gateway/reconcile.mjs --retain-maximum`) or, when no provider identity
was captured before the crash, explicitly retained at full maximum in both the
original and current epoch (`--retain-unproven`). Neither path refunds. A
duplicate idempotency key after recovery is still refused. Recovery is
idempotent and safe to run from several instances at once.

### Capacity observation and aging

The worker refreshes capacity in its own loop, eight projects at a time, each
time-boxed to 25 seconds, independently of receipt audits, keeper execution,
and planning. Runtime pins are re-verified once a minute rather than once per
project. The gateway treats an observation as fresh for 30 seconds and usable
for up to 180 seconds (`capacityGraceMs`). An aging observation is still safe
because every reservation and settlement since the observation is subtracted
from it, its UTC epoch must match, and the provider itself validates the
onchain signer state on every request; a reorg or signer change clears the
observation immediately. Beyond the grace window admission stops. Project
snapshots report `capacity.freshness` as `fresh`, `aging`, or `stale`.

### Database restoration

1. Restore the backup into an isolated database and run `npm --prefix services run migrate` against it with the owner connection.
2. Run `node services/db/restore-check.mjs --checkpoint <ISO:count>` with the checkpoint stored outside the database and `BASE_RPC_URL` set. It reports outstanding and uncertain usage, gateway instances, keeper job states, and every unfinished keeper intent compared with the chain. Exit status 1 means do not route traffic.
3. `RESERVED_ROWS_AWAIT_GATEWAY_RECOVERY` clears itself when a gateway starts and recovers orphans. `LEDGER_BEHIND_CHECKPOINT` means usage was lost: keep `EXPECTED_LEDGER_CHECKPOINT` set so the gateway refuses reservations (`ledger_untrusted`) until provider usage has been reconciled into the ledger; never restart with an emptier ledger.
4. `INTENT_NONCE_CONSUMED_WITHOUT_RECEIPT:<job>` means a broadcast happened after the backup. Keep keeper execution disabled, establish the canonical receipt for that nonce, and repair the job record before enabling execution. The worker never replays or re-signs an intent.
5. Only then point the service roles at the restored database and re-enable traffic.

### Signer encryption key rotation or recovery

1. Generate a new 32-byte key. Set it as `SIGNER_ENCRYPTION_KEY` on the signer and move the old value to `SIGNER_ENCRYPTION_KEY_PREVIOUS`; the signer decrypts with either while rotation proceeds.
2. On the signer host run `node auth-signer/rotate-encryption-key.mjs --check`, then `--rotate`. Rows the new key already reads are skipped; a row neither key reads aborts the whole rotation without partial writes.
3. When `--check` reports zero rotatable rows, remove `SIGNER_ENCRYPTION_KEY_PREVIOUS` and store the new key offline.

If the key is lost with no backup, the stored signers are unrecoverable. Prepare
a new signer for each project and have the creator or recovery authority call
`setInferenceSigner` onchain, then `POST /v1/projects/:id/signer`; return-only
recovery never depends on the hosted signer.

### Keeper reconciliation after an incident

Run `node services/db/restore-check.mjs` with `BASE_RPC_URL` before enabling
`KEEPER_EXECUTION_ENABLED`. Quarantined jobs and consumed-nonce intents are
resolved only by recording the canonical receipt, never by deleting the intent
or re-signing with a fresh nonce.

Alert on stale provider observations, rejected runtime pins, signer-generation
mismatch, stuck/uncertain reservations, old job leases, failed receipts,
nonce/replacement uncertainty, failed migrations, database backup failures, and
inference 5xx/latency. Keep request bodies, completions, authorization headers,
cookies, SIWX messages, and provider responses out of logs/APM. Request IDs,
project IDs, model, latency, and numeric usage are enough for routine diagnosis.

A stolen application key is revoked in the creator console. A compromised
inference signer requires onchain authentication disable/rotation plus provider
reconciliation: it can use Venice directly outside gateway quotas. Rotate a
signer caller credential on that caller and the signer together; the gateway
and worker credentials are independent. A compromised worker credential can
only read balances. A compromised gateway credential can obtain inference
signatures only for reservations that exist in the ledger and have not been
dispatched, so every signature it obtains is accounted for. Preserve uncertain
usage and disable new requests until the ledger is trustworthy.

Take encrypted scheduled PostgreSQL backups and retain recovery points. Back
up the signer encryption secret separately with restricted access. Restore a
backup into an isolated database, run migrations and read checks, verify project
identity/key hashes/reservations/jobs, and compare provider usage before routing
traffic. A restored old ledger must not reopen already consumed budget. If
usage cannot be reconciled, keep inference unavailable. Do not reset or delete
uncertain reservations merely to recover apparent credit.

If the signer encryption key is lost, use creator/recovery-controlled onchain
signer rotation to restore authentication after preparing a new binding, or
complete the return-only winddown. Backing recovery does not depend on the
database, hosted signer, gateway, or worker. The `/recover` interface uses the
independently pinned factory and Base RPC when the gateway is unavailable.

## Release and rollback

Root `.github/workflows/release-container.yml` calls the complete reusable CI
gate, then publishes four images under `ghcr.io/OWNER/REPOSITORY/{web,gateway,
auth-signer,control-worker}` from the same revision. Protect the GitHub
`production` environment and configure its public build variables. Releases
publish immutable SHA tags and version tags, SBOMs, provenance, and attestations;
there is no `latest` tag. Publishing an image does not deploy it.

Deploy by digest and save the previous digest, configuration, manifest, schema
version, and release evidence. Roll back application processes to those exact
artifacts only if the current schema remains compatible. Do not restore an old
database as a routine code rollback: it can erase consumed quotas or transaction
intents. After rollback, verify health, project identity, unavailable states,
creator sessions, key metadata, and an unsubmitted wallet review before reopening
traffic. Contract deployments and irreversible winddown decisions do not roll
back with container images.
