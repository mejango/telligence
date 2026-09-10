/**
 * Read-only checks before routing traffic at a restored or migrated database.
 *
 *   node db/restore-check.mjs                       report; exit 1 on any problem
 *   node db/restore-check.mjs --checkpoint ISO:N    also verify the operator ledger checkpoint
 *   node db/restore-check.mjs --print-checkpoint    print the current ledger checkpoint for offline storage
 *
 * With BASE_RPC_URL set, every keeper intent of an unfinished job is compared
 * with the chain: a consumed nonce without a receipt means the restored ledger
 * lost a broadcast and that project must stay quarantined. Nothing is written.
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export async function ledgerCheckpoint(pool) {
  const { rows: [row] } = await pool.query('SELECT clock_timestamp() AS now, count(*) AS n FROM usage_reservations WHERE created_at <= clock_timestamp()');
  return `${row.now.toISOString()}:${row.n}`;
}

export async function checkRestore({ pool, checkpoint = null, rpc = null, staleAfterMs = 60000 }) {
  const problems = [];
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const [ledger] = await q(`SELECT count(*) AS total,
    count(*) FILTER (WHERE state IN ('reserved','uncertain')) AS outstanding,
    COALESCE(sum(maximum_microusd) FILTER (WHERE state IN ('reserved','uncertain')),0) AS outstanding_microusd,
    count(*) FILTER (WHERE state='uncertain' AND provider_request_id IS NULL) AS uncertain_without_identity,
    count(*) FILTER (WHERE state='reserved') AS reserved FROM usage_reservations`);
  const [activity] = await q(`SELECT count(*) FILTER (WHERE canary_verified_at IS NOT NULL) AS verified_bindings,
    count(*) AS bindings FROM provider_bindings`);
  const instances = await q(`SELECT id, stopped_at IS NOT NULL AS stopped,
    heartbeat_at < clock_timestamp() - ($1 || ' milliseconds')::interval AS silent FROM gateway_instances
    WHERE stopped_at IS NULL OR id IN (SELECT gateway_instance FROM usage_reservations WHERE state='reserved')`, [String(staleAfterMs)]);
  if (Number(activity.verified_bindings) > 0 && Number(ledger.total) === 0) problems.push('EMPTY_LEDGER_WITH_VERIFIED_PROVIDERS');
  if (Number(ledger.reserved) > 0) problems.push('RESERVED_ROWS_AWAIT_GATEWAY_RECOVERY');
  let checkpointOk = null;
  if (checkpoint) {
    const match = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z):(0|[1-9]\d{0,15})$/.exec(checkpoint);
    if (!match) throw new Error('Invalid checkpoint');
    const [{ n }] = await q('SELECT count(*) AS n FROM usage_reservations WHERE created_at <= $1', [match[1]]);
    checkpointOk = BigInt(n) >= BigInt(match[2]);
    if (!checkpointOk) problems.push('LEDGER_BEHIND_CHECKPOINT');
  }
  const jobs = await q('SELECT state, count(*) AS n FROM worker_jobs GROUP BY state ORDER BY state');
  const intents = await q(`SELECT j.id AS job_id, j.project_id, j.state, i.transaction_hash, i.keeper_address, i.nonce
    FROM worker_tx_intents i JOIN worker_jobs j ON j.id = i.job_id WHERE j.state NOT IN ('finalized','failed') ORDER BY i.nonce`);
  const chain = [];
  if (rpc && intents.length) {
    for (const intent of intents) {
      const receipt = await rpc.getReceipt(intent.transaction_hash);
      const latestNonce = await rpc.getLatestNonce(intent.keeper_address);
      const consumed = !receipt && latestNonce > Number(intent.nonce);
      chain.push({ jobId: intent.job_id, projectId: intent.project_id, state: intent.state, hasReceipt: Boolean(receipt), consumedWithoutReceipt: consumed });
      if (consumed) problems.push(`INTENT_NONCE_CONSUMED_WITHOUT_RECEIPT:${intent.job_id}`);
    }
  } else if (intents.length) problems.push('KEEPER_INTENTS_UNVERIFIED_WITHOUT_RPC');
  return {
    ok: problems.length === 0,
    problems,
    ledger: { total: Number(ledger.total), outstanding: Number(ledger.outstanding), outstandingMicrousd: String(ledger.outstanding_microusd),
      uncertainWithoutIdentity: Number(ledger.uncertain_without_identity), reserved: Number(ledger.reserved), checkpointOk },
    providers: { bindings: Number(activity.bindings), verified: Number(activity.verified_bindings) },
    gatewayInstances: instances.map(i => ({ id: i.id, stopped: i.stopped, silent: i.silent })),
    keeper: { jobs: Object.fromEntries(jobs.map(j => [j.state, Number(j.n)])), unfinishedIntents: intents.length, chain },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const args = process.argv.slice(2);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, statement_timeout: 30000 });
  try {
    if (args[0] === '--print-checkpoint') {
      process.stdout.write(`${await ledgerCheckpoint(pool)}\n`);
    } else {
      let rpc = null;
      if (process.env.BASE_RPC_URL) {
        const { createPublicClient, http } = await import('viem');
        const { base } = await import('viem/chains');
        const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL, { retryCount: 0, timeout: 10000 }) });
        rpc = {
          getReceipt: hash => client.getTransactionReceipt({ hash }).catch(() => null),
          getLatestNonce: address => client.getTransactionCount({ address, blockTag: 'latest' }),
        };
      }
      const checkpoint = args[0] === '--checkpoint' ? args[1] : null;
      const report = await checkRestore({ pool, checkpoint, rpc });
      process.stdout.write(`${JSON.stringify({ event: 'restore.checked', ...report })}\n`);
      if (!report.ok) process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
