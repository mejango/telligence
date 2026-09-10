import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { BaseChain } from './chain.mjs';
import { Worker } from './worker.mjs';
import { PostgresWorkerStore } from './postgres.mjs';
import { ControlRuntime } from './runtime.mjs';
import { configFromEnv } from './config.mjs';
import { safeErrorCode } from './errors.mjs';
import { runLoop } from './scheduler.mjs';
import { createSignerClient } from '../auth-signer/client.mjs';

const READY_WINDOW_MS = 120_000;

export async function start(config = configFromEnv()) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000, statement_timeout: 30_000 });
  const store = new PostgresWorkerStore(pool);
  let runtime;
  let stopping = false;
  const abort = new AbortController();
  const loops = {};
  const log = entry => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const fresh = loop => Boolean(loop) && Date.now() - loop.lastSuccess < READY_WINDOW_MS;
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://worker.internal').pathname;
    if (request.method !== 'GET' || !['/healthz', '/readyz'].includes(path)) { response.writeHead(404).end(); return; }
    const ready = Boolean(runtime) && fresh(loops.capacity) && fresh(loops.maintenance) && !stopping;
    response.writeHead(path === '/readyz' && !ready ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ service: 'control-worker', status: stopping ? 'draining' : ready ? 'ready' : 'awaiting_configuration',
      keeperExecution: config.executionEnabled,
      loops: Object.fromEntries(Object.entries(loops).map(([name, loop]) => [name, { fresh: fresh(loop), lastSuccess: loop.lastSuccess ? new Date(loop.lastSuccess).toISOString() : null }])) }));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await pool.query('SELECT 1');
  if (config.manifestPath && config.rpcUrl && config.signerUrl && config.signerSecret) {
    const manifest = JSON.parse(await readFile(config.manifestPath, 'utf8'));
    const chain = new BaseChain({ manifest, rpcUrl: config.rpcUrl, keeperPrivateKey: config.keeperPrivateKey,
      maxGas: config.maxGas, maxFeePerGas: config.maxFeePerGas });
    const signer = createSignerClient({ url: config.signerUrl, secret: config.signerSecret });
    const worker = new Worker({ store, chain, executionEnabled: config.executionEnabled, confirmations: config.confirmations });
    runtime = new ControlRuntime({ store, chain, signer, worker, log });
  }
  await new Promise(resolve => server.listen(config.port, '::', resolve));
  if (runtime) {
    // Capacity observation runs alone: nothing slower than one bounded sweep can stall it.
    loops.capacity = runLoop({ name: 'capacity', everyMs: 5000, signal: abort.signal, log, run: async () => {
      await pool.query('SELECT 1');
      await runtime.refreshCapacity();
    } });
    let nextPlan = 0, nextAudit = 0;
    loops.maintenance = runLoop({ name: 'maintenance', everyMs: 1000, signal: abort.signal, log, run: async () => {
      await pool.query('SELECT 1');
      if (Date.now() >= nextAudit) {
        const block = await runtime.chain.client.getBlock({ blockTag: 'latest' });
        await runtime.chain.verifyPins(block.number);
        await runtime.auditReceipts(); nextAudit = Date.now() + 60_000;
      }
      await runtime.worker.tick();
      if (Date.now() >= nextPlan) { await runtime.plan(); nextPlan = Date.now() + 15_000; }
    } });
  } else {
    // Unconfigured: keep liveness, report not ready, and poll only the database.
    loops.database = runLoop({ name: 'database', everyMs: 5000, signal: abort.signal, log, run: () => pool.query('SELECT 1') });
  }
  const close = async () => {
    if (stopping) return;
    stopping = true; abort.abort();
    await Promise.all(Object.values(loops).map(loop => loop.done));
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  };
  return { server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then(service => {
    const shutdown = () => { service.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  }).catch(error => { process.stderr.write(`control-worker startup failed: ${safeErrorCode(error)}\n`); process.exitCode = 1; });
}
