# Creator allocation: executable economics

`OperatorSplitEconomics.t.sol` deploys the real Telligence factory and unmodified Juicebox / Revnet V6 contracts. Its single-stage fixture allocates 40% of newly issued project tokens to compute, 10% to the creator, and 50% to the paying supporter. Cashout tax is 60%; initial issuance is 1,000 project tokens per VVV. A working VVV fee terminal receives actual stock fees.

The creator allocation is ordinary, transferable project ownership. It does not make the creator the protocol operator: that role remains the constrained `ProjectPolicy`. Funding 100 VVV issues 40,000 compute tokens, 10,000 creator tokens, and 50,000 supporter tokens. The entire 100 VVV initially enters the project treasury; no creator cash payment occurs on funding.

## What ownership permits

The creator can cash out against the funded treasury before the project produces work or revenue. A 10% token allocation is therefore economically valuable at launch, and must be disclosed to supporters. It is neither a 10% immediate cash payment nor a promise of 10% of later earnings. Cashout tax, stock fees, burns, future funding, and transfers change the outcome.

The tests compare creator cashout before and after compute conversion, and reconcile actual creator receipts, compute receipts, project treasury, and the VVV fee treasury. All four buckets sum exactly to the original 100 VVV. Transaction order changes both beneficiaries' receipts and the treasury retained for remaining holders.

## Exact observed VVV balances

| Sequence after the 100 VVV payment   |   Creator received | Compute received |      Project treasury |         Fee treasury |
| ------------------------------------ | -----------------: | ---------------: | --------------------: | -------------------: |
| Creator exits; compute untouched     |        4.358615625 |                0 |            95.4233516 |          0.218032775 |
| Creator exits, then compute converts |        4.358615625 |   26.60880159366 | 67.582271928447920001 | 1.450310852892079999 |
| Compute converts, then creator exits | 5.8934365452909375 |         24.10785 | 68.586001265830551251 | 1.412712188878511249 |

Each row sums to exactly 100 VVV, including the final base unit. The first creator receipt independently follows the stock cashout calculation: `100 × 0.0975 × (0.4 + 0.6 × 0.0975) × 0.975 = 4.358615625 VVV`. A 10% project-token balance encounters both the stock Revnet token fee and terminal cashout fee.

In this fixture, cashing out the creator first leaves less for the creator and remaining treasury, but more for compute conversion. The test asserts these directions as well as conservation. It does not assume they describe every configuration or market route.

## Recovery stays separate

A further test allocates the compute proceeds through the production vault into mocked Venice positions, realizes a modeled 3 VVV reward, and completes the full notice / cooldown / unwind sequence. Both the reward and recovered principal return in full through `addToBalanceOf`; supply and individual project-token balances do not increase, and no creator percentage is skimmed. A creator who retains project tokens can subsequently cash out against the recovered treasury as a current holder.

After the modeled reward and complete principal recovery, the creator cashes out 8.0301492875175 VVV, leaving 93.452406752144770001 VVV in the project treasury and 1.517443960337729999 VVV in the fee treasury. These sum exactly to the original 100 VVV plus the 3 VVV reward; no compute principal remains outside the treasury.

The 3 VVV reward is injected by the fixture. It is not a yield estimate.

## Scope

The tests exercise the stock no-liquidity buyback route, without changing production buyback behavior. They do not model AMM pricing or liquidity, changing VVV prices, gas, loans, remote balances, issuance decay, future contributions, or actual Venice credit recognition. The numerical results characterize this fixture only; they are not a recommended allocation, funding estimate, fixed revenue entitlement, or compute-capacity guarantee.

Run from `contracts/`:

```sh
forge test --match-contract OperatorSplitEconomicsTest -vv
```
