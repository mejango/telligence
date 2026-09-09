# Telligence

Fund recurring AI inference for projects people believe in.

Telligence is a Base-only skin for Revnets, with VVV as the accounting asset. A
creator describes the work they need compute for; supporters fund its Revnet;
the creator uses a project API key. The project vault owns the VVV, sVVV, DIEM,
and DIEM stake. A separate authentication signer can authorize Venice requests
without receiving authority to move the backing assets.

The Revnet and Juicebox v6 contracts are used unchanged, including their normal
buyback routing. New contracts constrain project policy and manage compute. The
webclient preserves the Revnet Money transaction review and wallet boundaries.

Creators may choose an operator allocation of newly issued Revnet tokens. The
webclient keeps compute at 40%, defaults the operator to 0%, and gives funders
the remainder. All three shares are reviewed before launch. Operator tokens
have ordinary transfer and cashout rights, including before project revenue;
they grant no additional authority over the compute vault.

The [executable economics report](docs/economics.md) shows how production
shares, cashout taxes, fees, and conversion timing affect actual VVV available
for compute. A production percentage is not a percentage of money allocated.

```text
contracts/                 Solidity extension, Foundry tests, deployment scripts
  src/                     Factory, policy, vault, and Venice authentication
  test/                    Unit, stock-v6 integration, invariant, and fork tests
  lib/                     Pinned upstream Solidity sources and provenance
web/                       Revnet Money fork: Next.js, React, Nana SDK, wagmi/viem
services/
  gateway/                 Creator sessions, project keys, and inference budgets
  auth-signer/             Private, constrained Venice authentication service
  control-worker/          Chain reconciliation, capacity, and keeper jobs
  db/                      PostgreSQL schema and transactional migrations
packages/contracts/        Generated extension ABIs
scripts/                   Local setup, capability checks, and ABI generation
.github/workflows/         Contract, service, web, browser, and image gates
docs/                      Architecture, evidence, and implementation records
```

The frontend history starts at Revnet Money commit
`e23a69e7ce060672d131bee461778179bcb026bf`; its files were moved under `web/`.
The separate `plugin/` application is outside this repository.

## Develop

Use Node **26.5.0**, npm **12.0.1**, Foundry **v1.7.0**, and Docker Compose v2.
Solidity is pinned to **0.8.28** in `contracts/foundry.toml`. Service images use
Node 22.23.1; the services are also tested on the repository's Node 26 toolchain.

```sh
nvm use
npm install --global npm@12.0.1
npm run setup
npm run dev:init
npm run dev:services
```

`dev:init` creates a mode-0600 `.env` with independent random local credentials.
It refuses to replace an existing file. The database, migrations, signer, and
gateway start in dependency order. No deployed factory, model prices, provider
capacity, or successful canary are invented. An unconfigured gateway serves
health and discovery while keeping project writes and inference unavailable.

For the production-shaped web container, use `npm run dev:up` and open
`http://localhost:3000`. For the faster Next.js development loop, copy
`web/.env.example` to `web/.env.local`, set the gateway URL described in
[DEPLOYING.md](DEPLOYING.md), and run `npm run dev` (port 3002). Replace the
unconfigured local Para key with your public development application key to use
that wallet option. WalletConnect remains absent until configured.

`npm run dev:down` stops the local stack and preserves its PostgreSQL volume.
It never deletes local database contents.

## Verify

Run focused tests first, then the complete gate with an isolated PostgreSQL
database. `TEST_DATABASE_URL` must never point to an application database.

```sh
npm run test:tooling
npm run test:contracts
TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/telligence_test npm run test:services
npm --prefix web test
npm --prefix web exec playwright install chromium
TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/telligence_test npm run check
```

`npm run check` requires the database, executes the contract and service gates,
and runs the complete inherited web gate, including protocol address parity,
wallet write inventory, production-shaped browser build, bundle budgets, and
Chromium accessibility checks. Production dependency audits are a separate
registry-backed gate: `npm run audit:production`. Missing registry access is an
audit failure.

The inherited schema contract tests also read the current mainnet/testnet
Bendystraw schemas. They fail if those services are unreachable or incompatible;
the remaining unit and browser fixtures use bounded local transports. Set
`PROTOCOL_DEPLOYMENTS_DIR` to the exact deploy-all-v6 checkout used by CI to verify
the independent deployment artifacts, as described in [DEPLOYING.md](DEPLOYING.md).

The ordinary contract gate excludes tests requiring live Base RPC. Those tests
are an additional release check; use the explicit fork command and pinned block
in [DEPLOYING.md](DEPLOYING.md). Browser fixtures test deterministic product
states and do not establish that a real vault can spend Venice credit.

## Operate

Read [DEPLOYING.md](DEPLOYING.md) for Railway topology, configuration, rollout,
recovery, and funded-canary acceptance. [INVARIANTS.md](INVARIANTS.md) maps the
asset, authority, budget, and transaction boundaries to their tests.
[CONTRIBUTING.md](CONTRIBUTING.md) describes the test-first development loop and
upstream update conventions.

The web and backend are [running on Railway](docs/implementation/railway-production.md),
with domain configuration pending and fundraising and inference disabled. The
implementation has not been audited. The funded Venice bootstrap, vault credit
recognition, capped inference, signer revocation, and complete unwind must be
demonstrated before accepting public contributions.
Existing architecture and read-only evidence live in
[docs/architecture.md](docs/architecture.md) and
[docs/venice-integration.md](docs/venice-integration.md).
