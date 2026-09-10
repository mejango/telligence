import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, getAddress, http, keccak256, parseTransaction, recoverTransactionAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { OPERATIONS, validateOperation } from './operations.mjs';
import { fault } from './errors.mjs';
import { factoryAbi as factoryVersionAbi, factoryPolicyVersion, isSupportedPolicyVersion } from '../contracts.mjs';
import { policyAbi, vaultAbi, factoryAbi, tokenAbi, stakingAbi, diemAbi, controllerAbi, projectTokensAbi } from './abis.mjs';

export const VVV = '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf';
export const STAKING = '0x321b7ff75154472B18EDb199033fF4D116F340Ff';
export const DIEM = '0xF4d97F2da56e8c3098f3a8D538DB630A2606a024';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hashShape = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

export function validateManifest(manifest) {
  try {
    if (manifest?.chainId !== 8453 || !same(manifest.vvvAddress, VVV) || !same(manifest.stakingAddress, STAKING)
      || !same(manifest.diemAddress, DIEM) || !hashShape(manifest.factoryRuntimeHash)) throw new Error();
    if (manifest.policyVersion !== undefined && !isSupportedPolicyVersion(manifest.policyVersion)) throw new Error();
    getAddress(manifest.factoryAddress); getAddress(manifest.canonicalTerminal); getAddress(manifest.controllerAddress);
    if (!Array.isArray(manifest.runtimePins)) throw new Error();
    const pins = new Map();
    for (const pin of manifest.runtimePins) {
      const address = getAddress(pin.address).toLowerCase();
      if (pins.has(address) || !hashShape(pin.runtimeHash)) throw new Error();
      if (pin.implementation) {
        getAddress(pin.implementation.address);
        if (!hashShape(pin.implementation.runtimeHash) || (pin.implementation.slot && pin.implementation.slot !== IMPLEMENTATION_SLOT)) throw new Error();
      }
      pins.set(address, pin);
    }
    for (const address of [manifest.factoryAddress, manifest.canonicalTerminal, manifest.controllerAddress, VVV, STAKING, DIEM]) {
      if (!pins.has(address.toLowerCase())) throw new Error();
    }
    if (!pins.get(STAKING.toLowerCase()).implementation || !same(pins.get(manifest.factoryAddress.toLowerCase()).runtimeHash, manifest.factoryRuntimeHash)) throw new Error();
    return manifest;
  } catch { throw fault('INVALID_MANIFEST', 'A complete pinned Base manifest is required', true); }
}

