# Wallet lifecycle review and TDD

September 9, 2026. External wallet, RPC, storage timing, and gateway boundaries are mocked; production launch/payment encoders and receipt decoders execute in the tests.

## Launch

`web/test/telligence-launch-lifecycle.test.tsx` has **18 passing tests**. Its initial run found five production defects: missing comparison against displayed financial terms, stale pending state from another tab, discarded corrupt recovery records, an enabled unreviewed launch, and invalid signer-preparation timestamps. An additional initial failure asserted an error message during an account switch; the component intentionally clears transient messages for the new account. That assertion was replaced with checks that no preparation or wallet request occurred. The recorded initial log is [`launch-lifecycle-red.log`](launch-lifecycle-red.log).

The launch now compares every reviewed deployment address and policy integer with the fetched configuration before preparing a new project. Saved registration resumes independently of the current launch preset. UUIDs, signer addresses, and finite unexpired preparation timestamps are checked before the wallet boundary. Persisted recovery is reread immediately before action; malformed records remain stored and stop new deployment.

A second red run demonstrated three lifecycle failures during unmount, an already submitted wallet response, and a draft change. Generation checks now stop asynchronous work when account, draft, or mounted lifetime changes. The same check runs through the inherited reviewed-write hook's final `beforeSubmission`, after simulation and network switching. If a transaction was already sent, its returned hash is still persisted before dependent work stops. See [`launch-lifecycle-unmount-red.log`](launch-lifecycle-unmount-red.log).

A third red run demonstrated the missing creator-level lock. A `navigator.locks` lock now covers configuration, signer preparation, metadata, transaction review, submission, and durable hash persistence. The storage read occurs inside that lock. The lock releases before receipt waiting, allowing another tab to resume the saved transaction instead of preparing another random salt. Browsers without Web Locks retain synchronous/repeated storage checks, but do not gain the stronger cross-tab serialization guarantee. See [`launch-lock-red.log`](launch-lock-red.log).

The complete green suite also verifies EOA registration, Safe proposal/execution-hash recovery, original-account recovery after switching accounts, a gateway registration failure without another deployment, reload recovery, mismatched creator events, and retry only after a confirmed revert. See [`launch-lifecycle-green.log`](launch-lifecycle-green.log).

## Funding

`web/test/telligence-funding.test.tsx` has **9 passing lifecycle tests**. Three newly written tests failed before correction: a successful Safe outer receipt with no payment event was accepted; an empty saved recovery record was ignored; and resumed payment confirmation did not consult the immutable terminal binding. See [`funding-lifecycle-red.log`](funding-lifecycle-red.log).

Payment confirmation now requires exactly one matching canonical terminal `Pay` event for the original Revnet, payer, beneficiary, and VVV amount. A Safe's outer transaction status alone cannot clear payment recovery. Resume derives the terminal from the original policy directly, so it works during gateway outages and after fundraising closes. New payments still verify factory identity and the configured canonical terminal before approval.

The inherited reviewed-write hook marks payments as requiring manual receipt verification, including Safe submissions. The activity is released as successful only after that exact event check. Malformed stored contribution data, including an empty string, is preserved and stops a new contribution. The suite also verifies exact approvals, fresh quotes after approval, substituted-terminal rejection, unmount, account change, uncertain-payment retry without paying again, and asynchronous Safe approval recovery. See [`funding-lifecycle-green.log`](funding-lifecycle-green.log).

The separate `web/test/telligence-funding-receipt.test.ts` adds **14 passing decoder tests** after **9 initial failures**. They reject absent, malformed, duplicate, mismatched, or reverted payment evidence and accept normal buybacks even when new issuance is zero. The event has no token field: its VVV interpretation depends on the factory's immutable single-token accounting configuration.

## Verification

```sh
cd web
npm test -- test/telligence-launch-lifecycle.test.tsx test/telligence-funding.test.tsx test/telligence-funding-receipt.test.ts
npm run typecheck
```

Targeted source/test ESLint passes with zero warnings. Full web typechecking also passes. Helper integer, address, UTF-8, saved-intent, and generated Solidity ABI checks are documented separately in [`web-launch-boundary-tdd.md`](web-launch-boundary-tdd.md).

A wallet transport failure after acceptance but before returning a transaction hash remains an ambiguous submission. Neither a JavaScript mutex nor a receipt decoder can prove nonexecution in that window. The application must recover wallet history rather than infer that the project did not deploy. These deterministic tests are not evidence of funded browser or provider canary execution.
