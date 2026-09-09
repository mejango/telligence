# Testing and CI

Revnet Money treats user-visible transaction details, contract-derived economics, and persisted transaction state as safety boundaries. Contract ABIs and deployed contract behavior are the source of truth. Bendystraw data is a derived view and must never silently override contract semantics.

## Local commands

Use the exact Node and npm releases pinned in `.nvmrc` and `package.json`:

```sh
npm ci
npm run audit:production
npm run env:test
npm run deployment:check
npm run typecheck
npm run lint
npm run protocol:check
npm test
npm run test:coverage
npm run build:browser
npm run standalone:check
npm run bundle:check
npm run test:browser
```

After Chromium is installed, `npm run check` runs that complete sequence.
The inherited Bendystraw schema contract tests require live mainnet/testnet
indexer access; browser and ordinary unit fixtures remain deterministic. `npm run test:watch` runs the focused Vitest loop. Tests use jsdom for
rendering safety boundaries but should prefer pure functions and contract
encoders wherever possible.

`npm run audit:production` is intentionally separate from `npm run check`: it asks
the configured registry for current advisories and fails on high or critical
production-dependency findings. Run it before the application gate whenever
registry egress is available. A missing/unreachable registry is a hard audit
failure, not a clean result.

Knip retains the four wallet SDK dependencies used by Wagmi's lazily imported
Coinbase, Safe, and WalletConnect connectors. They are optional peer dependencies
of `@wagmi/connectors`, so their direct package pins are required even though the
app imports the connector wrappers. The production bundle check independently
verifies that these SDKs remain lazy.

## What the suite protects

- Transaction review tests assert exact chain, account, destination, calldata, selector, arguments, ordering, and mutation detection before a wallet prompt. Hook tests exercise the complete review → account recheck → simulation → account recheck → submission order and reject duplicate direct and Safe submissions.
- Activity tests assert durable, deduplicated status reporting and fail-safe recovery from malformed browser storage.
- Safe tests ensure a proposal hash is never mistaken for an executed transaction.
- Relayr tests distinguish payment from destination-chain completion, deduplicate polling, retain transaction hashes, and fail visibly when any destination fails. Hook tests pin sender/chain identity, same-chain nonce collision rejection, EIP-712 review ordering, account changes before and after signing, payment expiry, simulation, receipt uncertainty, and Safe proposal handling.
- Deployment tests round-trip the canonical `REVDeployer.deployFor` calldata and assert stage timing, issuance, cash-out tax, split weights, auto-issuance, base currency, accounting token, decimals, salt, and creation fee. The independent fixture pins all eight create-flow `REVDeployer` targets, all 24 directed CCIP sucker-deployer pairs, and all 12 directed native sucker-deployer pairs from deploy-all-v6 commit `316e9d4d3f9e1c5b41a5df7c0ad6183abbeccc7f`. Tests compare the SDK maps and deterministic parser output with that fixture; pull-request CI checks out the exact contract commit and verifies all 44 artifact filenames and addresses, so the fixture and SDK cannot drift together unnoticed.
- Payment tests choose only live, previewable terminal routes, preserve custom-token accounting context, cache exact router probes, and enforce minimum output.
- Money tests keep integer fee, price decay, denomination, and loan-chart behavior stable.
- Rendering tests sanitize project-controlled HTML and executable URL schemes.
- Bendystraw tests pin every fixed operation ID to one named, read-only server document, reject unknown operations and unsafe variables at the same-origin boundary, validate response roots, permit bounded retry only for transient failures, and never retry an abort.
- Production-browser tests render the create surface at 320, 390, 768, and 1280 pixels, block and reject every attempted non-local HTTP/WebSocket request, disable service workers, and assert anti-framing and other security headers, layout containment, valid project links, core controls, keyboard use, page-error absence, and zero serious/critical accessibility findings.
- The browser server stages `public` and `.next/static` into Next's traced standalone output, exactly matching the OCI runner composition, then verifies the health revision before rendering any product surface.

