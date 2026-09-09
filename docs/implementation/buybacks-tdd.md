# Standard buybacks: executable integration evidence

The user explicitly retained stock Revnet buybacks. `contracts/test/fork/TelligenceBuybacksFork.t.sol` verifies both sides of that route through genuine AMM execution on a local Base fork at block 51,091,381.

## Components exercised

- Actual unchanged stock `REVDeployer`, `REVOwner`, `REVLoans`, Juicebox controller, terminal, store, rulesets, tokens, splits, project registry and empty 721 stack are deployed locally on the fork.
- Actual unchanged npm-pinned `JBBuybackHookRegistry` and `JBBuybackHook` handle callbacks and token movements.
- The test uses the real Base Uniswap V4 PoolManager at `0x498581fF718922c3f8e6A244956aF099B2652b2b` and deployed oracle hook at `0xf70B71605f1C0A8Ff7580557645BB7e29fE495c8`. Those addresses were also read from the deployed stock Base buyback hook.
- The stock Revnet deployer initializes a fresh VVV/project-token pool. A test participant supplies genuine liquidity and executes an ordinary market sale, with actual V4 unlock, swap and settlement callbacks. Oracle history matures on the fork; no oracle result or pool quote is mocked.
- A standard ERC-20 fixture at the canonical VVV address permits local funding. The vault is a narrow fixture because these tests isolate the Revnet/AMM boundary; actual Venice backing is covered separately in the provider fork suite.

## Verified behavior

1. A supporter payment executes the stock hook's actual `Swap` event and receives more tokens than direct issuance at that moment. Its acquired tokens are burned/reminted with the standard production percentage. The policy receives production tokens even though the entire payment does not become fresh terminal reserve; total project-token supply is preserved for the fully swapped payment.
2. The policy's next bounded cashout executes the hook's actual `CashOutSwap` event. VVV is delivered to the policy, while the real terminal's `CashOutTokens.reclaimAmount` is zero. The policy succeeds because it enforces the actual balance delta, independently of the terminal return value.
3. An output floor above realizable AMM proceeds causes the entire cashout to revert. The project's token balances, treasury, pool price and policy cadence are unchanged after the revert.

The tests were written to require genuine hook swap events and real terminal event values, so passing through a mint or terminal-only fallback cannot satisfy them. Initial runs exposed test-fixture token-funding and event-decoding mistakes; after fixing the fixture, both actual AMM scenarios passed without any production-contract changes. The default offline fixture gained only a virtual registry-construction method so this test can reuse the same complete stock deployment.

## Reproduce

```sh
cd contracts
RPC_BASE_MAINNET=https://mainnet.base.org forge test --match-contract TelligenceBuybacksForkTest --deny notes -vv
```

The endpoint is required and the tests fail when it is unavailable. All transactions and pool changes are local fork simulation; no live funds are used and nothing is broadcast. [Recorded output](buybacks-base-fork.log) is integration evidence, not an audit or a funded production canary.
