# Telligence gateway

The public service provides creator administration and a deliberately small OpenAI-compatible text inference API. Every production request uses PostgreSQL; there is no memory-store fallback. The gateway cannot decrypt the separately encrypted inference signer keys.

## Run

From the repository root, install `services` dependencies, supply the variables in `services/.env.example`, run `npm --prefix services run migrate`, then `npm --prefix services run start:gateway`. The shared Docker image and `gateway/railway.toml` use the same entry point. Missing deployment or reviewed pricing disables the corresponding operation, while public project snapshots remain available.

`GET /healthz` checks the process. `GET /readyz` checks database connectivity. These are service-health checks; they do not assert funded Venice activation or audited contracts. `GET /v1/config` reports deployment readiness, actual creation fee and the explicitly configured economic preset. `policyVersion` is the verified factory version when ready and `null` when deployment verification is unavailable; clients must require version 2 for the operator-token-allocation launch ABI.

## Public API

| Request | Result |
| --- | --- |
| `GET /v1/config` | Base deployment configuration, launch policy, current creation fee, and readiness |
| `GET /v1/projects` | `{projects: ProjectSnapshot[]}`; latest 100 projects |
| `GET /v1/projects/:id` | `{project: ProjectSnapshot}` |
| `POST /v1/auth/challenge` | `{address}` → `{challengeId,message,expiresAt}` |
| `POST /v1/auth/verify` | `{challengeId,signature}` → creator session, CSRF token, HttpOnly cookie |
| `GET /v1/auth/session` | `{address,expiresAt,csrfToken}` |
| `POST /v1/auth/logout` | Revoke the current creator session |
| `POST /v1/projects/prepare` | Prepare a separately encrypted signer → `{preparationId,inferenceSigner,expiresAt}` |
| `POST /v1/projects` | Register a confirmed factory deployment; body below |
| `GET /v1/projects/:id/keys` | Metadata only, never bearer secrets |
| `POST /v1/projects/:id/keys` | `{name,dailyLimitUsd,expiresAt?}` → `{key,secret}`; show the random secret once |
| `DELETE /v1/projects/:id/keys/:keyId` | Revoke application access without resetting quota |
| `GET /api/v1/requests/:id` | Durable request state and accounted usage for the same project; application bearer required |
| `GET /api/v1/models` | Current explicitly approved models; application bearer required |
| `POST /api/v1/chat/completions` | Bounded text inference; application bearer required |

Creator mutations require the same original allowed web `Origin`, a valid session cookie and `X-CSRF-Token`. Preparing/registering projects or changing keys requires authentication within the last 15 minutes. Sessions expire after one hour; expired/recent-auth failures return 401. Wallet challenges expire after five minutes and are consumed atomically. EOAs and Base ERC-1271 creator wallets are verified against the original stored challenge.

Registration accepts:

```json
{
  "preparationId": "UUID from prepare",
  "revnetId": "confirmed Base project ID",
  "wrapperAddress": "0x...",
  "vaultAddress": "0x...",
  "name": "Project name",
  "purpose": "What this compute will accomplish",
  "workload": "Expected text inference workload",
  "targetDailyCreditUsd": null
}
```

`targetDailyCreditUsd` is optional metadata: omit it or send `null` when the creator does not yet know their daily usage. A supplied value must be a positive decimal string with at most six fractional digits and at most nine integer digits; zero, blanks, numbers and malformed strings are rejected. Project snapshots return `null` for an unset target. The target neither estimates required funding nor allocates credit or sets an inference spending cap. New projects rely on explicitly chosen key limits and the shared verified provider allowance. Existing project caps remain enforced and are preserved by migration.

The server verifies the factory runtime, actual `POLICY_VERSION`, original creator, wrapper, vault, policy commitment and prepared inference signer at one identified safe Base block, then checks that block hash again before binding a project. Supported factory versions are 1 and 2; unknown versions fail closed. The stored `policyVersion` comes only from that verified factory getter, never the request body. Migration preserves historical row versions and removes the old default so future inserts must supply their verified version. A confirmed deployment can claim its original unused preparation even after its preparation timer expired. Repeating the same registration after a lost response returns the existing project; immutable identity changes fail, and retries cannot overwrite metadata. Preparations must not be deleted merely because the timer elapsed: an onchain deployment may still refer to their signer.

## Inference policy

