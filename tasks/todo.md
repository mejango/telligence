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

- [ ] 1. Merge upstream into web/, resolve the 43 conflicts
- [ ] 2. Install on Node 26 / npm 12, fix typecheck in Telligence-owned code
- [ ] 3. Lint, unit tests, wallet-write inventory, source and protocol checks
- [ ] 4. Browser build, bundle and standalone checks, Playwright
- [ ] 5. Copy review of Telligence-owned surfaces against the canon (no middots, plain facts, money-risk caveats only, balance sheet, cash out, holders, JBP6, no inline glossary, short hints)
- [ ] 6. Agent and developer surfaces: llms.txt, AGENTS.md, README/TESTING/DEPLOYMENT, CI workflows at the repo root
- [ ] 7. Render desktop and phone against live data, fix what shows
- [ ] 8. Codex review, fix, open PR (no merge without jango's go-ahead)

## Review

(filled in at the end)
