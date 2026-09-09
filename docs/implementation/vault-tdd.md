# Compute vault: implementation and TDD evidence

Implemented on September 9, 2026 in `contracts/`, using Solidity 0.8.28 and the V6 repository conventions.

## Red, green, and integration

1. Wrote an executable vault interface/skeleton and seventeen tests before implementing allocation or recovery. The initial run compiled and returned **11 failures, 6 passes**, with failures explicitly `not implemented`. Tests that expected rejection passed against the skeleton and were not counted as evidence of working behavior. See [`vault-red.log`](vault-red.log).
2. Implemented the production vault, preserving the test expectations. All seventeen tests passed, including **4,096 allocation/recovery fuzz cases**.
3. Added adversarial coverage for incorrect chain/asset/policy deployment, signer authority, permanent authentication shutdown, unsolicited DIEM, and isolation between projects. The resulting **24 tests pass**, with the same 4,096-case fuzz property. See [`vault-green.log`](vault-green.log).
4. Executed two read-only Base fork tests against real provider bytecode at block **51,091,381**. Both pass. They demonstrate VVV → sVVV → DIEM → staked DIEM, real minimum-output rollback, notice, the actual provider cooldowns, full aggregate DIEM burn, and return of principal plus realized rewards. No transaction was sent to Base. See [`vault-base-fork.log`](vault-base-fork.log).

Reproduce:

```sh
cd contracts
forge test --match-contract TelligenceComputeVaultTest -vv
RPC_BASE_MAINNET=https://mainnet.base.org forge test --match-contract TelligenceVeniceForkTest -vv
```

The early recorded commands excluded parallel in-progress factory fixtures. Final repository verification includes those fixtures separately. Fork tests require archive RPC access and deliberately fail if it is unavailable.

## Exact upstream behavior

The staking interface uses `stake(address recipient,uint256 amount)`, not the obsolete one-argument call. Only the vault is the recipient. Stake, mint, burn, and VVV unstake can implicitly claim rewards; those rewards remain liquid and are returned by a separate transaction rather than being silently allocated or making a reentrant policy callback during allocation.

Venice records one aggregate `lockedStakes(vault)` obligation at a historical average mint rate. Full withdrawal burns its entire outstanding DIEM balance, releasing all locked sVVV without partial-burn rounding dust. DIEM remains in the same vault throughout minting, staking, cooldown, and burning. The vault never approves DIEM to an external spender.

The EIP-1967 implementation slot at the fork block is `0xe37A7920dbc11253ac6d031C29f592f71B348DCA`, matching the exact Sourcify source used for the interfaces. [`venice-contracts.json`](../evidence/venice-contracts.json) records source response hashes, verified metadata, and the ABI subset actually used. The proxy is upstream-upgradeable; successful fork tests do not remove provider administrator trust.

## Enforced boundaries

- The already deployed policy is immutable; no initializer, generic execution, ownership transfer, asset recipient argument, or arbitrary approval exists.
- Allocation atomically pulls the approved VVV amount, confirms receipts and mint debt, clears allowance, stakes DIEM, and enforces the cumulative allocation cap. Failure at any step rolls the entire operation back.
- New allocation stops immediately upon winddown notice. Anyone can execute each recovery step after the recorded notice/provider deadline; repeated or out-of-order steps fail before initiating another cooldown.
- All realized VVV uses an exact approval to the original policy's `returnToRevnet(amount)` callback. The policy pulls it for canonical `addToBalanceOf`. A failing callback rolls everything back; no second accounting credit survives a retry.
- Allocation pause does not stop return or recovery. Inference authentication is an independent, narrowly scoped capability. Fresh signatures fail automatically at the disclosed notice cutoff even if every keeper is offline, and authentication is permanently disabled when backing starts unstaking. The vault tests validate this using an otherwise valid signed challenge on both sides of the cutoff; the auth-hook TDD red/green evidence is recorded in `auth-tdd.md`.
- Venice lets any third party stake VVV for a recipient. Unsolicited sVVV can therefore arrive after closure. A return-only cleanup cycle recovers it without reopening compute or allowing an attacker to make completion depend on a permanently zero stake balance.
- Unsolicited DIEM does not increase the vault's mint debt and cannot block withdrawal. DIEM surplus unrelated to a mint obligation remains in the vault; v1 deliberately has no arbitrary token rescue or swap route.

The offchain provider-account linkage, acceptance of the custom ERC-1271 signature bytes, credit recognition, and funded inference canary are separate integration requirements. These onchain fork tests do not claim they have occurred.
