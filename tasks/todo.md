# Telligence production pass, 2026-11-16

Bring the Telligence webclient up to the current Revnet Money baseline (UX, DX, AX), review Telligence's own copy against the current copy canon, and leave a reviewable PR.

## Plan refinement

- **Objective:** Telligence's web/ is a Revnet Money fork taken at `e23a69e7` (September, SDK 2.3.2). Upstream is 378 commits ahead (SDK 6.10.0, review/recovery, parity rulings, copy canon, agent surfaces). Success: web/ contains upstream `6dc9564e` plus Telligence's product surface, the full `npm run check` web gate passes, Telligence-owned copy follows the canon, and the result is rendered on desktop and phone. Contracts and services are out of scope unless the merge requires a change. Unresolved preference: when to merge to main and deploy (jango's call).
- **System fit:** Revnet Money owns the shared client behavior; the SDK owns send/sign rules. Telligence owns `src/lib/telligence`, `src/components/telligence`, `/create`, `/compute`, `/how-it-works`, home, discover, gateway proxy, and its scripts/fixtures. The merge replaces inherited behavior wholesale; only Telligence-owned files and the 43 conflicted files get hand edits. Services, gateway and contracts links are unaffected.
- **Reuse and simplicity:** `git merge -X subtree=web revnet-money/main` reuses the shared history (merge base exists), so upstream stays recognizable per CONTRIBUTING.md. No cherry-picks, no reimplementation. Telligence code adapts to upstream APIs; upstream files are not edited for Telligence unless they already were. Upstream homepage pieces Telligence deleted stay deleted.
- **Evidence and unknowns:** Trial merge gave 43 textual conflicts (33 content, 10 delete/modify). Unknown: how many Telligence-owned call sites break on SDK 2.3 to 6.10 and on upstream refactors (typecheck and tests will enumerate). Unknown: whether upstream fixture/e2e harness changes need Telligence fixture updates. Live behavior of the gateway is not exercised here; fundraising and inference stay disabled in production.
- **Verification:** `npm --prefix web run typecheck`, `lint`, `test:ci`, wallet-write inventory, `source:check`, `protocol:check`, `build:browser`, bundle and standalone checks, Playwright. Then the root `npm run check` pieces that do not need the DB for web-only changes. Render home, discover, create, how-it-works, a project page and compute pages at desktop and phone width against live data. Codex review of the merge resolution and Telligence adaptations before the PR.
- **Resource budget:** One worktree (`.worktrees/telligence-sync`), one merge commit, then small follow-up commits (adaptation, copy, agent surfaces). Typecheck drives the adaptation list rather than reading upstream history. Replan if adaptation needs upstream-file edits beyond the conflicted set, or if a Telligence flow has no upstream equivalent after a refactor.

## Work items

- [x] 1. Merge upstream into web/, resolve the 43 conflicts
- [x] 2. Install on Node 26 / npm 12, fix typecheck in Telligence-owned code
- [x] 3. Lint, unit tests, wallet-write inventory, source and protocol checks
- [x] 4. Browser build, bundle and standalone checks, Playwright
- [x] 5. Copy review of Telligence-owned surfaces against the canon (no middots, plain facts, money-risk caveats only, balance sheet, cash out, holders, JBP6, no inline glossary, short hints)
- [x] 6. Agent and developer surfaces: llms.txt, AGENTS.md, README/TESTING/DEPLOYMENT, CI workflows at the repo root
- [x] 7. Render desktop and phone against live data, fix what shows
- [x] 8. Codex review, fix, open PR (no merge without jango's go-ahead)

## Review

- Merged Revnet Money `6dc9564e` into `web/` (SDK core 2.3.2 to 6.10.0, Next 16.4.2, Node 26.13.1). Telligence's home, discover, create, compute, recover and how-it-works pages, Base scope and gateway proxy are kept.
- Funding, launch, recovery and creator sign-in now run through the SDK's reviewed run (`useReviewedAction`, `signReviewed`). Funding is one run (approval when needed, then payment) held by the pay intent. The launch lock uses `browserLocks()`. Each flow can end a stuck receipt wait with "Stop waiting"; what was sent stays followed.
- Ethereum is read for ENS handles only, through `publicClientFor`, so the handle editor and Safe queue files match upstream.
- Agent surfaces: `/llms.txt` and `/skill.md` describe Telligence. Titles on the 404, account and project pages say Telligence.
- Copy: "cash out", "balance" and "holders" per the canon, the home's fourth step states what happens to revenue, the recovery wallet hint is two sentences.
- Verification: `npm --prefix web run check` passes (3,638 unit tests, wallet inventory, build, standalone, bundle budgets with Telligence's routes, 178 browser tests). Rendered home, how-it-works, discover, create, recover, learn and `/base:1` at 1280 and 390 against live Base data; no horizontal overflow.
- Codex gpt-6.1-sol, two passes. Fixed: launch record lost when storage fails after sending, stuck receipt waits in all three flows, recovery tests that bypassed the component. Not done: reading pre-merge pending-contribution records, since production never enabled funding.
- Decisions for jango: the inherited Revnet guides (`/learn`, `/build`, `/audit`) still describe revnet.money's launch form; `src/app/create/RevnetCreate.tsx` stays only for inherited tests. The dev server alone crashes on the 404 page's button (production renders it).
- Not exercised: the gateway, a funded contribution, a launch or a recovery against live contracts.
