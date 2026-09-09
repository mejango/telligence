# Creator options: follow-up TDD evidence

Creators can leave the daily compute goal blank and choose their share of newly
issued Revnet tokens. The form defaults to 40% compute, 0% operator, and 60%
funders; the funder allocation remains positive. This record covers the follow-up
change, independently of the earlier [repository delivery](repository-delivery.md).

## Red and resulting behavior

[Recorded failure excerpts](creator-options-red-excerpts.log) establish the
missing optional-goal form/registration behavior, missing operator input, and
missing factory-version launch guard before their implementations. The backend
run failed seven of eight cases; the UI runs failed three of 27 and one of seven;
the version-boundary run failed nine of 30. Contract allocation has its own
[red/green record](../../contracts/docs/operator-split-tdd.md).

The goal now serializes as null when absent and remains informational when set.
Registration previously reused that goal as an enforced spending cap; it now
keeps those concepts separate. PostgreSQL tests prove that existing explicit
caps survive migration and that keys still share verified provider credit,
outstanding reservations, and daily usage. Restarting an already migrated schema
does not require a conflicting project-table write lock.

The operator input uses exact basis points, preserves the creator's choice when
editing/resuming, and invalidates acknowledgement when terms change. Review and
calldata agree on compute/operator/funder allocation; changing terms during
metadata pinning prevents the wallet write. The factory locks the creator's
reserved-token recipient while keeping ProjectPolicy as the sole technical
operator. Creator tokens have ordinary transfer and cashout rights.

The new ABI requires policy version 2 for new launches. Existing version 1
projects remain supported for funding and recovery. Services verify the observed
version, runtime, project identity, and policy at one identified safe Base block,
then recheck its hash; registration does not trust a client-supplied version.

## Verification

| Scope | Observed result |
| --- | --- |
| Nonfork contracts | [120 passed across 10 suites](../../contracts/docs/operator-split-full-green.log), including fuzz and invariants. |
| Base provider integration | [Two Venice fork cases passed](../../contracts/docs/operator-split-base-fork.log). |
| Base AMM integration | [Three AMM fork cases passed](../../contracts/docs/operator-split-amm-green.log), including an actual-factory 40/10/50 allocation with conserved supply and policy-only authority. |
| Services with isolated PostgreSQL | [137 passed, zero skipped](creator-options-services-green.log). |
| Telligence web tests | [384 passed across 25 files](creator-options-web-green.log). |
| Production browser build | [Next build and TypeScript passed](creator-options-browser-build.log). |
| Browser suite, five widths | [125 passed initially](creator-options-browser-initial.log); five dialog cases expected the superseded heading. After correcting that fixture, [all five affected cases passed](creator-options-browser-rerun.log), with no retries. |

Scoped ESLint/Prettier, source invariants, wallet-write inventory, and diff
whitespace checks also passed. The wallet inventory covers 139 boundaries across
13 surfaces and 31 documented actions. The operator allocation was inspected at
390px with 40% compute, 10.25% operator, and 49.75% funders.

The browser result combines the initial run and the affected-spec rerun; it is
not a second complete 130-case run. The inherited full web coverage suite was
not rerun for this follow-up. Logs remove terminal color codes, trailing
whitespace, and the machine-specific repository prefix; the red excerpt file
is explicitly abbreviated.

## Reproduce

Use the repository-pinned toolchain and an isolated `TEST_DATABASE_URL`:

```sh
npm run test:contracts
npm run test:services
npm --prefix web test -- test/telligence
npm --prefix web run build:browser
npm --prefix web run test:browser -- --workers=4 --retries=0
```

The [contract record](../../contracts/docs/operator-split-tdd.md) includes the
fork commands. Forks exercised real Base contracts without broadcasting. This
verification did not deploy policy version 2, provision a live Venice account,
or make a funded inference request.

## Follow-up: remove the goal and use 10% cash-out tax

The creator form and review no longer show a daily compute goal. New projects
continue to serialize the absent goal as null; existing metadata remains readable.
The form now has two numbered sections. New launches use a 10% cash-out tax in
both review and calldata. The Learn page and architecture description reflect
the shorter form.

The updated existing web tests [failed first](no-goal-tax10-web-red.log) on the
visible goal and the former 60% launch tax. After the change, [all 384 Telligence
web tests passed](no-goal-tax10-web-green.log). The production build, scoped
ESLint/Prettier, and [30 create-page browser checks across five widths](no-goal-tax10-browser-green.log)
also passed. The browser checks cover the two-step layout, 10% terms, operator
validation, review acknowledgement, keyboard use, and accessibility.

The [economics regression failed first](no-goal-tax10-economics-red.log) against
the former 60% fixture; [all six focused economics tests passed](no-goal-tax10-economics-green.log)
with 10% added to the comparison matrix. See the updated [economic observations](../economics.md)
for the new preset and the explicitly retained 60% comparison scenarios.