Fixtures are deterministic: fixed timestamps, accounts, salts, chain IDs, and mocked transport responses. The unit setup rejects unexpected fetch, XMLHttpRequest, WebSocket, and EventSource access by default; a transport test must opt into an explicit local mock. Ordinary unit and browser tests must not depend on a wallet, live RPC, Bendystraw, Relayr, IPFS, wall-clock timing, or third-party availability. The inherited `bendystraw-schema.test.ts` explicitly opts into live schema and scoped project-query verification; an unavailable indexer fails that contract check. The browser harness serves the built standalone application with fail-fast localhost service URLs, refuses to reuse an existing server, and fails when the page even attempts external traffic. When a contract changes, update the fixture from its ABI and document the expectation change in the pull request.

Coverage includes all production `src/**/*.{ts,tsx}` modules—not only files imported by the unit suite—including routes and UI modules. The measured all-production baseline is ratcheted globally at 11.8% statements, 7.6% branches, 8.5% functions, and 12% lines. Independent, much higher per-file floors protect reviewed writes, Relayr, allowance, cash-out, borrow, bridge, bounded request bodies, and all three upstream API boundaries so the broad denominator cannot hide a safety regression. Raising these floors is encouraged; lowering them requires an explicit rationale and a fresh full-source measurement.

## Transaction coverage inventory

Every write below goes through the reviewed transaction boundary in `src/hooks/useReviewedWriteContract.ts` or the reviewed Relayr boundary in `src/hooks/useReviewedRelayr.ts`. `test/fixtures/wallet-write-sites.json` maps each structural hook and call site to one of these rows and to exactly one named action with explicit test references. `npm run wallet-writes:check` scans every production TypeScript module, rejects raw single/batch contract writes, transaction/call sends, raw sends, message/typed-data/transaction signatures, and wallet-send RPC methods outside the reviewed boundaries, and fails when a site, owner, count, action mapping, or referenced test changes without an intentional manifest review. Money-moving and project-control references must contain a stable, executable `wallet-action:<id>` test marker, so generic boundary coverage cannot conceal an untested action.

| Surface                                                                                                    | Representative implementation                                                                                                 | Safety coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Central direct/Safe write path <!-- wallet-inventory:central-write -->                                     | `useReviewedWriteContract.ts`                                                                                                 | Exact review payload, both account-recheck windows, simulation/submission ordering, duplicate rejection, activity lifecycle, Safe non-execution, and the one-proposal Safe batch (`proposeSafeBatch`: every call reviewed in order, sent once via `wallet_sendCalls`, tracked as a proposal) are tested. Wallet connector UI integration remains an end-to-end harness item.                                                                                                                                                                                      |
| Cross-chain Relayr authorization and destination execution <!-- wallet-inventory:relayr -->                | `useReviewedRelayr.ts`                                                                                                        | Per-destination EIP-712 authorization, trusted forwarders and domains, explicit funding choice, authenticated payment contracts, and canonical funding/destination identity are tested. Published signatures, unpaid quotes, uncertain funding, and partial failures retain recovery locks; alternate funding options and overlapping destination calls cannot duplicate them. Unknown publication requires manual onchain reconciliation. Safe and unsupported-chain edits use reviewed direct writes. Wallet UI integration remains an end-to-end harness item. |
| Safe co-signature authorization <!-- wallet-inventory:safe-signature -->                                   | `useReviewedSafeSignature.ts`                                                                                                 | Reconstructs and verifies the service hash, presents the exact destination for review, rechecks the account and chain, and signs only the reviewed EIP-712 payload.                                                                                                                                                                                                                                                                                                                                                                                               |
| Permit2 swap authorization <!-- wallet-inventory:permit2-signature -->                                     | `useReviewedPermit2Signature.ts`                                                                                              | Reviews the exact PermitSingle payload, rechecks the account and chain before and after signing, and returns only the signature that is embedded into the reviewed Universal Router swap.                                                                                                                                                                                                                                                                                                                                                                         |
| Revnet creation <!-- wallet-inventory:create -->                                                           | `app/create`, `parseDeployData.ts`                                                                                            | Canonical deploy selector and complete encoded economic configuration are tested. A one-chain launch uses the reviewed direct write; Relayr is reserved for launches spanning multiple chains.                                                                                                                                                                                                                                                                                                                                                                    |
| Pay, add balance, token allowance <!-- wallet-inventory:pay-allowance -->                                  | `V6PayCard.tsx`, `useAllowance.ts`                                                                                            | Route choice, live router probe, minimum return, direct/router identity, and Safe-dependent approval boundary are tested.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Cash out, borrow, repay, collateral reallocation, bridge <!-- wallet-inventory:value -->                   | `components/Value`                                                                                                            | Contract-derived cash-out and bridge fee math, fresh 99% bridge/borrow floors, encoded standard and reallocation calls, zero-floor refusal, and repay/approval operation boundaries are action-tested.                                                                                                                                                                                                                                                                                                                                                            |
| Token issuance, claim, auto-issuance, reserved-token distribution, splits <!-- wallet-inventory:owners --> | `components/v6/owners`, `owners/components`                                                                                   | Each action pins its ABI-derived builder or function, reviewed simulation boundary, and action-specific test reference; deployment split arithmetic is also directly tested.                                                                                                                                                                                                                                                                                                                                                                                      |
| Operator, settlement, shop, payer, and metadata writes <!-- wallet-inventory:admin-shop-metadata -->       | `components/v6/operator`, `components/v6/owners/settlement`, `components/v6/shop`, `components/v6/extras`, `about/components` | Component operations are pinned to their expected contract functions/builders and simulation-before-write boundary, with per-action tests for operator, ENS handle, same-address Safe deployment, settlement, queue, shop, payer, and metadata controls.                                                                                                                                                                                                                                                                                                          |

