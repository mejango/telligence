# Contributing

Telligence follows the Juicebox v6 division between contracts, generated
interfaces, read-only indexed views, and explicitly reviewed wallet writes.
Keep changes within those boundaries and keep upstream code recognizable.

## Test-first workflow

1. Write a failing test for the observable behavior or invariant. Use exact
   calldata, amounts, identity, ordering, and failure state where money or
   authority is involved. Record the failing command before implementation.
2. Implement the smallest coherent change. Run the focused test until it passes.
3. Run the affected package's suite, then the repository release gate when the
   change crosses contract, service, or browser boundaries.
4. Describe behavior, validation, and remaining integration limits in the PR.
   A skipped live test or missing provider is not a passing result.

Contracts use Foundry with v6 conventions: `src/interfaces`, `src/structs`,
`src/enums`, explicit errors/events/NatSpec, immutable dependencies, and separate
unit/integration/fork suites. Do not fork core Revnet or Juicebox contracts to
implement project policy. Use the vendored stock-v6 fixture to prove that a
behavior actually follows upstream accounting, including buyback cashouts.

Services use Node's test runner and real PostgreSQL for locking, restart,
reservation, and reconciliation behavior. Use `TEST_DATABASE_URL` for an
isolated database. Never substitute an in-memory store for the PostgreSQL
integration gate. Inject local provider transports in tests; paid or live
inference belongs in the separately recorded canary.

The webclient uses Vitest and Playwright. Follow [web/TESTING.md](web/TESTING.md)
for the inherited transaction boundaries and browser harness. Every new wallet
write needs an intentional inventory update and executable
`wallet-action:<id>` marker. Keep review, simulation, account/chain rechecks,
submission, and confirmation separate. A Safe proposal is not execution.

## Dependencies and generated code

Install with `npm run setup`. Each package owns its npm lockfile; do not add
another package manager or refer to a developer's local checkout. Dependency
lifecycle scripts are disabled. Update package and lockfile together, inspect
the resulting tree, and run the production advisory gate.

npm 12 disables Git dependencies by default. Only `contracts/` opts into
`allow-git=root`: Permit2, Uniswap v3 core/periphery, and the Chainlink dependency
on zkSync are explicitly declared at their existing full commit hashes. The
setup command scopes the same flag to that package, so npm lifecycle environment
inheritance cannot block it. Root and web keep `allow-git=none`. Do not broaden
this to `all`; update the explicit pins and dependency-policy regression test
when a reviewed source change is required.

`contracts/lib/*/UPSTREAM` records imported source revisions. Preserve those
files when updating stock source. Do not modify vendored implementations in a
feature PR. Upstream deployment addresses are independently pinned in the
webclient protocol fixture and checked against the exact deploy-all revision in
CI; a matching SDK constant alone is not independent verification.

Run `npm run abi:generate` after compiling changed contracts. Commit both
`packages/contracts/` JSON and `web/src/lib/telligence/generated/` TypeScript.
Do not hand-edit generated ABI content.

Root `.github/workflows/` is the active CI and release configuration. Workflows
under `web/.github/` would be inert; the web deployment checker intentionally
reads the real root workflows. All third-party actions and container images
must remain pinned. Publishing images runs the same reusable CI gate and
requires the protected `production` GitHub environment; it does not deploy.

## Scope and evidence

Keep public product language about purpose, capacity, and availability. Put
asset rights, cooldowns, allocation policy, and contract addresses in the inspect
and transaction-review surfaces. Never derive usable credit from a fundraising
amount or equate token price with service availability.

Do not commit credentials, prompts, completions, authenticated Venice headers,
private keys, live bearer keys, or database dumps. Redacted request IDs,
transaction hashes, model/usage amounts, and source revisions are sufficient
for operational evidence. The root and image ignore files exclude local
credentials, key material, installed dependencies, and build artifacts.
