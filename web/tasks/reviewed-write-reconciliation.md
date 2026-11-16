# Shared reviewed write boundary

Required resources read: `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, `workflow/ponytail/SKILL.md` and `README.md`, `docs/PLAN_REFINEMENT.md`, relevant root `tasks/lessons.md`, and this repository's `tasks/lessons.md`. No descendant AGENTS.md applies to these files.

## Plan refinement

- **Objective:** Route Revnet's reviewed single-contract writes through the same SDK owner as Juicebox, Sticky and Homerun, retaining its transaction journal and blocking changes to account, chain or connector during asynchronous final checks.
- **System fit:** Revnet continues to own call identity, cross-tab serialization, Safe/manual result tracking and gas preflight adapters. SDK `submitReviewedContractWrite` owns review, chain switch, revalidation, simulation, persistence and final account gates. Its final `beforeSend` gate owns the last wallet-context check and proven prewriter refusal cleanup. The only persistence caller, `useMultichainBatch`, restores its exact unchanged hashless submission snapshot after that refusal; ambiguous wallet outcomes retain their journal. Receipt verification and retry restrictions remain unchanged.
- **Reuse and simplicity:** Extract existing review/simulation callbacks with no behavior change and check them, then replace the duplicated orchestration with the SDK boundary. Keep the existing activity and lock owners; callback identity checks supply Revnet-specific view-as, connector and chain guards without a new engine. Reuse SDK `isDefiniteWalletRejection` for batch cleanup instead of its copied cause-chain predicate, and reuse the journal owner's existing serialization for exact prewriter snapshot release.
- **Evidence and unknowns:** Latest SDK 2.24.5 already provides this owner. Current Revnet checks account before its chain switch and persistence callback, leaving both asynchronous boundaries unguarded. Shared SDK switches before revalidation/simulation; adopting that order is intentional. Existing peer edits to exact Safe execution/batch proof are preserved and need the staged SDK preview to test.
- **Verification:** Run existing reviewed-write hook/contract regressions after extraction, then add switch, revalidation, simulation/estimate and persistence identity-drift cases, including connector changes within the same wallet class. Preserve parent review skipping, Safe gas zero, rejected simulation, raw preflight, exact call/lock deduplication and manual receipt behavior. Run focused Vitest, typecheck, lint and write/source gates under the repository's Node 26.5 toolchain.
- **Resource budget:** One writer owns the hook, its focused tests, the single batch persistence callback and its owning journal reset helper/tests; reference client owner retains other Revnet files/source checks. Use a unique task record and staged preview once; no commits, browser wallet sends or deployment. Replan if the shared boundary cannot preserve preflight/journal semantics.

## Work

- [x] Audit latest SDK/Juicebox boundaries and caller-specific persistence.
- [x] Extract and verify existing review/simulation callbacks without changing behavior.
- [x] Use SDK boundary and enforce final account/chain/connector identity.
- [x] Run regressions and owning checks; record results.

## Review

The callback-only extraction passed 22 existing boundary cases before adopting the shared orchestration. Final verification against the staged SDK preview 2 passed all **197 tests** in `reviewed-write-hook.test.tsx`, `reviewed-write-contract.test.ts`, and `multichain-batch.test.tsx` under Node 26.5 with two workers. These include 30 deferred account/disconnection/chain/connector/view-as changes across six asynchronous boundaries, shared execution order, retry after a proven prewriter refusal, exact saved snapshot preservation, definite wallet rejection classification, and ambiguous-write journal retention. Native TypeScript no-emit passed. Scoped Prettier passed; focused ESLint, wallet inventory (142 sites), and source invariants passed before the final preview repeat, with the reference-client owner running final repository-wide static and coverage gates.

The final SDK `beforeSend` callback keeps `currentAccount` pure and moves the last view-as/chain/connector assertion to the owning synchronous SDK gate while earlier callback checks still refuse before persistence. A refusal after persistence restores only an exact unchanged hashless batch snapshot. A wallet write that was actually invoked keeps its journal unless the SDK proves a definite rejection. No wallet transaction, deployment, commit, or push was performed.
