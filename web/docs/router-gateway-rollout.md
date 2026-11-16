# Buyback and router rollout

The app reads its rollout snapshot from `src/lib/protocol-rollout.json`, generated from executed `deploy-all-v6/deployments/<chain>/*.json` records. Receipt status, chain, contract identity, block, and transaction identifiers must be present and valid. Proposal addresses do not enable a network.

The snapshot contains the current canonical record plus previous and v1 hook/router history. The current rollout is buyback hook 2.0.0 on the 2.0.0 Uniswap V4 hook, router 1.4.0, and its gateway; package patch releases contain their deployment artifacts. Ethereum, Optimism, Base, Arbitrum, Sepolia, Base Sepolia, and Arbitrum Sepolia have executed hook, router, gateway, and ratio-feed records. OP Sepolia has the ratio feed only. The source is deploy-all-v6 commit `8ff50c28f7f4e4a8f98fdd8f680a6e2ddd2323d1`. Mainnet migration targets are now available from these records; each project retains its actual selection until an operator changes it, and migration preparation still checks live code and registry allowlists.

Regenerate after deployment records land:

```sh
PROTOCOL_DEPLOYMENTS_DIR=../../deploy-all-v6 npm run protocol:rollout:generate
PROTOCOL_DEPLOYMENTS_DIR=../../deploy-all-v6 npm run protocol:rollout:check
PROTOCOL_DEPLOYMENTS_DIR=../../deploy-all-v6 npm run protocol:check
```

The generator also refreshes the independent Revnet deployment fixture and generates the gateway read, retry, finalization, and event ABI. Its pinned source commit makes the data reviewable. The application can use these records while the published SDK's next artifact release is pending.

A network upgrade does not migrate each project. The operator view first checks that the registry is attached in `JBDirectory`, then reads `registry.terminalOf(projectId)` and the selected gateway's `ROUTER()`. A previous router selection stays visible until the operator migrates. Directly attached terminals are identified separately. An unknown terminal or failed underlying-router read remains unknown. Operator edits prefill the live registry defaults; failed default reads leave the field empty.

The Safe preset selects the recorded hook and gateway per chain, confirms both have code, and carries the project's pool configuration. Required registry and pool reads must succeed; an RPC failure never turns a configured pool into an empty pool. Mirroring the preset also resolves each destination network, and skips dependent pool or TWAP operations when its hook selection is unavailable. Custom selections require an explicit edit on each network. The gateway is selectable in the registry; the new raw router is not. Historical targets stay named in the Safe queue and transaction review, including TWAP updates to previous hooks.

Current buyback pay metadata contains `(amountToSwapWith, minimumSwapAmountOut, skipSplits)`. All three words are required. A swap below the current hook's TWAP floor falls back to minting. Previous hooks can revert. The deployer's 172800-second pool-registration sentinel becomes the current hook's 1800-second default; always read the actual project's pool window.

The gateway holds eligible failed fee and protocol-payer input in custody for retry. A queued fee is owed and is not a settled payment. Gateway custody is separate from core held-fee refund accounting; a successful outer transaction receipt alone does not prove settlement. Retry may settle it; qualified finalization may return it to the source project. Read the original queue event's call, memo, and metadata plus commitment/failure state when preparing these calls. `pendingCallCount` is the lifetime number of identifiers issued, not the live pending count. The app currently shows routing and custody semantics, without claiming an indexed per-project pending balance.

The deliberately retained old-address literals are the generated current/previous/v1 snapshot and the previous-hook migration test. The latter verifies migration from a retired deployment; it is not a production default.
