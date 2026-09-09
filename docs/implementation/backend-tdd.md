# Backend TDD record

Implemented in the isolated build checkout on September 9, 2026. Tests use local PostgreSQL 14.20 and Node 24.1.0; Docker pins Node 22.23.1. None of this is evidence of a funded Venice account, a deployed Railway service or a completed contract audit.

## Observed red/green sequence

1. Wrote gateway policy tests before the policy module. The initial run failed with `ERR_MODULE_NOT_FOUND`. Implemented fixed-point dollar conversion, random keyed bearer hashes, explicit text/model/output allowlists and conservative reservations; five tests passed.
2. Wrote real PostgreSQL quota tests before the store module. The initial run failed with the missing module. Implemented durable per-project transaction locking, per-key/project budgets, provider snapshot subtraction and one-way settlement. Four tests passed against a real local database, including 20 simultaneous reservations and restart/epoch cases.
3. Wrote creator HTTP tests before the app module. The initial run failed with the missing module. Implemented stored one-use SIWE challenges, real EOA signatures, ERC-1271 verification, HttpOnly sessions, CSRF, origin checks, project ownership and the key lifecycle. Both integration tests passed against PostgreSQL and a loopback HTTP server.
4. The inference transport subtask began with a missing-module red run, then passed 14 cases. Additional red cases exposed an unwritten streaming response being prematurely destroyed and a stalled upstream cancellation preventing uncertainty settlement. Both were fixed; all 16 transport tests passed.
5. The signer subtask began with missing-module red runs for creator authentication and signing. It produced 16 passing tests and a fixed cross-language EIP-712/1271 signature vector independently accepted and reproduced by Solidity. A response-shape regression first failed for missing preparation expiry, then passed after the persisted expiry was returned.
6. Added a red test proving unpriced provider defaults were still possible. The gateway now explicitly disables added Venice system prompts, optional thinking, web search, scraping and X search. Updated transport assertions verify the server-controlled parameters, while caller-supplied provider settings remain rejected.
7. Added a registration recovery regression. It exposed a PostgreSQL UUID/text parameter-type conflict, then the need for repeat-response handling. Both were fixed. Expired original signer preparation can be claimed after confirmed identity proof; repeated registration returns 200 with the same project and ignores attempted metadata overwrite; identity substitution returns 409.
8. Added a registry regression demonstrating that a mismatched canonical terminal could still produce ready configuration. The server now verifies `REV_DEPLOYER().MULTI_TERMINAL()` and reads the actual `PROJECTS().creationFee()`. Wrong runtime, chain, terminal, creator, vault, wrapper and signer all fail closed.
9. Added a database canary boundary test. Only an explicit matching, prepared, single-project/generation run may bypass the initial canary marker, once, with a maximum one-cent reservation. Ordinary API traffic has no such option.

The control worker and capped canary have additional records in their own module documentation/tests. The full final test command and totals are recorded in the repository's release evidence after integration.

## What the tests establish

The tests cover the implementation's local authority, isolation, persistence, request bounds and ambiguity handling. The fixture provider deliberately exercises success, redirects, errors, interrupted streams, stale balance, reset boundaries and malformed data; it does not stand in for funded acceptance by Venice. Database tests use PostgreSQL transactions rather than an in-memory quota implementation.

Unknown pricing, unverified provider capacity, missing deployment manifests and absent gas execution authorization remain unavailable. There are no automatic USD/USDC top-ups or paid-inference retry loops.

## Primary integration evidence used

- [Venice x402 wallet flow](https://docs.venice.ai/guides/integrations/x402-venice-api): per-wallet SIWX authentication and free balance checks.
- [Venice x402 balance schema](https://docs.venice.ai/api-reference/endpoint/x402/balance): authenticated `{success:true,data:{walletAddress,balanceUsd,diemBalanceUsd,canConsume}}` response.
- [Venice chat parameters](https://docs.venice.ai/api-reference/endpoint/chat/completions): provider system-prompt, search and reasoning controls.
- Repository-pinned protocol source and local Base interfaces provide contract call signatures; manifests must independently pin deployed runtimes before production use.

## Capped canary integration

The canary subtask started with a missing-module red run and passed five tests against an isolated real PostgreSQL schema and loopback HTTP provider. It invokes the exact production transport and capacity parser. Success requires settled, nonzero usage and a fresh same-epoch decrease in the project's DIEM balance. Concurrent and repeated invocations produce at most one paid request. Malformed paid responses or missing measured debit remain uncertain and do not activate normal access. Cap and quota failures never reach the paid endpoint.

After upgrading the service dependency lock to exact `viem@2.56.3`, `npm audit --omit=dev --audit-level=high` reported **zero vulnerabilities**. The combined gateway, canary and signer run passed **54 tests**, with no skipped tests, against local PostgreSQL. Worker and final integration totals are recorded separately because their additional work was still being integrated at this checkpoint.

## Final integrated service verification

The final shared services run passed **124/124 tests**, including the deployment-manifest builder, gateway, model-catalog refresh, creator authentication, signer synchronization and rotation, SIWX signer, capped canary, DIEM billing reconciliation, worker, and real PostgreSQL/HTTP integration cases. No database tests were skipped. The command was:

```sh
TEST_DATABASE_URL=postgres://telligence@127.0.0.1:55439/telligence_test \
  /opt/homebrew/opt/node/bin/node --test --test-reporter=dot \
  gateway/test/*.test.mjs auth-signer/test/*.test.mjs control-worker/test/*.test.mjs
```

It ran from `services/` using Node 24.1.0 and isolated local PostgreSQL 14.20. The configured URL was a disposable local fixture, with no production data or credentials. `npm audit --omit=dev --audit-level=high` again reported zero vulnerabilities for the final dependency lock.

Additional observed red/green regressions covered:

- Signer-generation synchronization and onchain-confirmed key rotation, with exact creator/preparation binding and no quota reset.
- Production model-policy loading for the explicit canary, including fail-closed rejection when provider metadata no longer fits the policy.
- Capturing a provider completion ID before an interrupted or malformed response becomes uncertain; an ID is immutable and cannot be reused within the project.
- Positive DIEM billing-proof reconciliation, bounded pagination, conservative rounding, no refunds, current-epoch retention, concurrent/idempotent execution, and suspension if the provider exceeds the admitted bound.
- HTTP 409 for ambiguity after paid forwarding, retaining its local request identifier and debit; preflight authentication errors remain distinguishable and release only proven-unsent work.
- Request-status isolation: a current key can inspect only its own project's durable metadata.

This is a local implementation and integration result. The suite does not claim a deployed Railway environment, a funded Venice account, successful live vault bootstrap, live signer revocation latency, or an audited mainnet recovery. The explicit canary and reconciliation commands were exercised against clearly identified local provider fixtures; no paid Venice inference, token transfer, deployment, top-up or keeper gas spending occurred during this backend task.