export class BaseChain {
  constructor({ manifest, rpcUrl, publicClient, keeperPrivateKey, maxGas = 3_000_000n, maxFeePerGas = 5_000_000_000n }) {
    this.manifest = validateManifest(manifest);
    this.client = publicClient ?? createPublicClient({ chain: base, transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }) });
    this.account = keeperPrivateKey ? privateKeyToAccount(keeperPrivateKey) : null;
    this.keeperAddress = this.account?.address;
    this.wallet = this.account ? createWalletClient({ account: this.account, chain: base, transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }) }) : null;
    this.maxGas = BigInt(maxGas);
    this.maxFeePerGas = BigInt(maxFeePerGas);
    if (this.maxGas <= 0n || this.maxFeePerGas <= 0n) throw new Error('Gas limits must be positive');
  }

  async verifyPins(blockNumber) {
    if (await this.client.getChainId() !== 8453) throw fault('MANIFEST_MISMATCH', 'Unexpected RPC chain', true);
    for (const pin of this.manifest.runtimePins) {
      const code = await this.client.getCode({ address: pin.address, blockNumber });
      if (!code || code === '0x' || !same(keccak256(code), pin.runtimeHash)) throw fault('MANIFEST_MISMATCH', 'Pinned runtime changed', true);
      if (pin.implementation) {
        const slot = await this.client.getStorageAt({ address: pin.address, slot: IMPLEMENTATION_SLOT, blockNumber });
        if (!slot || !same(`0x${slot.slice(-40)}`, pin.implementation.address)) throw fault('MANIFEST_MISMATCH', 'Pinned implementation changed', true);
        const implementation = await this.client.getCode({ address: pin.implementation.address, blockNumber });
        if (!implementation || !same(keccak256(implementation), pin.implementation.runtimeHash)) throw fault('MANIFEST_MISMATCH', 'Pinned implementation runtime changed', true);
      }
    }
    if (this.manifest.policyVersion !== undefined) {
      let observed;
      try { observed = factoryPolicyVersion(await this.client.readContract({ address: this.manifest.factoryAddress, abi: factoryVersionAbi, functionName: 'POLICY_VERSION', blockNumber })); }
      catch { throw fault('MANIFEST_MISMATCH', 'Factory policy version verification failed', true); }
      if (observed !== this.manifest.policyVersion) throw fault('MANIFEST_MISMATCH', 'Pinned factory policy version changed', true);
    }
  }

  read(address, abi, functionName, blockNumber, args = []) {
    return this.client.readContract({ address, abi, functionName, args, blockNumber });
  }

  async validateProject(project) {
    if (project.chain_id !== 8453 || !/^[1-9][0-9]*$/.test(String(project.revnet_id))) throw fault('INVALID_PROJECT', undefined, true);
    const block = await this.client.getBlock({ blockTag: 'latest' });
    // Pinned runtimes are immutable bytecode hashes: reverify at most once a minute
    // per process instead of once per project per refresh. A failure never caches.
    if (!this.pinsVerifiedAt || Date.now() - this.pinsVerifiedAt > 60_000) {
      await this.verifyPins(block.number);
      this.pinsVerifiedAt = Date.now();
    }
    const id = BigInt(project.revnet_id);
    const checks = [
      [this.manifest.factoryAddress, factoryAbi, 'policyOf', project.wrapper_address, [id]],
      [this.manifest.factoryAddress, factoryAbi, 'vaultOf', project.vault_address, [id]],
      [project.wrapper_address, policyAbi, 'FACTORY', this.manifest.factoryAddress],
      [project.wrapper_address, policyAbi, 'TERMINAL', this.manifest.canonicalTerminal],
      [project.wrapper_address, policyAbi, 'CONTROLLER', this.manifest.controllerAddress],
      [project.wrapper_address, policyAbi, 'vault', project.vault_address],
      [project.wrapper_address, policyAbi, 'VVV', VVV],
      [project.vault_address, vaultAbi, 'POLICY', project.wrapper_address],
      [project.vault_address, vaultAbi, 'VVV', VVV],
      [project.vault_address, vaultAbi, 'STAKING', STAKING],
      [project.vault_address, vaultAbi, 'DIEM', DIEM],
    ];
    const results = await Promise.all(checks.map(([address, abi, fn, , args]) => this.read(address, abi, fn, block.number, args)));
    if (results.some((value, index) => !same(value, checks[index][3]))) throw fault('PROJECT_BINDING_MISMATCH', undefined, true);
    if (await this.read(project.wrapper_address, policyAbi, 'revnetId', block.number) !== id) throw fault('PROJECT_BINDING_MISMATCH', undefined, true);
    const decimals = await Promise.all([VVV, STAKING, DIEM].map(address => this.read(address, tokenAbi, 'decimals', block.number)));
    if (decimals.some(value => Number(value) !== 18)) throw fault('ACCOUNTING_MISMATCH', undefined, true);
    if (this.keeperAddress && same(this.keeperAddress, await this.read(project.vault_address, vaultAbi, 'inferenceSigner', block.number))) {
      throw fault('KEEPER_SIGNER_ROLE_COLLISION', 'Keeper and inference signer must be separate keys', true);
    }
    return block;
  }

  call(job, project) {
    validateOperation(job.operation, job.payload);
    const spec = OPERATIONS[job.operation];
    return { address: spec.target === 'controller' ? this.manifest.controllerAddress : project[`${spec.target}_address`],
      abi: spec.target === 'controller' ? controllerAbi : spec.target === 'wrapper' ? policyAbi : vaultAbi,
      functionName: spec.method, args: spec.target === 'controller' ? [BigInt(project.revnet_id)] : spec.fields.map(field => BigInt(job.payload[field])) };
  }

  async preflight(job, project) {
    const call = this.call(job, project);
    const block = await this.client.getBlock({ blockTag: 'latest' });
    if (job.payload.deadline && (BigInt(job.payload.deadline) <= block.timestamp || BigInt(job.payload.deadline) > block.timestamp + 3600n)) {
      throw fault('DEADLINE_EXPIRED', 'Operation deadline is expired or outside its policy window', true);
    }
    const [state, allocated, returned] = await Promise.all([
      this.read(project.vault_address, vaultAbi, 'state', block.number),
      this.read(project.vault_address, vaultAbi, 'totalAllocated', block.number),
      this.read(project.vault_address, vaultAbi, 'totalReturned', block.number),
    ]);
    // Simulation executes the exact fixed-destination call, including cooldown, cadence, balance and floor checks.
    try { await this.client.simulateContract({ ...call, account: this.keeperAddress, blockNumber: block.number }); }
    catch (error) {
      if (error.walk?.(cause => cause.name === 'ContractFunctionRevertedError')) throw fault('PREFLIGHT_REVERTED', 'The operation no longer satisfies contract policy');
      throw error;
    }
    return { state: Number(state), totalAllocated: allocated.toString(), totalReturned: returned.toString(), blockNumber: block.number.toString() };
  }

  async prepare(job, project, nonce, preconditions) {
    if (!this.account || !this.wallet) throw fault('KEEPER_DISABLED', undefined, true);
    const call = this.call(job, project);
    const calldata = encodeFunctionData(call);
    const request = await this.wallet.prepareTransactionRequest({ account: this.account, to: call.address,
      data: calldata, value: 0n, nonce, chain: base, type: 'eip1559' });
    if (request.gas > this.maxGas || request.maxFeePerGas > this.maxFeePerGas) throw fault('GAS_POLICY_EXCEEDED');
    const rawTransaction = await this.account.signTransaction(request);
    return { hash: keccak256(rawTransaction), rawTransaction, nonce, keeperAddress: this.keeperAddress,
      targetAddress: call.address, calldata, preconditions };
  }

  async validateIntent(job, project, intent) {
    try {
      const expected = this.call(job, project);
      const parsed = parseTransaction(intent.rawTransaction);
      if (!same(keccak256(intent.rawTransaction), intent.hash) || parsed.type !== 'eip1559'
        || parsed.chainId !== 8453 || parsed.nonce !== intent.nonce || (parsed.value ?? 0n) !== 0n
        || !same(parsed.to, expected.address) || !same(parsed.to, intent.targetAddress)
        || !same(parsed.data, encodeFunctionData(expected)) || !same(parsed.data, intent.calldata)) throw new Error();
      const signer = await recoverTransactionAddress({ serializedTransaction: intent.rawTransaction });
      if (!same(signer, intent.keeperAddress)) throw new Error();
    } catch { throw fault('INTENT_MISMATCH', 'Persisted transaction does not match the typed operation', true); }
  }

  getPendingNonce() { return this.client.getTransactionCount({ address: this.keeperAddress, blockTag: 'pending' }); }
  getLatestNonce(address) { return this.client.getTransactionCount({ address, blockTag: 'latest' }); }
  async getReceipt(hash) {
    try { return await this.client.getTransactionReceipt({ hash }); }
    catch (error) { if (error.name === 'TransactionReceiptNotFoundError') return null; throw error; }
  }
  async getBlockHash(number) { return (await this.client.getBlock({ blockNumber: BigInt(number) })).hash; }
  getBlockNumber() { return this.client.getBlockNumber({ cacheTime: 0 }); }
  async getFinalizedBlockNumber() { return (await this.client.getBlock({ blockTag: 'finalized' })).number; }
  broadcast(serializedTransaction) { return this.client.sendRawTransaction({ serializedTransaction }); }

  async verifyEffect(job, project, intent, receipt) {
    if (!same(receipt.to, intent.targetAddress) || !same(receipt.from, intent.keeperAddress)) return { verified: false };
    const events = [];
    for (const log of receipt.logs) {
      if (!same(log.address, project.vault_address) && !same(log.address, project.wrapper_address) && !same(log.address, this.manifest.controllerAddress)) continue;
      try { events.push({ address: log.address, ...decodeEventLog({ abi: same(log.address, this.manifest.controllerAddress) ? controllerAbi : same(log.address, project.vault_address) ? vaultAbi : policyAbi, ...log, strict: true }) }); } catch { /* unrelated event */ }
    }
    if (job.operation === 'distribute_production') {
      const event = events.find(event => same(event.address, this.manifest.controllerAddress) && event.eventName === 'SendReservedTokensToSplits'
        && event.args.projectId === BigInt(project.revnet_id) && event.args.tokenCount > 0n && same(event.args.caller, intent.keeperAddress));
      return { verified: Boolean(event), productionDistributed: event?.args.tokenCount.toString() };
    }
    if (job.operation === 'return_unallocated_vvv') {
      const event = events.find(event => same(event.address, project.wrapper_address) && event.eventName === 'ReturnToRevnet'
        && event.args.revnetId === BigInt(project.revnet_id) && event.args.amount > 0n);
      return { verified: Boolean(event), vvvReturned: event?.args.amount.toString() };
    }
    if (job.operation === 'burn_late_production') {
      const event = events.find(event => same(event.address, this.manifest.controllerAddress) && event.eventName === 'BurnTokens'
        && event.args.projectId === BigInt(project.revnet_id) && same(event.args.holder, project.wrapper_address)
        && same(event.args.caller, project.wrapper_address) && event.args.tokenCount > 0n);
      return { verified: Boolean(event), productionBurned: event?.args.tokenCount.toString() };
    }
    if (job.operation === 'allocate') {
      const event = events.find(event => same(event.address, project.vault_address) && event.eventName === 'Allocated'
        && event.args.vvvAmount === BigInt(job.payload.vvvAmount) && event.args.diemAmount > 0n && same(event.args.caller, project.wrapper_address));
      if (!event) return { verified: false };
      const total = await this.read(project.vault_address, vaultAbi, 'totalAllocated', receipt.blockNumber);
      return { verified: total >= BigInt(intent.preconditions.totalAllocated) + BigInt(job.payload.vvvAmount), diemMinted: event.args.diemAmount.toString() };
    }
    if (job.operation === 'cash_out_production') {
      const event = events.find(event => same(event.address, project.wrapper_address) && event.eventName === 'CashOutProduction'
        && event.args.revnetId === BigInt(project.revnet_id) && event.args.tokenCount === BigInt(job.payload.tokenCount)
        && event.args.vvvReceived > 0n && same(event.args.caller, intent.keeperAddress));
      return { verified: Boolean(event), vvvReceived: event?.args.vvvReceived.toString() };
    }
    const nextState = { begin_diem_unstake: 2, claim_diem_begin_vvv_unstake: 3, claim_vvv_return: 4, recover_donated_stake: 3 }[job.operation];
    if (nextState !== undefined) {
      const event = events.find(event => same(event.address, project.vault_address) && event.eventName === 'WinddownAdvanced'
        && Number(event.args.state) === nextState && same(event.args.caller, intent.keeperAddress));
      const state = Number(await this.read(project.vault_address, vaultAbi, 'state', receipt.blockNumber));
      // Closed can legally return to VVVCooldown if a later transaction in this block recovers donated sVVV.
      return { verified: Boolean(event) && state >= Math.min(nextState, 3), vaultState: state };
    }
    // Reward/return calls intentionally permit a zero-balance no-op. Read the cumulative ledger even when no event was emitted.
    const returned = await this.read(project.vault_address, vaultAbi, 'totalReturned', receipt.blockNumber);
    return { verified: returned >= BigInt(intent.preconditions.totalReturned), totalReturned: returned.toString() };
  }

  async readDiemEvidence(project) {
    const latest = await this.validateProject(project);
    const headAge = Date.now() - Number(latest.timestamp) * 1000;
    if (headAge > 120_000 || headAge < -15_000) throw fault('STALE_CHAIN_EVIDENCE');
    const safe = await this.client.getBlock({ blockTag: 'safe' });
    if (!safe.hash || safe.number > latest.number) throw fault('INVALID_CHAIN_EVIDENCE');
    const [safeStake, latestStake, enabled, signerAddress, signerGeneration, vaultState] = await Promise.all([
      this.read(DIEM, diemAbi, 'stakedInfos', safe.number, [project.vault_address]),
      this.read(DIEM, diemAbi, 'stakedInfos', latest.number, [project.vault_address]),
      this.read(project.vault_address, vaultAbi, 'authenticationEnabled', latest.number),
      this.read(project.vault_address, vaultAbi, 'inferenceSigner', latest.number),
      this.read(project.vault_address, vaultAbi, 'signerGeneration', latest.number),
      this.read(project.vault_address, vaultAbi, 'state', latest.number),
    ]);
    const stakedDiem = enabled ? (safeStake[0] < latestStake[0] ? safeStake[0] : latestStake[0]) : 0n;
    if (!same(await this.getBlockHash(safe.number), safe.hash)) throw fault('REORG');
    return { stakedDiem, blockNumber: safe.number, blockHash: safe.hash, verifiedAt: Date.now(),
      signerAddress, signerGeneration: Number(signerGeneration), authenticationEnabled: enabled, vaultState: Number(vaultState) };
  }

  /** Select only currently executable fixed-policy actions. The database supplies concurrency/idempotency. */
  async plan(project) {
    const block = await this.validateProject(project);
    const state = Number(await this.read(project.vault_address, vaultAbi, 'state', block.number));
    let operation, payload = {};
    if (state === 1) {
      if (await this.read(project.vault_address, vaultAbi, 'noticeEndsAt', block.number) <= block.timestamp) operation = 'begin_diem_unstake';
    } else if (state === 2) {
      const [, ready, pending] = await this.read(DIEM, diemAbi, 'stakedInfos', block.number, [project.vault_address]);
      if (pending === 0n || ready <= block.timestamp) operation = 'claim_diem_begin_vvv_unstake';
    } else if (state === 3) {
      const [, ready, pending] = await this.read(STAKING, stakingAbi, 'stakes', block.number, [project.vault_address]);
      if (pending === 0n || ready <= block.timestamp) operation = 'claim_vvv_return';
    } else if (state === 4) {
      if (await this.read(STAKING, stakingAbi, 'balanceOfUnlocked', block.number, [project.vault_address]) > 0n) operation = 'recover_donated_stake';
    }
    const [paused, windingDown, maximum, allocated, balance] = await Promise.all([
      this.read(project.wrapper_address, policyAbi, 'allocationPaused', block.number),
      this.read(project.wrapper_address, policyAbi, 'windingDown', block.number),
      this.read(project.wrapper_address, policyAbi, 'maxPrincipal', block.number),
      this.read(project.wrapper_address, policyAbi, 'totalAllocated', block.number),
      this.read(VVV, tokenAbi, 'balanceOf', block.number, [project.wrapper_address]),
    ]);
    const remaining = windingDown ? 0n : maximum - allocated;
    const tokens = await this.read(this.manifest.controllerAddress, controllerAbi, 'TOKENS', block.number);
    const [held, pendingProduction] = await Promise.all([
      this.read(tokens, projectTokensAbi, 'totalBalanceOf', block.number, [project.wrapper_address, BigInt(project.revnet_id)]),
      this.read(this.manifest.controllerAddress, controllerAbi, 'pendingReservedTokenBalanceOf', block.number, [BigInt(project.revnet_id)]),
    ]);
    if (!operation && state === 0 && !paused && !windingDown && remaining > 0n) {
      if (balance > 0n) { operation = 'allocate'; payload.vvvAmount = (balance < remaining ? balance : remaining).toString(); }
      else if (await this.read(project.wrapper_address, policyAbi, 'nextConversionAt', block.number) <= block.timestamp) {
        const [minimum, maximumBatch] = await Promise.all(['minBatchTokens', 'maxBatchTokens'].map(fn => this.read(project.wrapper_address, policyAbi, fn, block.number)));
        if (held >= minimum) { operation = 'cash_out_production'; payload.tokenCount = (held < maximumBatch ? held : maximumBatch).toString(); }
        else if (pendingProduction > 0n) operation = 'distribute_production';
      }
      if (operation === 'allocate' || operation === 'cash_out_production') payload.deadline = (block.timestamp + 900n).toString();
    }
    if (!operation) {
      if (balance > remaining) operation = 'return_unallocated_vvv';
      else if ((windingDown || allocated === maximum) && held > 0n) operation = 'burn_late_production';
      else if ((windingDown || allocated === maximum) && pendingProduction > 0n) operation = 'distribute_production';
      else if (await this.read(VVV, tokenAbi, 'balanceOf', block.number, [project.vault_address]) > 0n) operation = 'return_liquid_vvv';
      else if (state !== 4) operation = 'claim_rewards_return';
      else return null;
    }
    const identity = operation === 'claim_rewards_return' ? `day-${block.timestamp / 86400n}` : block.number.toString();
    const proposal = { projectId: project.id, operationKey: `${operation}:${identity}`, operation, payload };
    await this.preflight(proposal, project);
    return proposal;
  }
}
