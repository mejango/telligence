# Compute fundraising economics

The starting configuration is **40% compute production / 0% creator allocation / 10% cashout tax**. It is an illustrative product preset, not a calibrated optimum or a promise that 40% of contributions becomes compute. In the deterministic stock V6 baseline below, a 100 VVV contribution produces **35.705475 VVV available in the policy for compute**, with working VVV fee routes. Actual allocation, provider recognition and daily inference capacity are separate steps.

These are executable observations, not financial recommendations. They contain no VVV price forecast, gas-cost estimate, claimed return, or fixed conversion from VVV into API usage.

## Optional creator allocation

The baseline below assumes a 0% operator allocation. Version 2 can separately
allocate newly issued tokens to the creator while keeping compute at the
webclient's 40% preset; funders receive the remainder. A 10% operator allocation
therefore produces a 40/10/50 split, not a 10% payout from future earnings.

The [creator allocation simulations](../contracts/test/economics/operator-split.md)
use the same unchanged stock accounting at the historical **60% cashout tax**. Their 10% creator allocation is a separate parameter from the new 10% tax preset. They show that creator tokens can be
cashed out before any project revenue and that exit order changes compute
proceeds. Retained creator tokens also participate in recovered principal as
ordinary holder tokens. The allocation is not a permanent ownership percentage
or a guarantee of returns.

## What was simulated

[ComputeEconomics.t.sol](../contracts/test/economics/ComputeEconomics.t.sol) deploys the actual unchanged stock Juicebox controller, terminal, terminal store, tokens, splits, project registry, `REVDeployer`, `REVOwner` and `REVLoans`, then pays and cashes out through the actual `ProjectPolicy`. A normal ERC-20 fixture at the canonical VVV address provides local test funding. The no-liquidity routing fixture keeps the measurement on direct issuance and the terminal cashout curve.

Each matrix observation starts with a fresh Base project, no previous supply or balances, no premint, no loans or other holder cashouts, no remote balances, no yield, and no issuance decay. Initial issuance is 1,000 project tokens per VVV. The policy receives the entire production split and cashes out all its production tokens in one batch. The policy and `REVOwner` are not fee-exempt. The main matrix explicitly configures the Revnet fee destination and core fee project #1 to accept VVV; both are the same fee project in this fixture, and fee processing succeeds.

Batch and lifetime ceilings in the baseline are deliberately large enough not to bind; the fixture's output floors are deliberately permissive to observe the curve. **Those test limits are not proposed launch settings.** Separate cases below exercise binding limits. No gas, keeper, Railway, RPC, exchange, or provider operating expense is deducted. The reported “net” includes actual applicable onchain fees only.

## The default at three contribution sizes

All amounts are VVV. “Policy receives” is actual received VVV before investment into the provider. “Treasury” is the original Revnet's recorded liquid balance after conversion; it excludes that received VVV.

| Contribution | Policy receives | Remaining treasury | VVV credited to fee destinations |
| ---: | ---: | ---: | ---: |
| 1 | 0.35705475 | 0.624422376 | 0.018522874 |
| 100 | 35.705475 | 62.4422376 | 1.8522874 |
| 10,000 | 3,570.5475 | 6,244.22376 | 185.22874 |

The proportional scaling here comes from identical isolated starting conditions and one conversion batch. It does not establish a constant rate for a project that already has holders, retained reserve, loans, staged issuance, market liquidity, or earlier conversions.

## Production and tax comparison

The test covers **all 36 combinations** of contribution sizes 1 / 100 / 10,000 VVV, production shares 20% / 40% / 60%, and cashout taxes 0% / 10% / 60% / 90%. This table shows the 100 VVV observations with successful fee routing. [Exact results in base units](../contracts/test/economics/results.csv) retain every scale.

| Production share | Cashout tax | Policy receives | Remaining treasury | VVV fees |
| ---: | ---: | ---: | ---: | ---: |
| 20% | 0% | 20 | 80 | 0 |
| 20% | 10% | 17.48199375 | 81.61066915 | 0.9073371 |
| 20% | 60% | 9.8294625 | 89.69303355 | 0.47750395 |
| 20% | 90% | 5.23794375 | 94.565742375 | 0.196313875 |
| 40% | 0% | 40 | 60 | 0 |
| **40%** | **10%** | **35.705475** | **62.4422376** | **1.8522874** |
| 40% | 60% | 24.10785 | 74.7683068 | 1.1238432 |
| 40% | 90% | 17.149275 | 82.2560403 | 0.5946847 |
| 60% | 0% | 60 | 40 | 0 |
| 60% | 10% | 54.67044375 | 42.4930591 | 2.83649715 |
| 60% | 60% | 42.8351625 | 55.2121276 | 1.9527099 |
| 60% | 90% | 35.73399375 | 63.046358125 | 1.219648125 |