Applications send `Authorization: Bearer tlg_…` to the `/api/v1` base URL. Only text messages, approved models and explicit output limits are accepted. There are no image inputs, remote tools, web search, arbitrary provider parameters, model fallbacks or account administration routes. The gateway explicitly disables the provider's added system prompt, search and optional thinking defaults to keep quoted workloads bounded. Review a model's actual output-limit semantics before adding it to the catalog.

`MODEL_POLICY_JSON` is the production configuration: approved model IDs, token limits and integer micro-USD price ceilings. The gateway refreshes the free provider model catalog every minute, gives each observation a five-minute lifetime, and accepts only available nonreasoning models whose DIEM prices and token limits fit the reviewed policy. The provider cannot add models or raise ceilings. `MODEL_PRICES_JSON` is an alternative explicit observation with `validUntil` within the next 24 hours; supply exactly one mode. Unknown, contradicted or expired catalogs fail before reserving or forwarding. Per-request input bounds use UTF-8 bytes plus conservative message framing; output bounds must cover every billed output token. Accounted usage is conservative quota usage at the approved price ceiling, rather than an exact provider invoice. Cached tokens use the noncached upper price. A model that violates these bounds remains unavailable until its policy is corrected.

Before sending anything paid, a PostgreSQL transaction locks the project, rechecks its key, then reserves the maximum cost against the key limit, shared provider daily allowance, fresh remaining provider capacity and any existing explicit project cap. It subtracts active/uncertain requests across epoch boundaries and settled requests not reflected in the provider snapshot. Key rotation and provider refresh cannot erase spending. Integer accounting never converts money through JavaScript floating point.

Application traffic reaches `/api/v1` directly at the gateway's public base URL (`apiBaseUrl` in `GET /v1/config`); the website proxy carries only browser session traffic and is not in the inference path.

Every reservation records the gateway instance that created it. After the signer returns the request's authentication, the gateway commits a `dispatched_at` marker before the provider request is sent; a failed marker write releases the reservation without forwarding. Instances heartbeat and mark themselves stopped after draining. At startup and every 30 seconds the gateway recovers orphans left by stopped, silent, or unknown instances: reservations with no dispatch marker from a tracked instance are released, everything else becomes uncertain. Recovery is idempotent and concurrent-safe; see `DEPLOYING.md`.

The transport sends exactly one request to `https://api.venice.ai/api/v1/chat/completions`, with only the server-constructed content type and short-lived vault authentication header. Redirects and automatic paid retries are disabled. Responses, SSE events, concurrency, request duration and request bodies are capped. Stream settlement requires valid final usage and `[DONE]`. Partial streams, provider failures and network ambiguity retain the maximum debit. Only failures proven to occur before forwarding release it. Failed settlement writes leave the original durable reservation intact.

`GET /api/v1/requests/:id` returns durable request state and accounted usage to a current key from the same project. It returns no prompt or completion content. Paid ambiguity returns HTTP 409 with `inference_unconfirmed` and a local `X-Request-Id`, reducing accidental retries by compatible clients.

`Idempotency-Key` is optional and rejects reuse with 409; it does not retry or cache inference content. Configure compatible SDKs with `maxRetries: 0` (or `max_retries=0`) and assign an idempotency key per logical request; reuse that identifier only when investigating the same attempt. A network disconnect cannot deliver a nonretryable HTTP response. Ambiguous requests must be investigated against provider evidence before any ledger correction. Never delete an uncertain reservation to restore apparent availability. Prior-epoch ambiguous work remains reserved because the provider may have charged it after reset.

## Service boundaries and privacy

Keep the signer on Railway private networking (`auth-signer.railway.internal`) with a separate service credential. The signer encryption key belongs only to that service. The gateway has no signing key, transaction key, principal access or generic signing endpoint. The keeper gas key is separately configured in the control worker.

Prompt and response content exists only in gateway memory during inference. Service code does not log content, bearer secrets, signatures or upstream error bodies. Public errors contain fixed messages and local request identifiers. Disable request-body, header and response capture in infrastructure/APM as well. A proxy still sees plaintext requests in memory, so it cannot inherit the provider's privacy claims without explaining this extra boundary.

Per-project capability remains `provisioning` until the explicitly capped canary has been completed. A green process health check or an onchain DIEM stake is not proof of usable inference. The worker accepts the provider's authenticated DIEM balance and fails closed if the identity, epoch, chain state or USD balance contradicts policy.

