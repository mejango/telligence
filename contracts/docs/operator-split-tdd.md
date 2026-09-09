# Creator token allocation: TDD evidence

The confirmed request is a creator share of Revnet tokens issued during funding. Compute remains its own allocation; creator compensation is ordinary project-token ownership. The policy remains the sole technical Revnet operator, and no stock contract or hook changed.

## Red

First, the appended stage field and explicit zero values in existing fixtures allowed the new test inputs to compile while the factory still ignored creator allocation. The [recorded stock regression run](operator-split-red.log) then had **nine failures and two passing baseline cases**. Failures included missing creator tokens, an unchanged supporter share, absent creator routing, accepting a 100% combined reserved share, accepting a changing beneficiary ratio across stages, and the prior policy version.

## Green

The factory now constructs the combined reserved allocation and two locked recipients, rejects invalid totals and changing stage ratios, and identifies the schema as policy version 2. The [same stock suite](operator-split-green.log) passes **11 tests**, including 256 fuzz cases over fractional creator allocations and raw funding amounts. The tests cover:

- Original zero-creator issuance and routing.
- Actual 40% compute / 10% creator / 50% supporter issuance without protocol authority for the creator.
- Positive compute and supporter allocations, maximum-width input rejection, and atomic refusal.
- Immutable routing under both creator calls and the actual stock operator permission.
- Stock rounding residue, permissionless burning, conservation, and a bound on ratio quantization toward compute.
- Delayed reserved distribution across a scheduled stage transition.
- A commitment binding the actual creator recipient and policy version.

Four additional [economic tests](../test/economics/OperatorSplitEconomics.t.sol), with their [final strengthened assertions passing](operator-split-economics-green.log), exercise early creator cashouts, cashout ordering, and reward/principal recovery through the real factory and stock V6 accounting. The [complete nonfork suite](operator-split-full-green.log) passes **120 tests across 10 suites**, with 256 fuzz runs and 64 invariant runs of depth 50. Formatting and source-only deployment-size checks also pass; factory runtime is 14,257 bytes.

## Reproduce

```sh
cd contracts
FOUNDRY_PROFILE=ci forge test --match-contract TelligenceOperatorSplitTest --deny notes -vv
FOUNDRY_PROFILE=ci forge test --match-contract OperatorSplitEconomicsTest --deny notes -vv
FOUNDRY_PROFILE=ci forge test --no-match-path 'test/fork/**' --deny notes -vv
forge fmt --check
```

The stock local fixture models the no-liquidity route. The [four existing Base fork tests](operator-split-base-fork.log) also passed against real AMM and provider integrations. A further actual-factory AMM case first [failed with creator allocation omitted](operator-split-amm-red.log), then [passed alongside both existing AMM cases](operator-split-amm-green.log). It exercises a real buyback swap, 40% compute / 10% creator / 50% funder remint allocation, conserved token supply, policy-only authority, and a subsequent AMM cashout whose terminal reclaim is zero. The provider adapter is mocked in this AMM test; the two separate Venice fork cases cover the real provider contracts.

These runs cover five distinct fork cases, without broadcasting transactions. They do not establish live Venice account readiness, production deployment, or external audit.

```sh
FOUNDRY_PROFILE=ci forge test --match-path 'test/fork/TelligenceVeniceFork.t.sol' --deny notes -vv
FOUNDRY_PROFILE=ci forge test --match-path 'test/fork/TelligenceBuybacksFork.t.sol' --deny notes -vv
```

Supply the Base RPC environment required by the fork fixtures when reproducing them.