A larger production share changes supporter issuance and remaining liquid backing as well as compute funding. A higher cashout tax changes holder exit economics as well as the wrapper's conversion. This matrix does not select an optimal combination or evaluate demand, utilization, project accountability, or market liquidity.

## Why 37.6% gross becomes 35.705475% net

For an isolated direct-issuance contribution, let `S` be VVV raised, `r` the production-token share, and `t` the cashout-tax fraction. Ignoring fees and integer rounding, the stock curve gives:

```text
F(x) = x × (1 − t + t × x)
gross cashout of all production = S × F(r)
```

For the current preset, `r = 0.4` and `t = 0.1`, this is `S × 0.376`: 37.6% before fees. The historical 60% tax case instead gives `S × 0.256`.

With a working VVV Revnet fee terminal and nonzero tax, stock `REVOwner` takes its fee from **token count** before the wrapper's curve calculation. With `f = 1/40 = 2.5%`, the wrapper's non-fee fraction is `a = r × (1 − f) = 0.39`. The terminal then takes its own applicable fee from gross wrapper proceeds:

```text
wrapper gross = S × F(a)
wrapper net   = wrapper gross × (1 − f)
              = S × 0.39 × (0.9 + 0.1 × 0.39) × 0.975
              = S × 0.35705475
```

The Revnet's fee-token portion is separately cashed out against the remaining supply and reserve. It is not simply 2.5% of the first gross amount. Exact source math uses integer flooring in `JBCashOuts.cashOutFrom` and `JBFees.standardFeeAmountFrom`; the nested tax-ratio floor also matters to the fee-tranche calculation. At 100 VVV, the current preset and historical comparison settle as follows:

| Settlement component | Current 10% tax, VVV | Historical 60% tax, VVV |
| --- | ---: | ---: |
| Wrapper gross before terminal fee | 36.621 | 24.726 |
| Wrapper's actual net receipt | 35.705475 | 24.10785 |
| Revnet fee tranche, gross | 0.9367624 | 0.5056932 |
| Revnet fee credit after its terminal fee | 0.91334334 | 0.49305087 |
| Core fees across wrapper and fee-tranche settlement | 0.93894406 | 0.63079233 |
| Remaining original-project treasury | 62.4422376 | 74.7683068 |

See the pinned [stock REVOwner source](../contracts/lib/revnet-core-v6/src/REVOwner.sol) and the core library versions in [the dependency lock](../contracts/package-lock.json).

Fee availability is part of the quote. In the retained historical case where neither fee route accepts VVV, a 100 VVV / 40% compute / 60% tax project pays the wrapper **24.96 VVV** and retains **75.04 VVV** in its treasury. The Revnet token fee is bypassed; the terminal withholds its 0.64 VVV fee but credits it back to the originating project when fee routing fails. It does not refund that fee to the wrapper and does not create a held-cashout-fee record. The core and Revnet fee destinations can be different in a deployment, so each route must be inspected independently.

Zero tax has no fee in this fresh-funding matrix because the ordinary payment starts with no `feeFreeSurplusOf` exposure. Other flows can create that counter, and then a zero-tax cashout can incur a terminal fee on the exposed portion. An existing fee-exemption configuration would also change the outcome.

Successful fee payments can mint fee-project tokens to the policy as the cashout holder. Those ancillary balances are excluded from these VVV figures, from liquid treasury, and from compute capacity. The policy has no general conversion or withdrawal authority for them.

## Timing and batch size change the result

The following historical cases all receive 100 VVV in total, use 40% production / **60% tax**, and have successful fee routing. Their exact amounts are not estimates for the new 10% tax preset. Issuance stays constant, other holders do not exit, and no provider investment or yield occurs between operations. The cadence is one day in the test.

| Funding and conversion schedule | Policy receives | Remaining treasury | VVV fees |
| --- | ---: | ---: | ---: |
| One 100 VVV contribution, one conversion of 40,000 production tokens | 24.10785 | 74.7683068 | 1.1238432 |
| Ten 10 VVV contributions, each followed by its own conversion | 21.562536295 | 77.372586329 | 1.064877376 |
| One 100 VVV contribution, four conversions of 10,000 production tokens | 19.725116921 | 79.294752039 | 0.980131040 |