## Recovery

- A stolen application key can consume only remaining key and project quota; revoke it from the creator console. Issuing a replacement does not reset the project ledger.
- A stolen inference signer can use the provider directly until the onchain signer is disabled or rotated. The gateway quota is not a boundary for that direct access. Disable authentication on the vault, then reconcile provider behavior before re-enabling service.
- Restore PostgreSQL from backups before reopening traffic. Preserve reservations, nonce intents and key hashes; losing a debit ledger is not permission to restart it empty.
- Restore the signer encryption secret from a separately controlled offline backup. Losing it interrupts inference; it does not prevent return-only onchain recovery.
- An interrupted paid canary is not automatically retried. Preserve its run and reservation for provider investigation.

Run the gateway tests with `npm --prefix services run test:gateway`. The database and HTTP integration tests require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database. They use random project identities and contain clearly labeled provider fixtures. See `docs/implementation/backend-tdd.md` for the observed validation record.

## Explicit activation canary

After the deployment, account linkage and provider balance are ready, run this command deliberately from the service environment:

```sh
node gateway/canary.mjs --execute-canary --project PROJECT_UUID --model REVIEWED_MODEL
```

Supply `TELLIGENCE_CANARY_API_KEY` through a sealed environment variable containing a key for exactly that project. The command uses the ordinary price policy, request transport and PostgreSQL quota ledger. Its fixed request asks for `OK`, permits 16 output tokens, and cannot reserve more than $0.01. It records the provider epoch, chain evidence, measured DIEM debit and settled reservation before marking that project generation usable.

There is one durable canary per project and signer generation. Re-running a completed canary returns its stored evidence without another inference. Re-running an incomplete or ambiguous canary fails; inspect the original ledger and provider account before any operator repair. The command never deposits, swaps, signs a financial transaction, tops up USD or automatically retries a paid call. A successful per-project canary is activation evidence; it does not replace the separate release tests for signer revocation and complete return-only recovery.


## Authentication recovery

After a creator confirms `setAuthenticationEnabled` onchain, use `POST /v1/projects/:id/authentication/sync` with `{}` to synchronize the confirmed generation. After preparing a new signer and confirming `setInferenceSigner` onchain, use `POST /v1/projects/:id/signer` with `{preparationId}`. Both routes require the current creator session, recent authentication and CSRF token. They compare safe and latest Base signer state and cannot execute an onchain transaction. A generation change invalidates the prior canary and requires a new capped activation proof. Every quota and prior reservation remains intact. Existing preparation records remain bound to the original project so a delayed response cannot strand recovery.

## Proven reconciliation without refunds

Inspect a durable reservation from the operator environment:

```sh
node gateway/reconcile.mjs --inspect --reservation REQUEST_UUID
```

The explicit `--retain-maximum` mode additionally needs `VENICE_RECONCILIATION_ADMIN_KEY`, supplied only to this short-lived operator command. Never put that provider admin credential in the gateway, signer, browser or routine worker. The command reads only the fixed Venice DIEM billing-history endpoint. It requires the exact provider completion ID captured during the original request, matching model/currency/output billing and admission time. A supplied admin credential is not treated as proof by itself.

A successful reconciliation retains the full original maximum debit. If the original request belonged to a prior epoch, it also creates a linked full-maximum current-epoch retention debit before releasing the timeless outstanding state. Repeating the command is idempotent. Provider billing exceeding the admitted maximum suspends the project instead of accepting an unsafe bound.

`--retain-unproven` is the explicit path for an `uncertain` reservation that captured no provider completion ID, typically a crash after dispatch. It charges the full maximum in the original epoch and, when later, again in the current epoch, records an operator attestation as evidence, and is idempotent. It refuses rows that are still `reserved` (gateway recovery handles those), already final, or correlatable through a provider ID.

There is no refund, TTL expiry, forced-clear or inference retry mode. Missing completion IDs, absent positive DIEM evidence, unavailable provider-admin access, or unsupported ledger schemas leave capacity held. A vault using only SIWX may have no obtainable admin credential; this implementation does not invent a bootstrap or weaken signature restrictions to obtain one. Those requests require provider investigation. The command's metadata and evidence contain no prompts, completions or credential values.
