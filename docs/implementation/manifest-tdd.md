# Read-only deployment manifest generator

September 9, 2026. `services/control-worker/create-manifest.mjs` fills the gap between an actual reviewed Base deployment and the manifest consumed by the gateway and worker. No app runtime behavior changed.

## TDD and compatibility evidence

Fourteen tests were written against an executable skeleton. The recorded run failed all fourteen with `NOT_IMPLEMENTED`; see [`manifest-red.log`](manifest-red.log). The implementation then passed all fourteen; see [`manifest-green.log`](manifest-green.log).

Tests cover one identified safe block, reorg detection, wrong RPC chain, unexpected Revnet deployer, substituted provider addresses/decimals, missing runtime code, changed staking implementation, unrelated extension bytecode, malformed artifact targets/links/immutable references, reviewed-policy bounds, mandatory CLI arguments, signing/broadcast flag rejection, and exclusive output creation. The generated fixture passes the existing `validateManifest` schema and `BaseChain.verifyPins` unchanged.

A separate local compatibility check used the actual compiled `TelligenceFactory` and `TelligenceComputeVaultDeployer` artifacts with their runtime immutable words changed to deployment values. Both matched: five factory immutable words, six vault-deployer words, compiler `0.8.28+commit.7893614a`, and nine top-level pins. This verifies the real Foundry artifact shape; it does not claim a deployed production factory exists.

```sh
cd services
node --test control-worker/test/create-manifest.test.mjs
node control-worker/create-manifest.mjs --help
```

## Manifest guarantees

- Explicit factory, reviewed Revnet deployer, reviewed policy file, output path, and Base RPC; no default deployment or economic preset.
- All getters, bytecode, and EIP-1967 slots read at the same Base `safe` block number, followed by a block-hash/timestamp recheck.
- Canonical VVV, staking, DIEM, eighteen-decimal contexts, and the reviewed staking implementation are required.
- Runtime pins include both deployers, factory, terminal, controller, project registry, and provider contracts. Proxy pins include implementation address/hash.
- Factory and adapter runtime must match the selected local build after masking only validated 32-byte immutable ranges. The manifest records artifact SHA-256, compiler/settings, source Keccak hashes, and the comparison method.
- Records the safe block identity, staking owner, and exact input-policy file SHA-256. Unknown policy-file fields are omitted from the published policy.
- Output uses `wx`; an existing release cannot be overwritten. Error output never includes authenticated RPC URLs or transport exception bodies.

The selected artifacts and reviewed Revnet address remain operator trust inputs. The generator proves runtime correspondence and preserves provenance; it does not convert an arbitrary artifact into audited source or remove upstream administrator risk. A block hash is checked before output, while future state changes are detected by the existing manifest checker and worker.
