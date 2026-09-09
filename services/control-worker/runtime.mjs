import { readProviderCapacity } from './capacity.mjs';
import { safeErrorCode } from './errors.mjs';

async function bounded(items, concurrency, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const item = items[next++]; await fn(item); }
  }));
}

export class ControlRuntime {
  constructor({ store, chain, worker, signer, log = () => {} }) {
    Object.assign(this, { store, chain, worker, signer, log });
  }

  async refreshCapacity() {
    const projects = await this.store.listRefreshableProjects();
    await bounded(projects, 4, async project => {
      try {
        const diem = await this.chain.readDiemEvidence(project);
        if (!await this.store.reconcileProjectState(project.id, diem)) return;
        const snapshot = await readProviderCapacity({ project, diem, getAuthHeader: async () => {
          const auth = await this.signer.getHeader(project, 3);
          if (auth.headerName !== 'SIGN-IN-WITH-X') throw new Error('Unexpected signer response');
          return auth.headerValue;
        } });
        // Reconfirm the exact chain observation before making this provider capacity usable.
        if ((await this.chain.getBlockHash(diem.blockNumber)).toLowerCase() !== diem.blockHash.toLowerCase()) throw Object.assign(new Error('Reorg'), { code: 'REORG' });
        await this.store.updateProviderCapacity(project.id, { ...snapshot,
          signerAddress: diem.signerAddress, signerGeneration: diem.signerGeneration, authenticationEnabled: diem.authenticationEnabled });
      } catch (error) {
        await this.store.markCapacityUnavailable(project.id);
        this.log({ event: 'capacity_refresh_failed', projectId: project.id, code: safeErrorCode(error) });
      }
    });
  }

  async plan() {
    if (!this.worker.executionEnabled) return;
    for (const project of await this.store.listKeeperProjects()) {
      try { await this.store.planProject(project, candidate => this.chain.plan(candidate)); }
      catch (error) { this.log({ event: 'keeper_plan_deferred', projectId: project.id, code: safeErrorCode(error) }); }
    }
  }

  async auditReceipts() {
    const seen = new Set();
    for (const receipt of await this.store.finalizedReceipts()) {
      if (seen.has(receipt.receipt_block)) continue;
      seen.add(receipt.receipt_block);
      const hash = await this.chain.getBlockHash(receipt.receipt_block);
      // Reconcile every stored hash at this height, including a later orphan row when the first row matches.
      if (await this.store.invalidateReorg(receipt.receipt_block, hash)) {
        this.log({ event: 'finalized_reorg', blockNumber: String(receipt.receipt_block) });
      }
      await this.store.recordCanonicalBlock(receipt.receipt_block, hash);
    }
  }
}