When adding a write, use the reviewed wrappers, provide the ABI/function/arguments used by the review UI, simulate immediately before submission, add the site to the matching manifest surface and action, and add an executable `wallet-action:<id>` test which covers its encoding or sequencing semantics.

Metadata edits resolve each destination's live controller, URI, owner, and permission before pinning. Only fields changed relative to the displayed form are applied; unchanged fields remain specific to each chain. Identical resulting documents share an IPFS URI, while distinct documents get separate URIs. Unreadable or mutable source documents fail closed. `edit-metadata-dialog`, `edit-metadata-merge`, `project-metadata-write`, and `user-permissions-hook` tests cover these rules, including owner-scoped ROOT and wildcard grants. The source controller and URI are checked again before direct writes, Relayr signing, and Relayr funding. Metadata and reserved-split recovery scopes also block changed payloads or a switch to direct submission while an earlier Relayr update remains unresolved.

Selected shop additions/media edits, payer deployments, reserved distributions, credit claims, unlocked auto-issuance allocations, and payouts use `useMultichainBatch`. It persists every selected call and encoded source-state guard. Multiple allocations on the same chain use explicit resumable rounds, with one funding payment per independent Relayr round; no allocation is omitted. Calls through Safe or unsupported networks remain staged. Saved direct jobs retain their original transport, and confirmed calls are skipped on resume. Source guards run before authorization, funding, and direct submission. Unknown publication/submission and partial results retain locks. The only raw Relayr destination is the canonical caller-independent payer factory, verified against the exact deployment event and deployed code. Reserved distributions verify the emitted amount and intentional burn total; payouts verify each reviewed recipient and net amount in addition to rejecting soft-failure events. The wallet inventory maps the common owner-distribution execution site to its three allocation-specific test groups.

## CI gates

GitHub Actions uses Ubuntu 24.04, Node 26.5.0, npm 12.0.1, read-only repository permissions, `npm ci --ignore-scripts`, a 40-minute timeout, and cancel-in-progress concurrency. Node's experimental process-wide Web Storage is disabled in every server runtime. Every reusable action is pinned to a full commit SHA, and both repository checkouts disable persisted credentials. Immediately after locked install, CI and release query the registry and reject high or critical production advisories; the remaining gate uses deterministic fixtures except for the explicitly live Bendystraw schema contract tests. It runs environment and deployment-policy fixtures, type-checking, linting, independent pinned deployment parity, the wallet-write inventory, coverage, the fixed-operation Bendystraw registry tests, a production standalone build, bundle budgets, and the production Chromium suite. A parallel job builds the digest-pinned OCI image and runs it without root, Linux capabilities, or a writable root filesystem; only the Next image cache is a writable tmpfs, and the smoke test exercises health and image optimization. Coverage is uploaded on every run; traces, screenshots, video, and the browser report are retained when browser assertions fail. Browser retries may collect a second diagnostic trace, but `failOnFlakyTests` makes a pass-on-retry fail CI rather than concealing nondeterminism.

