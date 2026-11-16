# Navigation context import extraction

## Plan refinement

- **Objective:** Reduce avoidable project-route JavaScript import coupling while preserving every navigation, identity verification and transaction review outcome.
- **System fit:** The full ProjectRouteBoundary remains the layout's verification owner, the global TransactionReviewProvider remains the queue/execution-consent owner, and their existing contexts carry registration and navigation to consumers. No evidence freshness, authority, cancellation, recovery or provider props change.
- **Reuse and simplicity:** Move the existing review scope type/context/hook to TransactionReviewScope, and the existing route context/page boundary/navigation hook to ProjectRouteContext. Update every consumer directly; no compatibility re-exports, duplicate contexts or new policy.
- **Evidence and unknowns:** Identical-dependency builds show duplicate review/boundary implementations after server QueryClient imports were corrected. Existing source and interaction tests define behavior; byte savings remain unknown until the coordinator rebuilds the extraction.
- **Verification:** Run existing route navigation, review scope/queue/dialog/snapshot, project page/layout, menu and graph/subtab tests; run typecheck, focused ESLint, source invariants and format ratchet. Independently review moved bodies and all import callers. Coordinator owns a fresh build and bundle comparison.
- **Resource budget:** One behavior-preserving extraction commit in the integration checkout; no builds, installs, fixture changes, browser ports or shared task-log edits. Parallelize read-only review with focused verification, then hand off the immutable commit for measurement.

## Work

- [x] Move both shared contexts and their existing consumers without behavior changes.
- [x] Update test imports/mocks and run focused verification.
- [x] Review diff and record tested extraction commit.

## Review

Fifteen focused suites / 107 tests passed, including route rebinding and failed proof, review cancellation/queue races, layout/page identity, menus, graph queries, and transaction review rendering. Typecheck, focused ESLint, source invariants, source-only production audit, full format ratchet and diff whitespace checks passed on Node 26.5.0. Independent read-only review found one context owner per concern, exact moved bodies, direct imports and unchanged assertions. No cache, authority, review or navigation policy changed. Production bundle savings remain pending the coordinator's controlled build.

Workspace requirements: `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, `workflow/ponytail/SKILL.md`, `workflow/ponytail/README.md`, `docs/PLAN_REFINEMENT.md`, root/application `tasks/lessons.md`, and `docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md`.
