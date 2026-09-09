# Invariants

These are review boundaries, not a claim of external audit or provider
availability. Update the relevant tests when a boundary changes; explain any
intentional semantic change in the PR.

| Boundary | Required behavior | Principal tests |
| --- | --- | --- |
| Chain and accounting | Factory projects are on Base with canonical VVV accounting. The creator cannot broaden operators, stages, bridges, or destination policy after deployment. | `contracts/test/unit/ProjectPolicy.t.sol`, `contracts/test/integration/TelligenceLifecycle.t.sol` |
| Atomic identity | Factory registration binds project, creator, wrapper, and vault atomically. A hosted registration cannot substitute another deployment or creator. | `contracts/test/integration/TelligenceLifecycle.t.sol`, `services/gateway/test/` |
| Creator token allocation | Version 2 locks separate compute and creator beneficiaries, leaves a positive funder share, and preserves their reserved-token ratio across stages. Creator token cashouts use ordinary holder rules; creator tokens grant no new vault or protocol authority. | `contracts/test/integration/TelligenceOperatorSplit.t.sol`, `contracts/test/economics/OperatorSplitEconomics.t.sol` |
| Backing custody | VVV, sVVV, DIEM, and DIEM stake remain in the project vault. The inference signer cannot transfer them, choose a withdrawal destination, or execute arbitrary calls. | `contracts/test/TelligenceComputeVault.t.sol`, `contracts/test/TelligenceVeniceAuth.t.sol` |
| Cashout accounting | Production allocations follow stock Revnet routing. Compute funding is measured from actual VVV balance change, including AMM cashouts where the terminal return value is zero. Minimums apply to actual proceeds. | `contracts/test/integration/StockV6Accounting.t.sol`, `contracts/test/unit/ProjectPolicy.t.sol` |
| Returns | Recovered backing and rewards go only to the same Revnet with `addToBalanceOf`; returning assets does not mint new supporter tokens or refund original donors individually. | `contracts/test/TelligenceComputeVault.t.sol`, `contracts/test/integration/TelligenceLifecycle.t.sol` |
| Winddown | Activation cannot race winddown. Cooldown claims follow actual provider state, cannot silently restart a pending cooldown, and remain callable without a Railway process. | `contracts/test/TelligenceComputeVault.t.sol`, `contracts/test/fork/TelligenceVeniceFork.t.sol` |
| Signature confinement | EIP-1271 accepts only the canonical Base/vault/Venice authentication envelope, freshness, resource, and authorized signer. Generic financial signatures and raw JWT bootstrap signatures fail. | `contracts/test/TelligenceVeniceAuth.t.sol`, `services/auth-signer/test/venice-auth.test.mjs` |
| Signer isolation | Signer service requests authenticate over private networking. Encrypted keys bind to their signer context; public endpoints never return private keys or upstream credentials. | `services/auth-signer/test/server.test.mjs`, `services/auth-signer/test/crypto.test.mjs` |
| Creator authority | A creator's verified wallet session is distinct from an inference API key. Key issuance/revocation requires the correct creator and CSRF protection. | `services/auth-signer/test/creator-auth.test.mjs`, `services/gateway/test/http.test.mjs` |
| Project budgets | A PostgreSQL transaction reserves the worst-case request cost against key limits, shared verified provider daily and remaining credit, and any explicit project cap. The optional fundraising goal is metadata only. Concurrent requests, key rotation, process restart, and UTC rollover cannot erase liabilities. | `services/gateway/test/postgres.test.mjs` |
| Ambiguous spend | Timeouts, broken streams, or missing final usage retain uncertain reservations. There is no automatic paid retry, replacement inference, USD fallback, or USDC top-up. | `services/gateway/test/`, `services/control-worker/test/capacity.test.mjs` |
| Provider readiness | A verified factory identity, explicit canary evidence, fresh capacity, and a reviewed unexpired model catalog precede inference. Missing or contradictory evidence fails closed. | `services/gateway/test/postgres.test.mjs`, `services/control-worker/test/capacity.test.mjs` |
| Keeper durability | Jobs have unique identities, leases, durable transaction hashes, and observed outcomes. Restart, duplicate delivery, and reorg handling do not imply a completed transaction. | `services/control-worker/test/worker.test.mjs`, `services/control-worker/test/postgres.test.mjs`, `services/control-worker/test/chain.test.mjs` |
| Reviewed writes | Wallet execution preserves reviewed chain, account, destination, calldata, value, and minimums through simulation and submission. Proposed and pending transactions do not imply available compute. | `web/test/transaction-review.test.ts`, `web/test/reviewed-write-hook.test.tsx`, `web/test/telligence-transactions.test.ts` |
| Truthful capacity | Unactivated or unavailable capacity is unknown, not a fabricated zero or a promised funding conversion. Daily capacity and today's remaining budget remain separate. | `web/test/e2e/telligence.spec.ts`, `web/test/` Telligence data/transaction tests |
| Local credentials | Setup creates separate random secrets privately and never overwrites an existing path or follows a symlink. Local readiness never creates provider evidence. | `scripts/test/init-local.test.mjs` |

A compromised hot signer can consume the vault's available compute outside the
gateway. Gateway quotas are not a containment boundary for that compromise.
Onchain signer revocation and provider/session reconciliation are both part of
incident recovery. Venice token contracts are externally administered and
upgradeable where described in the pinned evidence; Telligence cannot promise
immutable provider behavior or fixed withdrawal dates.
