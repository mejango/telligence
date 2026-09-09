# Authentication TDD evidence

Tests were authored before their implementation modules on 2026-09-09.

| Cycle | Red command and observed failure | Green behavior |
| --- | --- | --- |
| Key isolation and creator authentication | `node --test services/auth-signer/test/crypto.test.mjs` failed `ERR_MODULE_NOT_FOUND` for `crypto.mjs`. | Authenticated encryption, project-context substitution rejection, tamper rejection, service credential comparison, EOA login and Base smart-wallet verification. |
| Venice signing policy | `node --test services/auth-signer/test/venice-auth.test.mjs` failed `ERR_MODULE_NOT_FOUND` for `venice-auth.mjs`. | Fixed resources and message reconstruction, EIP-712 generation binding, malformed/financial message rejection, expired/wrong-chain/disabled binding rejection. |
| Private HTTP and launch preparation | `node --test services/auth-signer/test/server.test.mjs` failed `ERR_MODULE_NOT_FOUND` for `server.mjs`. | Authentication before database access, body limits, no generic signing route, encrypted launch preparation and restricted private client. |

The first complete HTTP run encountered the environment's loopback socket restriction (`listen EPERM`), then passed with loopback execution permitted. No test contacts Venice or sends a blockchain transaction. Additional regressions cover activation-only balance access and exact reproducibility of the shared Solidity signature vector.

The preparation expiry response was added in a subsequent test-first cycle: the HTTP suite failed its response key assertion because `expiresAt` was absent, then passed after propagating the persisted expiration through the service and client.

Run the suite from the repository root with:

```sh
node --test services/auth-signer/test/*.test.mjs
```
