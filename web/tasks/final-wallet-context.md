# Final wallet context guards

Required resources: `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, `workflow/ponytail/SKILL.md`, `workflow/ponytail/README.md`, `docs/PLAN_REFINEMENT.md`, root and repository `tasks/lessons.md`. No descendant instructions apply.

## Plan refinement

- **Objective:** Every Revnet wallet signature, Safe batch proposal and Relayr payment must retain its reviewed account, connector identity, wallet mode and explicit target chain through the final asynchronous check, and refuse before invoking the wallet after any drift.
- **System fit:** The SDK already owns ordinary reviewed-write orchestration and final prewriter cleanup. Revnet's specialized signature and Relayr adapters retain exact payload review, durable authorization/payment records, cross-tab locks and canonical receipt verification. Final synchronous context guards close the specialized async gaps without changing those authorization/recovery owners.
- **Reuse and simplicity:** Extract the existing direct-write wallet-context guard into one local owner and use it at every wallet boundary, preserving caller-specific account error messages. Use SDK payment outcome classification, its prewallet-not-sent signal and its actual-wallet error normalizer; never classify an invoked wallet's ambiguous failure as unsent. The activity owner compares and replaces a proven-unsent exact row instead of merging its prior fields through an upsert. No new transaction engine or legacy migration is needed.
- **Evidence and unknowns:** Read-only inventory identified unguarded switch-to-batch, precondition-to-forwarder-signature, wallet-client-to-Safe-signature and unfunded-check-to-payment intervals, plus missing connector/view-as checks in Permit2. Safe Relayr already checks account/chain after persistence but lacks exact connector identity; root coordinates the shared SDK signal needed to release only a proven unsent payment.
- **Verification:** Add deferred review/switch/client/precondition/persistence regressions at each affected boundary; assert zero wallet calls under drift, retained pending authority after ambiguous wallet failures, exact marker binding for cleanup, and successful unchanged-context paths. Run focused affected suites, types, lint and source/wallet gates before handing the final full run to the reference-client owner.
- **Resource budget:** Parent owns the shared guard, direct/batch and Relayr adapters/tests; one child owns only Safe/Permit2 signature hooks/tests. Reference-client owner has drained full coverage before edits. No dependency mutation, wallet transaction, deployment or commit; stage any SDK export through the root release owner once.

## Work

- [x] Extract the common wallet context guard without changing the direct-write behavior.
- [x] Guard all specialized signature, batch and payment boundaries after their final await.
- [x] Preserve exact pending records and integrate the shared proven-unsent payment outcome.
- [x] Run focused regressions and static gates, then notify the full-suite owner.

## Review

Final verification against qualified SDK preview 4 (`2.25.0`) passed **577 tests across 10 boundary/journal suites** under Node 26.7.0 with the aligned wagmi 3.7.6 and viem 2.55.19 dependencies. Native TypeScript no-emit, scoped ESLint, Prettier, the 142-site wallet inventory, source invariants, diff check and plan checker passed. The reference-client owner was notified that source is frozen and owns the remaining repository-wide coverage/build gates.

The common-guard extraction first passed 113 existing direct-write hook/contract cases. A later regression run demonstrated that an actual wallet-thrown not-sent error could clear a pending marker. Both actual wallet catches now consume SDK `relayrWalletPaymentError`, preserving ordinary rejection identities while keeping that branded error and nested rejection diagnostics uncertain. The passing final suite covers deferred review, switch, wallet-client, revalidation, simulation and persistence scope changes; final quote expiry; exact prior-row restoration; conflicting hash/call/payment-history preservation; and unchanged successful flows. Independent SDK-owner review accepted the final guards and exact journal restore. No live wallet call, deployment, commit or dependency mutation was performed by this task.
