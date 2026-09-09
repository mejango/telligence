import { randomUUID } from 'node:crypto';
import { fault } from './errors.mjs';
import { validateOperation } from './operations.mjs';

const PENDING = ['queued', 'prepared', 'submitted', 'broadcast_unknown', 'confirmed'];
const STATES = [...PENDING, 'finalized', 'failed', 'quarantined'];
const leaseSQL = `EXISTS (SELECT 1 FROM worker_project_leases l
  WHERE l.project_id = j.project_id AND l.owner = $2 AND l.fence = $3 AND l.lease_until > clock_timestamp())`;
const serialize = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);

async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function mapIntent(row) {
  if (!row) return undefined;
  const nonce = Number(row.nonce);
  if (!Number.isSafeInteger(nonce)) throw fault('INVALID_NONCE', undefined, true);
  return { hash: row.transaction_hash, rawTransaction: row.raw_transaction, nonce,
    keeperAddress: row.keeper_address, targetAddress: row.target_address, calldata: row.calldata, preconditions: row.preconditions };
}

export class PostgresWorkerStore {
  constructor(pool, { leaseSeconds = 120 } = {}) {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 600) throw new Error('Invalid lease duration');
    this.pool = pool;
    this.leaseSeconds = leaseSeconds;
  }

  async enqueue({ projectId, operationKey, operation, payload }, client = this.pool) {
    validateOperation(operation, payload);
    if (typeof operationKey !== 'string' || operationKey.length < 1 || operationKey.length > 200) throw fault('INVALID_OPERATION_KEY');
    const { rows } = await client.query(`INSERT INTO worker_jobs(id,project_id,operation_key,operation,payload)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,operation_key) DO UPDATE
      SET operation_key = EXCLUDED.operation_key
      WHERE worker_jobs.operation = EXCLUDED.operation AND worker_jobs.payload = EXCLUDED.payload RETURNING *`,
    [randomUUID(), projectId, operationKey, operation, serialize(payload)]);
    if (!rows[0]) throw fault('OPERATION_KEY_CONFLICT', 'An operation key cannot be rebound to a different action', true);
    return rows[0];
  }

  async planProject(project, plan) {
    return transaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`telligence:plan:${project.id}`]);
      const { rowCount } = await client.query('SELECT id FROM worker_jobs WHERE project_id=$1 AND state=ANY($2) LIMIT 1',
        [project.id, [...PENDING, 'quarantined']]);
      if (rowCount) return null;
      const proposal = await plan(project);
      return proposal ? this.enqueue(proposal, client) : null;
    });
  }

  async claim(owner) {
    return transaction(this.pool, async client => {
      // Serial order per project: a later job cannot run around an unsettled earlier operation.
      const { rows } = await client.query(`SELECT j.* FROM worker_jobs j
        WHERE j.state = ANY($1) AND j.next_attempt_at <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM worker_jobs q WHERE q.project_id=j.project_id AND q.state='quarantined')
          AND NOT EXISTS (SELECT 1 FROM worker_project_leases l WHERE l.project_id=j.project_id AND l.lease_until > clock_timestamp())
          AND NOT EXISTS (SELECT 1 FROM worker_jobs prior WHERE prior.project_id=j.project_id AND prior.state = ANY($1)
            AND (prior.created_at,prior.id) < (j.created_at,j.id))
        ORDER BY j.next_attempt_at,j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`, [PENDING]);
      const job = rows[0];
      if (!job) return undefined;
      const lease = await client.query(`INSERT INTO worker_project_leases(project_id,owner,fence,lease_until)
        VALUES($1,$2,1,clock_timestamp()+$3*interval '1 second')
        ON CONFLICT(project_id) DO UPDATE SET owner=$2,fence=worker_project_leases.fence+1,
          lease_until=clock_timestamp()+$3*interval '1 second'
        WHERE worker_project_leases.lease_until <= clock_timestamp() RETURNING fence`, [job.project_id, owner, this.leaseSeconds]);
      if (!lease.rows[0]) return undefined;
      const updated = await client.query(`UPDATE worker_jobs SET lease_owner=$2,fence=$3,attempts=attempts+1,
        updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [job.id, owner, lease.rows[0].fence]);
      return updated.rows[0];
    });
  }

  async assertLease(job, client = this.pool) {
    const { rowCount } = await client.query(`SELECT j.id FROM worker_jobs j WHERE j.id=$1 AND ${leaseSQL}`,
      [job.id, job.lease_owner, job.fence]);
    if (!rowCount) throw fault('LEASE_LOST');
  }

  async release(job) {
    await this.pool.query(`UPDATE worker_project_leases SET lease_until=clock_timestamp()
      WHERE project_id=$1 AND owner=$2 AND fence=$3`, [job.project_id, job.lease_owner, job.fence]);
  }

  async getProject(id) {
    return (await this.pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
  }

  async getIntent(jobId, client = this.pool) {
    return mapIntent((await client.query('SELECT * FROM worker_tx_intents WHERE job_id=$1', [jobId])).rows[0]);
  }

  async withKeeperLease(address, fn) {
    return transaction(this.pool, async client => {
      // Transaction-scoped lock survives slow RPC calls and vanishes if this database connection dies.
      // No broadcast occurs inside this transaction.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`telligence:keeper:8453:${address.toLowerCase()}`]);
      return fn(client);
    });
  }

  async nextNonce(address, pendingNonce, client = this.pool) {
    if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0) throw fault('INVALID_NONCE', undefined, true);
    const { rows } = await client.query('SELECT MAX(nonce)::text AS nonce FROM worker_tx_intents WHERE chain_id=8453 AND keeper_address=$1', [address.toLowerCase()]);
    const next = rows[0].nonce === null ? pendingNonce : Math.max(pendingNonce, Number(rows[0].nonce) + 1);
    if (!Number.isSafeInteger(next)) throw fault('INVALID_NONCE', undefined, true);
    return next;
  }

  async saveIntent(job, signed, client) {
    if (!client || client === this.pool) throw new Error('Intent requires the keeper transaction');
    const inserted = await client.query(`INSERT INTO worker_tx_intents
      (job_id,chain_id,keeper_address,nonce,transaction_hash,raw_transaction,target_address,calldata,preconditions)
      SELECT j.id,8453,$4,$5,$6,$7,$8,$9,$10 FROM worker_jobs j WHERE j.id=$1 AND ${leaseSQL}
      ON CONFLICT(job_id) DO NOTHING RETURNING *`, [job.id, job.lease_owner, job.fence,
      signed.keeperAddress.toLowerCase(), signed.nonce, signed.hash.toLowerCase(), signed.rawTransaction.toLowerCase(),
      signed.targetAddress.toLowerCase(), signed.calldata.toLowerCase(), serialize(signed.preconditions ?? {})]);
    if (!inserted.rowCount) {
      await this.assertLease(job, client);
      const existing = await this.getIntent(job.id, client);
      if (!existing) throw fault('LEASE_LOST');
      return existing;
    }
    await this.update(job, { state: 'prepared' }, client);
    return mapIntent(inserted.rows[0]);
  }

  async update(job, change, client = this.pool) {
    if (!STATES.includes(change.state)) throw new Error('Invalid job state');
    const result = await client.query(`UPDATE worker_jobs j SET state=$4,error_code=$5,
      receipt_block=COALESCE($6,receipt_block),receipt_block_hash=COALESCE($7,receipt_block_hash),
      effect=COALESCE($8,effect),next_attempt_at=clock_timestamp()+$9*interval '1 second',updated_at=clock_timestamp()
      WHERE j.id=$1 AND ${leaseSQL}`, [job.id, job.lease_owner, job.fence, change.state, change.error_code ?? null,
      change.receipt_block ?? null, change.receipt_block_hash ?? null, change.effect ? serialize(change.effect) : null, change.retrySeconds ?? 15]);
    if (!result.rowCount) throw fault('LEASE_LOST');
  }

  async markCapacityUnavailable(projectId) {
    await transaction(this.pool, async client => {
      await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      await client.query("UPDATE provider_bindings SET status='pending',observed_at=NULL WHERE project_id=$1 AND status <> 'disabled'", [projectId]);
    });
  }

  async updateProviderCapacity(projectId, snapshot) {
    return transaction(this.pool, async client => {
      await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      // This updates only observations. Gateway reservations and settled usage are never reset here.
      const { rowCount } = await client.query(`UPDATE provider_bindings b SET status=$2,provider_epoch=$3,
        daily_limit_microusd=$4,remaining_microusd=$5,observed_at=$6
        FROM projects p WHERE b.project_id=$1 AND p.id=b.project_id AND b.status <> 'disabled'
        AND p.status IN ('active','accumulating','winddown')
        AND (b.observed_at IS NULL OR b.observed_at < $6::timestamptz)
        AND b.signer_address=$7 AND b.signer_generation=$8 AND $9::boolean
        AND NOT EXISTS (SELECT 1 FROM worker_jobs j WHERE j.project_id=p.id AND j.state='quarantined')`,
      [projectId, snapshot.status, snapshot.providerEpoch, snapshot.dailyLimitMicrousd, snapshot.remainingMicrousd, snapshot.observedAt,
        snapshot.signerAddress?.toLowerCase() ?? '', snapshot.signerGeneration ?? 0, snapshot.authenticationEnabled === true]);
      if (rowCount) await client.query(`INSERT INTO worker_capacity_evidence(project_id,chain_block,chain_block_hash,observed_at)
        VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET chain_block=$2,chain_block_hash=$3,observed_at=$4`,
      [projectId, snapshot.chainBlock, snapshot.chainBlockHash, snapshot.observedAt]);
      return Boolean(rowCount);
    });
  }

  async reconcileProjectState(projectId, evidence) {
    return transaction(this.pool, async client => {
      await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      const { rows } = await client.query(`SELECT p.status,b.signer_address,b.signer_generation,b.canary_verified_at
        FROM projects p JOIN provider_bindings b ON b.project_id=p.id WHERE p.id=$1 FOR UPDATE OF b`, [projectId]);
      const row = rows[0];
      if (!row) throw fault('INVALID_PROJECT');
      const signerMatches = row.signer_address.toLowerCase() === evidence.signerAddress.toLowerCase()
        && Number(row.signer_generation) === evidence.signerGeneration;
      if (!signerMatches || !evidence.authenticationEnabled) {
        await client.query("UPDATE provider_bindings SET status='pending',observed_at=NULL WHERE project_id=$1 AND status <> 'disabled'", [projectId]);
      }
      if (row.status !== 'suspended') {
        const status = evidence.vaultState === 4 ? 'closed' : evidence.vaultState > 0 ? 'winddown'
          : evidence.stakedDiem > 0n && row.canary_verified_at && signerMatches ? 'active' : 'accumulating';
        await client.query('UPDATE projects SET status=$2 WHERE id=$1', [projectId, status]);
      }
      // A signer rotation must be provisioned explicitly. Never overwrite the encrypted signer's generation based only on a chain read.
      return signerMatches && evidence.authenticationEnabled;
    });
  }

  async listRefreshableProjects(limit = 100) {
    return (await this.pool.query(`WITH selected AS (
      SELECT p.id FROM projects p JOIN provider_bindings b ON b.project_id=p.id
        LEFT JOIN worker_project_checks c ON c.project_id=p.id
      WHERE p.status IN ('active','accumulating','winddown') AND b.status <> 'disabled' AND b.signer_address IS NOT NULL
      ORDER BY c.last_refreshed_at NULLS FIRST,p.id LIMIT $1
    ), recorded AS (
      INSERT INTO worker_project_checks(project_id,last_refreshed_at)
      SELECT id,clock_timestamp() FROM selected ORDER BY id
      ON CONFLICT(project_id) DO UPDATE SET last_refreshed_at=EXCLUDED.last_refreshed_at RETURNING project_id
    ) SELECT p.* FROM projects p JOIN recorded r ON p.id=r.project_id`, [limit])).rows;
  }

  async listKeeperProjects(limit = 100) {
    return (await this.pool.query(`WITH selected AS (
      SELECT p.id FROM projects p LEFT JOIN worker_project_checks c ON c.project_id=p.id
      WHERE p.status <> 'suspended' ORDER BY c.last_planned_at NULLS FIRST,p.id LIMIT $1
    ), recorded AS (
      INSERT INTO worker_project_checks(project_id,last_planned_at)
      SELECT id,clock_timestamp() FROM selected ORDER BY id
      ON CONFLICT(project_id) DO UPDATE SET last_planned_at=EXCLUDED.last_planned_at RETURNING project_id
    ) SELECT p.* FROM projects p JOIN recorded r ON p.id=r.project_id`, [limit])).rows;
  }

  async finalizedReceipts(limit = 200) {
    return (await this.pool.query(`SELECT j.id,j.project_id,j.receipt_block,j.receipt_block_hash FROM worker_jobs j
      LEFT JOIN worker_chain_blocks b ON b.chain_id=8453 AND b.block_number=j.receipt_block
      WHERE j.state IN ('finalized','failed') AND j.receipt_block IS NOT NULL
      ORDER BY b.checked_at NULLS FIRST,j.updated_at LIMIT $1`, [limit])).rows;
  }

  async recordCanonicalBlock(blockNumber, blockHash) {
    await this.pool.query(`INSERT INTO worker_chain_blocks(chain_id,block_number,block_hash) VALUES(8453,$1,$2)
      ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=$2,checked_at=clock_timestamp()`, [String(blockNumber), blockHash]);
  }

  async invalidateReorg(blockNumber, canonicalHash) {
    return transaction(this.pool, async client => {
      await client.query(`SELECT id FROM projects WHERE id IN
        (SELECT project_id FROM worker_jobs WHERE receipt_block=$1 AND receipt_block_hash <> $2
          UNION SELECT project_id FROM worker_capacity_evidence WHERE chain_block=$1 AND chain_block_hash <> $2)
        ORDER BY id FOR UPDATE`, [String(blockNumber), canonicalHash]);
      const { rows } = await client.query(`UPDATE worker_jobs SET state='quarantined',error_code='FINALIZED_REORG',updated_at=clock_timestamp()
        WHERE receipt_block=$1 AND receipt_block_hash <> $2 AND state IN ('finalized','failed') RETURNING project_id`, [String(blockNumber), canonicalHash]);
      await client.query(`UPDATE provider_bindings SET status='pending',observed_at=NULL
        WHERE status <> 'disabled' AND (project_id=ANY($1::uuid[]) OR project_id IN
          (SELECT project_id FROM worker_capacity_evidence WHERE chain_block=$2 AND chain_block_hash <> $3))`,
      [rows.map(row => row.project_id), String(blockNumber), canonicalHash]);
      return rows.length;
    });
  }
}
