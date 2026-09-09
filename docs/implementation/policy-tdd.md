# Policy and factory: test evidence

Written September 9, 2026. These results describe local tests and source checks, not an audit or a production deployment.

## Red

`test/unit/ProjectPolicy.t.sol` was written before `ProjectPolicy.sol`. Its first run failed compilation because the implementation did not exist. The test contract specified actual received VVV rather than the terminal return value, donation isolation, rounding up the nonzero floor, prescribed batch/cadence, deadlines, mint output floor, lifetime cap, explicit authority, zero residual approvals, winddown, and return-only recycling.

The stock fixture and `test/integration/TelligenceLifecycle.t.sol` were written before the factory. Their first extension run failed because `TelligenceFactory.sol` and the vault deployer were not implemented. The fixture first demonstrated a complete funding/cashout/return sequence against actual unchanged Juicebox and Revnet source contracts.

A later behavioral regression test, `test_factoryPreservesCreatorAttributionThroughStockCreationFeeRouting`, failed because the creation-fee receiver attributed the payer to the factory instead of the creator. The factory gained the stock `IJBPayerTracker.originalPayer()` forwarding behavior; the regression then passed.

## Green

- All 15 policy unit tests passed, including 4,096 fuzz cases for minimum-output rounding.
- The 14 lifecycle integration cases and the independent stock accounting baseline passed against the current unchanged `REVDeployer`, `REVOwner`, `REVLoans`, Juicebox controller, terminal, terminal store, rulesets, tokens, splits, project registry, and 721 deployment stack.
- Five stateful invariants run actual stock protocol funding and policy allocation/recovery actions; they check custody conservation, immutable project identity and splits, lifetime limits, zero residual approvals, and retained DIEM debt coverage. The CI campaign uses 64 runs of 50 calls; the default campaign uses 256 runs of 100 calls.
- Integration cases cover all-stage routing, Base/VVV accounting, no bridge/premint configuration, operator isolation, reward returns without issuance, real controller burning of late production, an unavailable provider rolling back only allocation, immutable factory binding, exact creation fees, and rejection/atomic rollback of unsafe future stages or zero execution floors.
- `forge fmt --check` and compilation with `--deny notes` pass.
- Own runtime bytecode stays below EIP-170: policy approximately 6.7 KB, factory 13.7 KB, vault 13.5 KB, vault deployer 15.4 KB. Size checks intentionally compile production entry points rather than oversized third-party test fixture implementations.

The offline stock integration fixture uses a no-liquidity buyback registry model and modeled Venice contracts. Separate Base fork tests exercise genuine AMM execution: actual stock Revnet/core/registry/hook contracts, a real pool in Base's deployed Uniswap V4 manager, and the deployed oracle. They prove buyback production, preserved supply through burn/remint, AMM cashout receipts with zero terminal reclaim, and atomic rollback when the policy output floor is missed. See [buyback evidence](buybacks-tdd.md). Actual Venice staking, DIEM mint/stake, and cooldown recovery were separately exercised on a local Base fork; see [vault evidence](vault-tdd.md).

## Reproduction

```sh
cd contracts
npm ci --ignore-scripts --workspaces=false
forge test --no-match-path 'test/fork/**'
forge fmt --check
forge build src/TelligenceFactory.sol src/TelligenceComputeVaultDeployer.sol --sizes --skip '*/test/**' --skip '*/script/**' --deny notes
```

`FOUNDRY_PROFILE=ci` reduces fuzz/invariant runs without replacing the default campaign. The named Base fork tests require `RPC_BASE_MAINNET` and fail explicitly if it is unavailable.

Dependencies are exact npm pins with a cleanly generated lockfile. The installed core and 721 source trees were compared byte-for-byte with the inspected sibling repositories' installed versions. `lib/revnet-core-v6` is an unchanged stock source snapshot at the recorded commit; its presence is a compile-time dependency, not a forked protocol deployment. `lib/forge-std` records its upstream commit and licenses.

## Deliberate policy limits

Initial VVV/project-token and DIEM/VVV floors are binding per-unit ratios in 18-decimal fixed point, rounded up at execution. Creator/recovery may only increase them. A stale or overly restrictive floor can stop investment; it cannot authorize a keeper to weaken output protection. Floor selection must come from a reviewed quote, with explicit user disclosure, rather than arbitrary UI constants.

The lifetime VVV cap never replenishes when rewards or principal return. Excess held VVV is permissionlessly returned to the same Revnet. Funding after the cap or during winddown cannot restart compute: production tokens can be burned through the stock controller. Returns benefit current holders under stock cashout rules and never mint project tokens.

New fundraising is independent of provider execution: the supporter pays the stock terminal; the wrapper cashes out in a separate operation; allocation into Venice is another atomic transaction. A failed provider call leaves realized VVV in the policy for a safe retry or the return-only winddown.