The latter rows are rounded to nine decimals; exact base-unit results are in the CSV. Accumulated stock integer rounding puts the full recorded component sums within a few wei of 100 VVV, and the tests bound that difference.

Earlier conversions burn supply and withdraw reserve before later contributions or conversions are priced. Splitting a fixed production balance into smaller cashouts repeatedly applies the curve to a different supply and reserve. **Cadence and maximum batch size are economic policy, not just a keeper scheduling preference.** The contract prescribes the batch so a keeper cannot choose arbitrary tiny conversions; that still leaves the selected launch limits consequential. These schedules compare specific states and do not prove that any one cadence is generally preferable.

## Floors, caps and activation

The baseline tables do not override the actual policy's execution guards. These retained guard scenarios use the historical 60% tax setting; their numeric outcomes are labeled accordingly:

- **Minimum batch:** at 1,000 initial tokens per VVV and 40% production, a 1 VVV contribution accrues 400 production tokens. With a 1,000-token minimum batch, conversion reverts, the whole 1 VVV stays in reserve, and no compute backing has been acquired. Time passing alone does not satisfy a token-count minimum.
- **Output floor:** after cumulative funding reaches 3 VVV, that example accrues 1,200 production tokens. An overly strict 0.001 VVV-per-token floor would require 1.2 VVV from the batch; the actual curve cannot satisfy it. The entire attempted cashout reverts, leaving the 3 VVV reserve and 1,200 production tokens intact. Floors can only increase, so they must be reviewed before launch; winddown remains the prescribed return-only route when investment cannot proceed.
- **Lifetime allocation cap:** the historical 60% tax, 100 VVV example realizes 24.10785 VVV. With a 10 VVV investment cap, only 10 VVV is committed; `returnUnallocatedVVV()` returns the other 14.10785 VVV without minting project tokens. The original treasury becomes **88.8761568 VVV**, while 1.1238432 VVV has gone to fee destinations. The cap test uses a narrow vault fixture to verify the policy transfer and return accounting, not to claim that Venice recognized any credit.
- **Late production:** subsequent direct protocol funding remains possible after the cap. Its production tokens can be burned without restarting compute or removing more treasury VVV. The cap never replenishes when value returns. The UI should stop soliciting endowment growth that the policy cannot allocate.

Expected activation therefore depends on accrued production, prescribed batch, cashout availability, output floors, allocation cap, provider execution and recognition. A funding event alone is insufficient evidence of new usable capacity.

## AMM and provider boundaries

Normal buybacks remain enabled. The separate [real Base AMM tests](implementation/buybacks-tdd.md) prove that a supporter payment can create production through stock buyback burn/remint, and that the policy can receive AMM cashout VVV while the terminal reports zero reclaimed reserve. Pool price, price impact, oracle history, fees and liquidity make those amounts state-dependent. The deterministic direct-issuance table is not an AMM quote.

VVV actually received is still not a guaranteed DIEM amount or daily API budget. Provider mint pricing, retained obligations, cooldowns, recognition and service availability belong to the [vault integration](implementation/vault-tdd.md). Allocation can be capped, delayed, or fail independently of fundraising. Returned VVV improves the original Revnet's reserve for current holders under its rules; it does not provide original-donor refunds.

## Reproduction and evidence

```sh
cd contracts
npm ci --ignore-scripts --workspaces=false
forge test --match-contract ComputeEconomicsTest --deny notes -vv
```

Six deterministic tests cover the 36-point matrix, the independently calculated 10% tax preset, historical absent fee routes, repeated funding and conversion schedules, batch/output guards, and cap/excess-return handling. They assert actual wrapper receipts, accounting conservation, scale behavior, production-token amounts, the independently derived default net result, no-mint recycling, and protected state after refused conversion. No production contracts were changed for this report.

The exact [CSV](../contracts/test/economics/results.csv) records 43 observations in 18-decimal VVV base units: 36 matrix points and seven retained historical guard/timing observations. For `allocation_cap_10_vvv`, the reported available amount is the VVV actually transferred into the vault fixture; other successful rows report VVV received by the policy. These results test the stated assumptions and do not constitute a deployment or an optimal-preset claim.

For the 10% preset change, the negative control retained the old 60% configuration while asserting the new independently derived receipt; it failed at 24.10785 versus 35.705475 VVV. Changing that scenario to 10% and expanding the matrix produced six passing focused economics tests. This verification did not rerun the complete application build.
