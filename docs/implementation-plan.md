# Implementation and validation plan

This document preserves the original design plan. The contracts, webclient, PostgreSQL services, Railway packaging, and deterministic tests are now implemented. See [the repository README](../README.md), [implementation evidence](implementation/), and [deployment instructions](../DEPLOYING.md) for the current executable layout and checks. Remaining release evidence includes a funded Venice account/credit canary and external review; local and Base-fork tests do not establish provider account activation.

## Repository boundary

The new project lives at `~/Documents/jb/v6/evm/extensions/telligence`. The existing project at `../plugin` remains separate. The current session directory `~/Documents/telligence` contains older visual artifacts and is not the source repository to rename or fork.

Inspected frontend baseline:

```text
Local source: /Users/jango/Documents/jb/v6/evm/webclients/revnet-money
HEAD: e23a69e7ce060672d131bee461778179bcb026bf
Origin: https://github.com/mejango/revnet-money.git
Upstream: https://github.com/rev-net/revnet-app.git
Worktree: clean when inspected
```

The inspected baseline used Next.js 16.2.11 App Router, React 19.2.8, wagmi/viem, Nana SDK and an npm lockfile. Its full Git history was retained and its files moved under `web/`; dependency patches are recorded in the current lockfile. Its transaction review, simulation, wallet identity, and Safe confirmation boundaries remain in use.

The inspected local Revnet v6 source was at `5093359f561c0546c29b85147a9cc0de2f608ddf`, with unrelated test-file changes present. Those changes were not modified. Local source behavior must be checked against the actual selected Base deployment and pinned runtime/implementation code.

Proposed structure:

```text
telligence/
  web/                       # Revnet-money frontend fork
  contracts/                 # Factory, policy, vault, auth validation
  services/gateway/          # Compatible inference endpoint and budgets
  services/control-worker/   # Onboarding, reconciliation, keeper
  services/auth-signer/      # Narrow provider-authentication service
  packages/policy/           # Versioned schemas, generated ABI/address manifests
  docs/                      # Design, source evidence, decisions, runbooks
  scripts/                   # Capability discovery and reproducible verification
```

## Phase 1: prove the provider boundary

Build the minimal vault/authentication canary before polishing fundraising screens. Verify current canonical token addresses and implementation bytecode on Base at a pinned block; import only needed verified interfaces. Test the actual staking signatures, receiver semantics, mint positions, rounding, cooldowns, approvals, and owner-controlled provider parameters.

Pass criteria:

- Vault-owned stake and DIEM are recognized by a distinct Venice identity.
- Custom ERC-1271 bytes are accepted; authentication works with no principal-owning EOA.
- One capped inference request spends only that vault's DIEM credit.
- Expired, cross-chain, cross-vault, malformed, injected, generic and financial signatures fail.
- Authenticated inference cannot mint unrevocable administrative credentials.
- Signer disable/rotation is measured against existing headers/sessions; no false promise of instantaneous revocation.
- Usage and state reconcile across a reset, exhausted quota, provider errors, and interrupted streams.
- Unwind recovers the expected assets to the same vault, then only to its Revnet.

Current completed check: live capability discovery advertises Base ERC-1271. Account linkage and funded requests are not complete. Keep the capability checker as a deployment diagnostic, not a substitute for this canary.

## Phase 2: model and build the wrapper

Simulate several candidate production splits and cashout taxes using full route quotes. Cover direct issuance, buyback payments, terminal and AMM cashouts, small and large raises, repeated funding, production-distribution timing, quote changes, liquidity/TWAP changes, other holders cashing out or borrowing, stage transitions, fees and gas. Choose presets from actual daily capacity delivered per contribution, not an arbitrary production percentage.

Implement the factory and narrow policy wrapper with the compute vault as a pinned destination. Prove deployment atomically binds project ID, policy and vault. Keep core Revnet contracts and standard buyback routing unchanged. Pin VVV accounting and chain 8453 onchain; reject unsupported policy/stage/split/bridge configurations. No custom buyback hook or registry-owner allowlisting is required.

Use Foundry fork tests and stateful invariants for real asset conservation and authority boundaries. Include malicious split callbacks, reentrant adapters, bad approvals, caller-selected destinations, rounding dust, repeated tiny batches, factory front-running, duplicate jobs, cooldown resets, and late contributions during winddown. Verify production distribution from both direct issuance and buyback burn/remint flows. Test cashouts in the presence of stock Revnet loans even though the wrapper never borrows. Verify AMM cashout proceeds are measured by the wrapper's VVV balance delta even when the terminal reports zero reclaim, and that the wrapper reverts the entire transaction if its policy minimum is missed.

Verify reward returns do not mint project tokens or become a withdrawable operator allowance. Verify closed-project cleanup and recovery without any Railway process. External review should cover new contracts and the full integration; inherited upstream audits do not cover the adapter.

