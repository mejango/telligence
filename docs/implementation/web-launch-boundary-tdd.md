# Web launch and payment boundary TDD

The review compared `web/src/lib/telligence/{launch,pending-launch,factory,transactions}.ts` directly with `TelligenceFactory`, `ProjectPolicy`, their structs, and the generated Foundry ABI.

## Red

Added `web/test/telligence-launch-safety.test.ts` and `web/test/telligence-pending-safety.test.ts` before changing production helpers. The first run reported **21 failing and 12 passing tests**. Failures demonstrated:

- Launch cadence accepted values outside the policy constructor's one-hour through 30-day range.
- Names below the UI character limit could exceed the factory's 128-byte UTF-8 limit.
- Zero cash-out tax was rejected despite being allowed by the actual factory.
- Native creation values and payment arguments could exceed their uint256 bounds.
- Payment terminal and beneficiary addresses were not validated by the underlying SDK builder.
- Untrusted pending records accepted invalid preparation UUIDs, a zero factory, numeric credit targets, falsy recovery fields silently replaced by creator defaults, and impossible 100% production allocations.

## Green

The helpers enforce the actual constructor/ABI bounds before constructing wallet requests. `validateComputeDraft` reports the name byte limit in the form. Pending parsing checks exact types, nonzero addresses, UUIDv4 preparations, and executable draft economics; it strips extra fields without restoring credentials. A malformed existing storage record must remain a blocking recovery state in the launch component; a parser `null` is not evidence that no transaction was submitted.

Two additional ABI tests compare every exposed factory function selector and complete launch calldata against the generated Foundry ABI, then decode the real deployment event while rejecting another creator, another emitter, or ambiguous duplicates. ABI artifacts are regenerated and checked for drift by the repository CI.

The completed focused run passed **53 tests across six suites**, including 35 new safety/ABI tests and the existing launch, pending, transaction, and presentation tests. Targeted ESLint and formatting pass. The broader frontend typecheck is coordinated with concurrently developed component and route tests.

The launch lifecycle component, provider activation, transaction recovery, and contract tests have separate coverage; these pure-helper tests do not substitute for those flows.