Bendystraw documents live only in the server-side fixed-operation registry. Browser callers send a reviewed operation ID and bounded variables through the same-origin BFF; they cannot submit arbitrary GraphQL. When an indexed shape changes, update its narrow DTO, query, runtime guard, deterministic fixture, and operation test together.

The bundle gate measures gzip-compressed JavaScript referenced by Next 16's per-route client-reference manifests, including shared runtime chunks, and every emitted client chunk, including lazy chunks. Its conservative limits are 900 KiB for any app route, 1,100 KiB across unique route-referenced JavaScript, and 2,000 KiB across all client JavaScript. Override variables exist for local diagnosis, but CI should change a budget only alongside a reviewed explanation and measured user impact. Chart-heavy owner subtabs and wallet-only dialogs stay in on-demand chunks so the default project surface does not pay for unopened workflows.

## Deliberate follow-ups

- The deterministic browser gate deliberately stops before wallet connection or transaction submission. Wallet connector, Safe, and Relayr signing integration require explicit protocol simulators; they must not be tested against mutable public services in pull requests.
- The repository has pre-existing formatting drift, so CI uses `npm run format:ratchet`: all reviewed debt files are content-hashed, new debt fails, and changing a debt file while leaving it unformatted fails. Formatting an inventoried file is encouraged and requires removing its stale entry from `test/fixtures/format-debt.json`.
- The discovery page still talks to the legacy Juicebox subgraph with a fixed native-fetch query. Keep that external query narrow and move it behind a same-origin operation boundary if it grows beyond the current three reviewed fields.
- Unknown custom-token metadata and externally supplied tier media deserve explicit product-level fail-closed policies. Tests should be added with those policy changes rather than asserting unsafe legacy fallback behavior.
- `cashOutQuote.ts` intentionally mirrors the corrected reserved-supply arithmetic locally because the currently locked Nana SDK release predates that correction. Replace it with the patched SDK only after an authorized published-version/lockfile update and after the exact 100%-coverage parity tests pass unchanged against that release.


<!-- wallet-inventory:telligence-creator-signature -->
Telligence creator authentication uses `useReviewedCreatorSignature.ts`. The exact
EIP-4361 sign-in message is reviewed before signing, bound to this site's origin,
the connected wallet, Base, and a five-minute nonce. Account, network, expiry, and
View as state are checked before and after the wallet prompt. Executable coverage
in `test/telligence-auth.test.tsx` rejects altered domains, authority, resources,
expired messages, and account changes. `test/telligence-keys.test.tsx` covers
project-bound creation and revocation, one-time secrets, CSRF, budget validation,
loading failures, and wallet/project change races.


<!-- wallet-inventory:telligence-funding -->
Telligence contributions use `FundComputeProject.tsx`. The action test pins an exact
VVV approval, fresh stock-route payment quote, canonical factory/vault/terminal
bindings, and the confirmed payment event. Account, project, unmount, uncertain
receipt, and pending transaction changes stop a duplicate or stale submission.

<!-- wallet-inventory:telligence-launch -->
Telligence launches use `LaunchComputeProjectButton.tsx`. The action suite binds the
reviewed factory and immutable policy to the signed transaction, preserves submitted
intent through reloads and account changes, refuses corrupt recovery records, and
registers only the unique matching confirmed deployment event. A per-creator lock
prevents two tabs from preparing concurrent submissions.

<!-- wallet-inventory:telligence-recovery -->
Compute recovery uses `ProjectRecoveryControls.tsx` and the generated contract ABIs.
The action suite verifies onchain policy/vault identity, creator/recovery authority,
Base freshness, notice and provider cooldown boundaries, reviewed pause, emergency
authentication disable and wind-down calls, and rejection after an identity or lifecycle change. Permissionless progress
continues without the hosted gateway once the required cooldown is complete.
