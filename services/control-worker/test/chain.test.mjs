import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters, keccak256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BaseChain, validateManifest, VVV, STAKING, DIEM } from '../chain.mjs';

const factory = `0x${'1'.repeat(40)}`;
const terminal = `0x${'2'.repeat(40)}`;
const controller = `0x${'7'.repeat(40)}`;
const wrapper = `0x${'3'.repeat(40)}`;
const vault = `0x${'4'.repeat(40)}`;
const keeper = `0x${'5'.repeat(40)}`;
const implementation = `0x${'6'.repeat(40)}`;
const code = '0x0102';
const runtimeHash = keccak256(code);
const manifest = {
  chainId: 8453, vvvAddress: VVV, stakingAddress: STAKING, diemAddress: DIEM,
  factoryAddress: factory, factoryRuntimeHash: runtimeHash, canonicalTerminal: terminal, controllerAddress: controller,
  runtimePins: [factory, terminal, controller, VVV, STAKING, DIEM].map(address => ({ address, runtimeHash,
    ...(address === STAKING ? { implementation: { address: implementation, runtimeHash } } : {}) })),
};
const project = { id: 'project', chain_id: 8453, revnet_id: '1', wrapper_address: wrapper, vault_address: vault };

test('manifest rejects unsupported networks, substituted token addresses and unpinned staking upgrades', () => {
  assert.equal(validateManifest(manifest).chainId, 8453);
  for (const bad of [{ ...manifest, chainId: 1 }, { ...manifest, vvvAddress: factory }, { ...manifest, runtimePins: [] },
    { ...manifest, runtimePins: manifest.runtimePins.map(pin => ({ address: pin.address, runtimeHash })) }]) {
    assert.throws(() => validateManifest(bad));
  }
});

test('changed staking implementation fails before signing even when proxy code stays constant', async () => {
  const client = {
    getChainId: async () => 8453,
    getBlock: async () => ({ number: 10n, timestamp: 10n }),
    getCode: async () => code,
    getStorageAt: async () => `0x${'0'.repeat(24)}${'7'.repeat(40)}`,
  };
  const chain = new BaseChain({ manifest, publicClient: client });
  await assert.rejects(chain.validateProject(project), error => error.code === 'MANIFEST_MISMATCH');
});

test('invalid deadline is rejected before any simulation or signing', async () => {
  const chain = new BaseChain({ manifest, publicClient: { getBlock: async () => ({ number: 10n, timestamp: 1000n }) } });
  await assert.rejects(chain.preflight({ operation: 'allocate', payload: { vvvAmount: '1', deadline: '999' } }, project), /deadline/);
});

test('final allocation evidence requires the bound vault, exact amount and verified historical state', async () => {
  const abi = parseAbi(['event Allocated(uint256 vvvAmount,uint256 diemAmount,address indexed caller)']);
  const log = { address: vault, topics: encodeEventTopics({ abi, eventName: 'Allocated', args: { caller: wrapper } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [10n, 20n]) };
  const client = { readContract: async () => 10n };
  const chain = new BaseChain({ manifest, publicClient: client });
  const job = { operation: 'allocate', payload: { vvvAmount: '10', deadline: '2000' } };
  const intent = { targetAddress: wrapper, keeperAddress: keeper, preconditions: { totalAllocated: '0' } };
  const receipt = { to: wrapper, from: keeper, blockNumber: 100n, logs: [log] };
  assert.equal((await chain.verifyEffect(job, project, intent, receipt)).verified, true);
  assert.equal((await chain.verifyEffect(job, project, intent, { ...receipt, logs: [{ ...log, address: factory }] })).verified, false);
  assert.equal((await chain.verifyEffect({ ...job, payload: { ...job.payload, vvvAmount: '11' } }, project, intent, receipt)).verified, false);
  assert.equal((await chain.verifyEffect(job, project, intent, { ...receipt, to: factory })).verified, false);
});

test('pending production is distributed through the stock controller before cashing out', async () => {
  const chain = new BaseChain({ manifest, publicClient: {} });
  chain.validateProject = async () => ({ number: 100n, timestamp: 1000n });
  chain.preflight = async () => ({});
  chain.read = async (_address, _abi, fn) => ({ state: 0, allocationPaused: false, windingDown: false,
    maxPrincipal: 100n, totalAllocated: 0n, balanceOf: 0n, TOKENS: factory,
    totalBalanceOf: 0n, pendingReservedTokenBalanceOf: 20n, nextConversionAt: 0n,
    minBatchTokens: 10n, maxBatchTokens: 100n })[fn];
  const job = await chain.plan(project);
  assert.equal(job.operation, 'distribute_production');
  const call = chain.call(job, project);
  assert.equal(call.address, controller);
  assert.equal(call.functionName, 'sendReservedTokensToSplitsOf');
  assert.deepEqual(call.args, [1n]);
});

test('immature cooldown never initiates another cooldown or buys new capacity', async () => {
  const chain = new BaseChain({ manifest, publicClient: {} });
  chain.validateProject = async () => ({ number: 100n, timestamp: 1000n });
  chain.preflight = async () => ({});
  chain.read = async (_address, _abi, fn) => ({ state: 2, stakedInfos: [0n, 2000n, 20n], allocationPaused: false,
    windingDown: true, maxPrincipal: 100n, totalAllocated: 10n, balanceOf: 0n, TOKENS: factory,
    totalBalanceOf: 0n, pendingReservedTokenBalanceOf: 0n })[fn];
  const job = await chain.plan(project);
  assert.equal(job.operation, 'claim_rewards_return');
  assert.equal(job.operationKey, 'claim_rewards_return:day-0');
});

test('stored transaction must recover its signer and match the exact typed Base operation', async () => {
  const chain = new BaseChain({ manifest, publicClient: {} });
  const account = privateKeyToAccount(`0x${'8'.repeat(64)}`);
  const job = { operation: 'begin_diem_unstake', payload: {} };
  const data = '0x' + (await import('viem')).toFunctionSelector('beginDiemUnstake()').slice(2);
  const rawTransaction = await account.signTransaction({ chainId: 8453, type: 'eip1559', nonce: 2,
    to: vault, data, gas: 100000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 1n, value: 0n });
  const intent = { hash: keccak256(rawTransaction), rawTransaction, keeperAddress: account.address,
    targetAddress: vault, calldata: data, nonce: 2 };
  await chain.validateIntent(job, project, intent);
  for (const change of [{ keeperAddress: factory }, { targetAddress: wrapper }, { nonce: 3 }, { hash: `0x${'9'.repeat(64)}` }]) {
    await assert.rejects(chain.validateIntent(job, project, { ...intent, ...change }), error => error.code === 'INTENT_MISMATCH');
  }
  await assert.rejects(chain.validateIntent({ operation: 'claim_vvv_return', payload: {} }, project, intent));
});
