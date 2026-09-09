# Repository delivery evidence

The repository preserves Revnet Money history while placing the fork in `web/`
and the new v6 extension in `contracts/`. Active workflows are rooted at
`.github/workflows/`; the web deployment checker now validates those exact
workflows rather than inert copies under `web/.github/`.

## Tooling TDD

`node --test scripts/test/init-local.test.mjs` first failed because the setup
module did not exist. The implementation then passed tests proving that:

- Each local credential is independently generated and `.env` is mode 0600.
- Missing deployment and model configuration stay unconfigured.
- Running setup again preserves existing configuration and credentials.
- A pre-existing symlink cannot redirect a write into another secret file.

The database gate tests initially exposed a credential-disclosure bug: an
uncaught `new URL` error echoed invalid input. The implementation now catches
that error and prints a fixed message. These five setup/database-gate tests pass.

The web environment fixture was extended before accepting the direct-recovery
factory build variable. The zero-address case initially succeeded incorrectly;
after adding validation, zero/malformed addresses fail and an absent factory
remains a valid unconfigured deployment. `npm --prefix web run env:test` passes.

Generated Solidity ABIs now pass through exact Prettier 3.9.6 with the web's
TypeScript formatting settings. This fixes the formatting gate at generation
time; no hand-edited generated files or formatting exceptions were added.

## Dependency and runtime provenance

Node 26.5.0 was downloaded from the official Node distribution and its Darwin
ARM64 archive matched the published SHA-256:
`ee920559aaa2391569cff4d737e3b83963430e3a14dedd91bfe0ff53171b5af9`.
The repository pins Node 26.5.0/npm 12.0.1. Foundry's v1.7.0 release and the
immutable Foundry toolchain action revision were verified before pinning CI.

The web lockfile was installed independently into an empty temporary directory.
The local convenience symlink to the upstream checkout's `node_modules` was
replaced with that real installation; upstream files were untouched.
`dependencies:check` passed. Contract dependencies were independently installed
from their package lock, with stock Revnet and forge-std source provenance in
`contracts/lib/*/UPSTREAM`.

Running `npm run setup` in the final directory exposed npm 12's default rejection
of Git dependencies (`EALLOWGIT`). The contracts package now explicitly declares
the same four already locked Git revisions and uses `allow-git=root`; the setup
command scopes that flag to contracts, while root/web retain `allow-git=none`.
A completely empty install then installed all 455 contract dependencies. The
sixth tooling regression test verifies the exact repositories/commits, disabled
lifecycle scripts, and absence of a broad Git allowance. All six tooling tests
pass; no Solidity source revision changed to fix installation.
The complete `npm run setup` subsequently exited successfully in the requested
final project directory, installing root, contract, service, and web packages
from their locks without any upstream `node_modules` symlink.

The production audit found inherited critical Next.js and high Sharp
advisories. The web package and lockfile were updated to exact Next.js and
eslint-config-next **16.3.4**, with Sharp **0.35.4**. The audit now passes under
the existing source-verified low-severity Para/elliptic exception; no new
advisory suppression was added. Relevant advisories are
[Next.js image optimization](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[Next.js Windows hosting](https://github.com/advisories/GHSA-p293-qw3h-jr36), and
[Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

The final production audit passed again against the delivered locks. The full
development-inclusive web audit still reports 22 findings: 16 low, three
moderate, and three high. All nodes affected by the high findings
(`brace-expansion`, its `minimatch` dependent, and `undici`) are marked
`dev:true` in the lockfile; they are outside the production dependency gate.
These development findings were not suppressed or silently reported as fixed.

The service lockfile was updated by the backend implementation to viem 2.56.3;
the rebuilt Node 22.23.1 service image reported zero dependency vulnerabilities.
The service and web base images and PostgreSQL 14.20 image are digest-pinned.

## Container smoke evidence

An isolated local Compose project successfully built the service images from
the repository root, started PostgreSQL, applied the migration, then started the
private signer and gateway in dependency order. It used its own credentials and
an unused local PostgreSQL port; no existing database was replaced.

Observed assertions:

- Gateway `/healthz` and database `/readyz`: HTTP 200.
- `/v1/config`: `ready:false`, no factory address, no invented creation fee.
- `/v1/projects`: an empty list, without sample projects.
- Unconfigured inference: HTTP 503 before any provider request.
- Private signer operation without a service credential: HTTP 401.

The smoke run identified and corrected a Compose tmpfs quoting error before
startup. CI now runs this same unconfigured-service smoke test. It also builds
the worker image; worker behavior and truthful readiness have their own real
PostgreSQL/HTTP tests.

## Release boundary

The web deployment, immutable-workflow checks, and YAML/Compose validation pass.
A final backend verification on Node 26.5.0 and isolated PostgreSQL 14.20 passed
all **124 service tests** and all **32 database/HTTP/canary/reconciliation tests**,
with no skips. The commands were `npm run test:services` and `npm run test:db`
with `TEST_DATABASE_URL` explicitly set to the isolated test database.

The final production-shaped browser build with Next 16.3.4 passed standalone
composition and client bundle budgets: largest route 588.8 KiB, unique initial
chunks 813.1 KiB, and all client chunks 2511.6 KiB, measured with gzip. All
**130 Chromium browser tests passed without retries** across five widths.
The [frontend record](frontend-tdd.md) includes the build/browser logs and
screenshots.

The final environment fixtures, dependency installation check, dead-code check,
deployment configuration, typecheck, lint, formatting, and source invariants
passed. The wallet inventory checks 139 call sites across 13 documented surfaces
and 31 test-referenced actions. Protocol verification independently checked all
44 deployment artifacts against the pinned upstream deployment checkout.

The final `npm --prefix web run test:ci` passed **1,659 tests**, with one inherited
opt-in live Base route test skipped because `LIVE_BASE_RPC_URL` was not set.
All coverage thresholds passed: statements 53.08%, branches 45.44%, functions
50.23%, and lines 54.86%. The three inherited live Bendystraw schema checks
required network access; the sandbox-only attempt failed DNS, and the complete
network-enabled rerun passed. The [coverage log](web-coverage-green.log) records
the final run. No new Telligence test was skipped.

The release workflow calls the complete CI gate before publishing four images
with immutable tags, SBOMs, provenance, and attestations. No image was published,
no Railway environment was mutated, no contract was broadcast, and no funded
Venice request was made during these repository delivery checks.
