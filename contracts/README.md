# Telligence contracts

Immutable Base extensions for compute fundraising using the existing Juicebox V6 and Revnet contracts. Canonical VVV is the sole accounting asset. Standard Revnet payments, buybacks, cashouts, and balance returns stay intact.

`TelligenceFactory` creates one `ProjectPolicy` operator and one `TelligenceComputeVault` per stock Revnet. Each stage has a compute token allocation locked to the policy and an optional creator token allocation locked to the launching wallet. The policy remains the sole protocol operator. The creator receives inference authority and ordinary transfer/cashout rights for their project tokens; vault backing has no direct creator, signer, or keeper withdrawal path. `TelligenceComputeVaultDeployer` pins the provider integration separately to keep deployment bytecode comfortably within limits.

## Token allocations

Factory policy version 2 appends `operatorSplitPercent` to `TelligenceStageConfig`, after `cashOutTaxRate`. Both `splitPercent` (compute) and `operatorSplitPercent` (creator) are percentages of **all new token issuance**, expressed in basis points. Compute must be positive and their sum must be below 10,000; the remainder goes to the payer's token beneficiary. For example, 4,000 compute and 1,000 creator gives 40% compute, 10% creator, and 50% supporters. A zero creator allocation preserves the original single-recipient route.

Stock reserved percentage is the sum of the two allocations. The reserved-recipient weights use stock precision of 1,000,000,000: creator weight is `floor(creatorBps * 1e9 / (computeBps + creatorBps))` and compute weight is the remainder. This rounds the configured ratio toward compute. It can therefore allocate slightly more than the exact mathematical compute fraction. Separately, stock core floors each recipient's token amount, leaving at most one raw project-token unit per distribution on `REVOwner`; anyone can burn that residue with `burnHeldTokensOf`. No new dust routing or core modification is introduced.

The creator-to-compute ratio must be identical across all stages. Stock core distributes accrued reserved tokens using the current stage's recipient weights, so this condition prevents delayed distribution from reallocating previously accrued compute tokens to the creator. Stage issuance and the total reserved allocation can still change according to the disclosed launch schedule.

The creator beneficiary is always the factory caller, independently of the recovery wallet or inference signer. Both recipients stay locked for the maximum timestamp, and no policy method exposes a split edit or protocol-operator handoff. The factory policy commitment includes the actual locked recipient configuration and its version.

These are issuance allocations, not fixed shares of contributed VVV or permanent ownership percentages. Creator tokens can be transferred or cashed out against liquid treasury under ordinary Revnet rules, including before the project earns revenue. A creator who retains tokens also participates in returned rewards and recovered principal as a current holder. Vault recovery still adds all returned VVV to the same Revnet without issuing new tokens or directly paying the creator. See [executable creator-allocation economics](test/economics/operator-split.md) and [TDD evidence](docs/operator-split-tdd.md).

## Build and tests

```sh
npm ci --ignore-scripts --workspaces=false
forge test --no-match-path 'test/fork/**'
forge fmt --check
forge build src/TelligenceFactory.sol src/TelligenceComputeVaultDeployer.sol --sizes --skip '*/test/**' --skip '*/script/**' --deny notes
```

Solidity is pinned to 0.8.28 with Cancun and IR compilation. npm dependencies use exact versions and a lockfile. Unmodified stock Revnet source and `forge-std` are pinned in `lib/` with upstream provenance. Tests exercise actual local stock protocol accounting as well as isolated failure paths and stateful invariants.

```sh
RPC_BASE_MAINNET=https://mainnet.base.org forge test --match-path 'test/fork/**'
```

The separate fork suite executes against real Venice deployments and genuine Base Uniswap V4 pools/oracle in a local fork and requires a working RPC endpoint. It sends no funded live transactions. See [policy evidence](../docs/implementation/policy-tdd.md), [buyback evidence](../docs/implementation/buybacks-tdd.md), and [vault evidence](../docs/implementation/vault-tdd.md).

## Operations

- `cashOutProduction(tokenCount, deadline)` executes the exact allowed batch after its cadence, retaining default hook routing and enforcing actual VVV receipts against a nonzero output floor.
- `allocate(vvvAmount, deadline)` uses exact approval, an independently enforced mint floor, and a nonrenewing lifetime principal cap.
- `returnToRevnet(amount)` is callable only by the bound vault. It pulls approved VVV and uses `addToBalanceOf`, never `pay`.
- Creator/recovery may pause investment, rotate or disable inference authentication, raise output floors, and announce an irrevocable seven-day winddown.
- Recovery operations are permissionless after notice and the provider's actual cooldowns. Recovered backing returns only to the original Revnet. Excess VVV and late production have explicit return/burn paths.

There is no generic execute, split change, allowance grant, bridge, borrow, operator handoff, or upgrade function. Upstream provider upgrades and hosted inference availability remain external dependencies.

## Deployment review

`script/Deploy.s.sol` requires an explicitly reviewed `REVNET_DEPLOYER` address and `REVNET_DEPLOYER_CODEHASH`. It checks Base and the reviewed Venice staking implementation before constructing the adapter deployer and factory. Running `forge script` simulates; broadcasting is an explicit separate CLI action. The script handles no private keys and moves no backing assets.

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_BASE_MAINNET"
```

The factory exposes `creationFee()` for the exact stock project creation fee. A launch forwards this fee while preserving the creator's payer attribution. Production deployment, address publication, provider self-service registration and a real funded inference canary remain separate release gates; no generated local address is a production deployment claim.
