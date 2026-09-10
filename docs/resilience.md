# Dependencies, authority, and what each failure stops

Revised 2026-09-10 for the resilience hardening pass. Everything here describes
the current source and the Railway deployment settings; it is not evidence that
the funded Venice integration works. See
[venice-native-key.md](venice-native-key.md) for that gap.

## Dependency map

| Dependency | Who needs it | What stops without it | What keeps working |
| --- | --- | --- | --- |
| Website (Next.js on Railway) | Browsers | Creator sign-in, key management, funding UI | Application inference and request status (direct to the gateway); onchain recovery; the last saved project copy is served with a stale notice while the gateway is down |
| Gateway (public) | Applications, website | New inference, key management, project reads | Everything onchain; existing keeper work; recovery page |
| Auth signer (private) | Gateway, worker | New inference (no fresh authentication); capacity refresh | In-flight streams already authenticated; onchain recovery |
| Control worker (private) | Gateway (observations) | Observations age; inference stops after the 180-second grace window; keeper operations pause | Inference within the grace window; creator administration; onchain recovery by anyone |
| PostgreSQL | All three backends | All hosted operations | Onchain recovery; the ledger is restorable per `DEPLOYING.md` |
| Base RPC (backend) | Worker, gateway registration | Capacity refresh, project registration, keeper | Inference within the grace window; recovery through the user's own RPC on `/recover` |
| Base RPC (website) | Browser reads and writes | Funding and recovery reads through default providers | `/recover` accepts a user-supplied RPC URL |
| Venice API | Worker (balance), gateway (inference) | Inference and fresh observations | Ledger, keys, sessions, onchain recovery |
| Venice contracts on Base | Vault, worker | Allocation and unwind semantics are theirs; upgrades are an external trust | Nothing here can prevent an upstream upgrade |

## Authority map

| Credential | Held by | Can | Cannot |
| --- | --- | --- | --- |
| `telligence_gateway` DB role | Gateway process | Sessions, keys, reservations, project registration, audit rows | Delete anything; read signed keeper transactions; alter schema |
| `telligence_signer` DB role | Signer process | Read vault identity, encrypted signers, reservation state; insert preparations | Read key hashes, sessions, amounts; update bindings |
| `telligence_worker` DB role | Worker process | Project status, capacity observation columns, keeper tables | Read encrypted signers, key hashes, reservations; change signer or creator |
| Migration owner | Gateway pre-deploy step only (`MIGRATION_DATABASE_URL`) | Schema and grants | Is never opened by the gateway process |
| Gateway signer credential | Gateway | Prepare signers; inference signature for a durable undispatched reservation | Balance-only or arbitrary signatures; signatures without a ledger row |
| Worker signer credential | Worker | Balance (resource 3) signatures | Inference signatures; preparations |
| `SIGNER_ENCRYPTION_KEY` | Signer only | Decrypt inference signers | Move assets; the signer key itself signs only the fixed authentication envelope |
| Inference signer (EOA, encrypted) | Signer service | Authenticate the vault to Venice | Transfer, approve, execute, or administer anything onchain |
| Keeper gas key | Worker (disabled in production) | Broadcast prescribed policy operations | Choose destinations or amounts outside contract policy |
| Creator wallet | Creator | Inference keys, pause, announce winddown, rotate signer | Redirect assets |
| Recovery wallet | Recovery authority (required, distinct from creator at launch) | Announce winddown, rotate signer | Redirect assets |
| Anyone | Public | Advance an announced unwind through the vault's state machine | Start it |

Remaining compromise impact, by component:

- **Gateway container**: plaintext prompts in memory; keys hashed with the pepper; can create reservations and thereby obtain inference signatures for them (all accounted); environment carries the migration owner URL for the pre-deploy step.
- **Signer container**: can decrypt every project's inference signer and use Venice directly outside gateway quotas until the creator or recovery wallet rotates or disables the signer onchain. One encryption key still protects all projects; rotation is supported, per-project keys are not.
- **Worker container**: can mark capacity unavailable (denial of service), read balances, and, only if execution were enabled, spend gas on prescribed operations.
- **Website**: can phish creator sessions for its own origin; cannot touch application traffic.

## Request lifecycle

```text
reserve ──► sign (signer checks the row) ──► dispatched_at commit ──► provider request
   │              │                               │                         │
   crash          crash                           crash                     crash
   │              │                               │                         │
 released      released                       uncertain                 uncertain
 (proven undispatched by a tracked instance)   (may have been billed; reconcile or retain-unproven)
```

Recovery runs at gateway startup and every 30 seconds, treats a stopped or
60-second-silent instance as dead, is idempotent under concurrent instances,
and never changes rows of a live instance. Rows written before instance
tracking existed are held as uncertain. Budget and concurrency accounting are
in `services/gateway/store.mjs`; the proof is `services/gateway/test/lifecycle.test.mjs`.

## Evidence produced by this pass

| Claim | Test or check |
| --- | --- |
| Crash at each boundary, duplicate keys, concurrent recovery, UTC rollover | `gateway/test/lifecycle.test.mjs` (7 cases), `gateway/test/inference.test.mjs` (dispatch marker cases) |
| Unproven orphans can only be charged at maximum, twice across epochs, once | `gateway/test/reconcile.test.mjs` |
| Capacity loop survives a hung maintenance loop; 48 projects refresh in under a second at 30 ms latency; a hung dependency marks one project | `control-worker/test/scheduler.test.mjs` |
| Aging observations admit within grace, never across epochs | `gateway/test/lifecycle.test.mjs` |
| Worker credential cannot obtain inference signatures; inference signatures need a live reservation | `auth-signer/test/server.test.mjs` |
| Each DB role runs its real code paths and is denied the rest | `db/test/operations.test.mjs` |
| Key rotation is atomic and refuses undecryptable rows | `db/test/operations.test.mjs` |
| Restore check flags lost ledger rows and consumed keeper nonces | `db/test/operations.test.mjs` |
| Website is out of the inference path; stale project copy during outage; recovery requires a distinct wallet and accepts a user RPC | `web/test/*` (see the web commit) |

Run: `TEST_DATABASE_URL=… npm --prefix services test` and `npm --prefix web test`.

## Still unproven

Funded Venice vault authentication, account bootstrap, DIEM linkage, credit
recognition, session revocation, and complete unwind have not been exercised
end to end. Native scoped keys for a contract wallet remain unproven; the
bounded acceptance procedure is in [venice-native-key.md](venice-native-key.md).
Public fundraising and inference stay disabled until that evidence exists.
