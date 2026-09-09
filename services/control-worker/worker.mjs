import { randomUUID } from 'node:crypto';
import { validateOperation } from './operations.mjs';
import { fault, safeErrorCode } from './errors.mjs';

/** The database commits signed bytes before any RPC write. Retries use those bytes. */
export class Worker {
  constructor({ store, chain, owner = randomUUID(), executionEnabled = false, confirmations = 20, retrySeconds = 15 }) {
    if (!Number.isSafeInteger(confirmations) || confirmations < 20) throw new Error('At least 20 confirmations required');
    Object.assign(this, { store, chain, owner, executionEnabled, confirmations, retrySeconds });
  }

  async tick() {
    if (!this.executionEnabled) return false;
    const job = await this.store.claim(this.owner);
    if (!job) return false;
    try {
      validateOperation(job.operation, job.payload);
      const project = await this.store.getProject(job.project_id);
      if (!project || project.chain_id !== 8453) throw fault('INVALID_PROJECT', 'Project must be on Base', true);
      await this.chain.validateProject(project);
      let intent = await this.store.getIntent(job.id);
      if (!intent) {
        const preconditions = await this.chain.preflight(job, project);
        intent = await this.store.withKeeperLease(this.chain.keeperAddress, async keeperLease => {
          await this.store.assertLease(job, keeperLease);
          // A recovered job may already have an intent. Never allocate another nonce.
          const existing = await this.store.getIntent(job.id, keeperLease);
          if (existing) return existing;
          const pending = await this.chain.getPendingNonce();
          const nonce = await this.store.nextNonce(this.chain.keeperAddress, pending, keeperLease);
          const signed = await this.chain.prepare(job, project, nonce, preconditions);
          return this.store.saveIntent(job, signed, keeperLease);
        });
      }
      await this.chain.validateIntent(job, project, intent);
      await this.reconcile(job, project, intent);
    } catch (error) {
      if (error.code !== 'LEASE_LOST') {
        try {
          const existingIntent = await this.store.getIntent(job.id);
          const preflightFailed = !existingIntent && ['DEADLINE_EXPIRED', 'PREFLIGHT_REVERTED'].includes(error.code);
          await this.store.update(job, {
            state: preflightFailed ? 'failed' : error.permanent ? 'quarantined' : (existingIntent ? 'broadcast_unknown' : 'queued'),
            error_code: safeErrorCode(error), retrySeconds: this.retrySeconds,
          });
          if (error.permanent && !preflightFailed) await this.store.markCapacityUnavailable(job.project_id);
        } catch (updateError) {
          if (updateError.code !== 'LEASE_LOST') throw updateError;
        }
      }
    } finally {
      await this.store.release(job);
    }
    return true;
  }

  async reconcile(job, project, intent) {
    const receipt = await this.chain.getReceipt(intent.hash);
    if (receipt) {
      if (receipt.transactionHash.toLowerCase() !== intent.hash.toLowerCase()) {
        throw fault('RECEIPT_HASH_MISMATCH', undefined, true);
      }
      const canonicalHash = await this.chain.getBlockHash(receipt.blockNumber);
      if (canonicalHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        await this.store.markCapacityUnavailable(job.project_id);
        await this.store.update(job, { state: 'broadcast_unknown', error_code: 'REORG', retrySeconds: this.retrySeconds });
        return;
      }
      const tip = await this.chain.getBlockNumber();
      const finalized = await this.chain.getFinalizedBlockNumber();
      const confirmed = finalized >= receipt.blockNumber && tip >= receipt.blockNumber
        && tip - receipt.blockNumber + 1n >= BigInt(this.confirmations);
      const evidence = { receipt_block: String(receipt.blockNumber), receipt_block_hash: receipt.blockHash };
      if (!confirmed) {
        await this.store.update(job, { state: 'confirmed', ...evidence, error_code: null, retrySeconds: this.retrySeconds });
        return;
      }
      if (receipt.status !== 'success') {
        await this.store.update(job, { state: 'failed', ...evidence, error_code: 'TRANSACTION_REVERTED' });
        return;
      }
      const effect = await this.chain.verifyEffect(job, project, intent, receipt);
      if (!effect?.verified) throw fault('EFFECT_NOT_VERIFIED', undefined, true);
      await this.store.update(job, { state: 'finalized', ...evidence, effect, error_code: null });
      // Provider credit is refreshed separately; a successful allocation cannot enable API access by itself.
      await this.store.markCapacityUnavailable(job.project_id);
      return;
    }
    if (job.state === 'confirmed' || job.receipt_block_hash) await this.store.markCapacityUnavailable(job.project_id);
    const latestNonce = await this.chain.getLatestNonce(intent.keeperAddress);
    if (latestNonce > intent.nonce) throw fault('NONCE_CONSUMED_WITHOUT_RECEIPT', undefined, true);
    await this.store.assertLease(job);
    // Repeating identical signed bytes cannot execute the operation twice on the same canonical chain.
    try {
      const returnedHash = await this.chain.broadcast(intent.rawTransaction);
      if (returnedHash.toLowerCase() !== intent.hash.toLowerCase()) throw fault('BROADCAST_HASH_MISMATCH', undefined, true);
    } catch (error) {
      if (error.permanent) throw error;
      await this.store.update(job, { state: 'broadcast_unknown', error_code: 'BROADCAST_AMBIGUOUS', retrySeconds: this.retrySeconds });
      return;
    }
    await this.store.update(job, { state: 'submitted', error_code: null, retrySeconds: this.retrySeconds });
  }
}