## Phase 3: build the control plane and gateway

Define stable database keys and state transitions before background workers:

- `projects`: chain/project/wrapper/vault/policy identity, creator roles and status.
- `provider_bindings`: vault-address identity, bootstrap state, encrypted provider secrets, signer generation.
- `api_keys`: nonsecret ID, keyed secret hash, project/scope/limits/expiry/revocation.
- `usage_reservations`: request ID, project/key/provider epoch, maximum reservation, final charge or uncertain state.
- `chain_events`: chain, transaction hash, log index and block hash; provisional/finalized/reverted status.
- `jobs`: unique operation identity, lease, transaction hash, retry state, preconditions and observed result.
- `audit_events`: administrative changes and redacted operational evidence.

Enforce foreign keys and uniqueness to prevent cross-project identity substitution. Use database transactions for project/key quota updates and per-project job leases. Reconcile from chain state and provider balance, not event delivery alone. Handle restart, reorg, duplicate delivery, dropped transactions and replacement receipts explicitly.

Run gateway integration tests with a deterministic provider fixture for concurrent quota reservations, 00:00 UTC boundaries, double submission, restart during a stream, unknown prices, expired credentials, cross-project keys, log redaction and no paid fallback. Then run the capped live canary from the intended Railway environment.

Prepare Railway services, environment schema, Docker/build configuration, health checks, database migrations, backup/restore and signer recovery instructions. Deploy after this result is concrete and reviewed; logged-in account access is available, but it does not supply the canary vault's funds or prove provider activation.

## Phase 4: import and adapt the frontend

Preserve these existing boundaries:

| Source module | Purpose |
|---|---|
| `src/lib/transaction-review.ts`, `src/hooks/useReviewedWriteContract.ts` | Reviewed, simulated wallet writes |
| `src/lib/waitForReceipt.ts`, `src/lib/transaction-activity.ts` | Submission/proposal/execution tracking |
| `src/lib/bendystraw/*` | Registered and validated query transport |
| `src/app/[slug]/*` route resolution/fallback | Stable project identity and onchain fallback |
| Metadata/IPFS helpers | Bounded metadata and media handling |
| Existing wallet/protocol/environment/deployment checks | Preserve applicable safety coverage |

Replace generic creation/discovery/project views with:

1. Creator: purpose, intended workload, target daily credit, beneficiaries and public policy terms.
2. Supporter: contribution, estimated added daily credit, allocation/exit terms, transaction confirmation.
3. Project page: purpose, real capacity, today's usage, service state, funding history and progress updates.
4. Creator console: key creation/rotation, base URL and sample request, per-key limits, status and winddown.
5. Inspect view: complete assets, policy, recipients, token rights and verified contract references.

Do not inherit these upstream defaults blindly:

- `wagmiTransports.ts` supports multiple chains. Restrict clients, queries, routes, transaction construction and server validation to Base.
- `src/app/create/helpers/parseDeployData.ts` always sets `REV_METADATA_ALLOW_SUCKER_DEPLOYMENT`. Clear it in every stage and use empty sucker deployment configuration.
- The same builder creates a default 721 store. Use an explicit empty configuration and remove unneeded tier/mint privileges.
- `src/lib/paymentTerminal.ts` optimizes for tokens returned to the beneficiary. Retain standard Revnet buyback support, while requiring the Telligence support path to preserve production splits. Exclude `skipSplits` and bare AMM purchases that bypass that allocation. Simulate both the production tokens delivered to the wrapper and their realizable VVV value. Track net treasury credit separately; it can differ from the supporter's input. On wrapper cashout, permit standard AMM routing and enforce minimum actual VVV received through a balance-delta check, rather than relying only on terminal `minTokensReclaimed` or its return value.
- Custom token symbol/decimal checks do not establish canonical VVV identity. Validate the address and exact currency mapping.
- Hiding token/loan/bridge pages is not an authority restriction. Contract policy must enforce the narrower powers.

Use capacity ranges and timestamped quotes. Never label submitted transactions or issued-but-unfunded keys as ready compute. Distinguish daily exhaustion, rate limiting, pending allocation, provider outage and key revocation in human language.

## Release evidence

Before accepting public contributions, retain the pinned source/deployment manifest, complete canary transaction and usage trace, tested recovery trace, invariant/fork-test results, gateway isolation/concurrency results, frontend funding receipt tests, and external review of new contracts. Launch with one capped pilot project; increase capacity and project count only after observed reconciliation and recovery meet the design criteria.

The deployment manifest needs: Base block number/hash, canonical addresses, proxy implementations if any, runtime hashes, source revisions, relevant parameter/admin values, ABI digests, policy version and the test evidence date. A familiar address or successful UI request is not sufficient provenance.

No current document claims a completed audit, principal guarantee, funded integration, or production service.
