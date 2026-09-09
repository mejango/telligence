# Frontend implementation and verification

Telligence retains the Revnet client history, component system, Simplon Mono typography, Melon palette, native dialogs, wallet review boundary, and protocol inspection tools. The primary journey now starts with a written purpose, explains recurring inference credit, and ends with a project API key. Deployment and inspection are restricted to Base. Ethereum access is confined to read-only ENS resolution.

## Product boundaries

- `/create` collects purpose, workload, a daily credit target, and an optional immutable recovery wallet. Review binds the exact factory and published policy to the draft. A target is an ambition, never an estimate of capital or a verified balance.
- `/compute/:id` distinguishes observed daily credit, remaining credit, and the requested target. Stale, missing, future, inconsistent, or previous-day observations cannot appear as available capacity. Directory outages have their own retry state; they do not appear as an empty directory.
- `/compute/:id/keys` authenticates the connected creator through an explicit message review. Key secrets are shown once and never persisted in browser storage. Changing accounts or projects clears private state.
- `/recover` resolves a project directly from the pinned Base factory and mounts onchain recovery controls. It remains usable during a gateway outage. Emergency authentication disable, pause, wind-down, and permissionless cooldown progress use the same reviewed wallet boundary as other transactions.
- `/base:ID` preserves detailed Revnet inspection. Non-Base routes and non-Base ENS targets fail before financial lookups. Cross-chain indexed records and refreshed state cannot reintroduce unsupported financial choices.
- The fixed-origin gateway proxy accepts only reviewed routes, methods, bounded JSON or inference streams, and scoped credentials. It does not expose a general HTTP proxy. The private Railway hostname is an explicit deployment exception, not an arbitrary private-network allowlist.

## TDD record

Each behavior below was first exercised with a failing test, then implemented and rerun. Existing financial, wallet, transaction, and browser-boundary tests were retained; obsolete marketing expectations were rewritten around the new product journey.

| Behavior | Regression coverage |
| --- | --- |
| Unknown capacity, UTC rollover, observation expiry, stopped projects, exact decimal targets | `web/test/telligence/presentation.test.ts`, `gateway-resource.test.tsx` |
| Runtime snapshot validation and response identity | `web/test/telligence/project-data.test.ts` |
| Purpose validation, focus, acknowledgement reset, optional recovery propagation | `web/test/telligence/screens.test.tsx` |
| Immutable deployment and policy review | `web/test/telligence/policy-review.test.ts`, `web/test/telligence-launch-lifecycle.test.tsx` |
| Creator signature review, account/session changes, one-time key secrecy | `web/test/telligence-auth.test.tsx`, `web/test/telligence-keys.test.tsx` |
| Exact proxy paths, origin/CSRF/cookies, body limits, streaming and cancellation | `web/test/telligence/gateway-proxy.test.ts` |
| Pending launch recovery without duplicate signing | `web/test/telligence/pending-launch-notice.test.tsx`, launch lifecycle suites |
| Base route binding, indexer-safe IDs, cache isolation, read-only ENS | `web/test/project-handle-route.test.ts`, `web/test/telligence-project-*.test.*`, `web/test/telligence-sucker-scope.test.tsx`, ENS suites |
| Pinned-factory recovery lookup and onchain role/cooldown enforcement | `web/test/telligence/recovery-lookup.test.ts`, `web/test/telligence-recovery.test.tsx` |
| Public metadata failure bounds and safe deployment origins | `web/test/telligence/public-metadata.test.ts` |

The production browser pass exercises five widths: 1280, 1100, 768, 390, and 320 pixels. It uses the built standalone Next server, strict local RPC/network fixtures, security headers, Axe accessibility checks, keyboard focus, horizontal containment, native modal inertness/stacking, Base inspection, empty and unavailable directories, and disconnected key management. An early cold-browser failure exposed a hydration race in the create form; inputs and submission now remain disabled until the client is mounted.

The screenshots in [screenshots](screenshots/README.md) use deterministic fixtures. They demonstrate presentation, not deployed contracts, actual fundraising, provider credit, or authenticated key provisioning. Live Venice and Base evidence is recorded separately by the contract and integration suites.

## Final verification, 9 September 2026

- Production standalone build: Next 16.3.4, passed ([log](frontend-browser-build.log)).
- Complete Chromium suite: **130 passed**, no retries, across all five widths ([log](frontend-browser-green.log)). The suite includes retained protocol inspection, ENS, wallet identity, native-dialog, and no-JavaScript guide checks alongside the new Telligence journeys.
- Final screen and key component checks: **19 passed** ([log](frontend-screen-green.log)). The repository-wide coverage gate is recorded separately in the delivery evidence.
- Standalone check: both required runtime artifacts present. Bundle budgets pass: largest route 588.8 KiB, unique route JavaScript 813.1 KiB, all client JavaScript 2511.6 KiB gzip ([log](frontend-bundle-green.log)).
- Wallet inventory: **139** boundary call sites across **13** documented surfaces and **31** actions, including four explicit recovery writes.
- Desktop and mobile home, project, creation review, and disconnected key console screenshots were inspected. All 20 images are in the labeled screenshots directory. A mobile funding jump preserves quick access to the contribution form while keeping the complete rights and recovery explanation readable.

## Commands

Use the pinned Node and npm versions in `web/package.json`.

```sh
npm --prefix web run typecheck
npm --prefix web run wallet-writes:check
npm --prefix web run test:ci
npm --prefix web run build:browser
npm --prefix web run standalone:check
npm --prefix web run bundle:check
npm --prefix web run test:browser
```

`build:browser` is an isolated verification artifact. Its local providers, public fixture key, and deterministic mode are rejected by release environment validation.
