import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { BaseChain } from './chain.mjs';
import { Worker } from './worker.mjs';
import { PostgresWorkerStore } from './postgres.mjs';
import { ControlRuntime } from './runtime.mjs';
import { configFromEnv } from './config.mjs';
import { safeErrorCode } from './errors.mjs';
import { createSignerClient } from '../auth-signer/client.mjs';

export async function start(config = configFromEnv()) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000, statement_timeout: 30_000 });
  const store = new PostgresWorkerStore(pool);
  let runtime;
  let lastSuccess = 0;
  let stopping = false;
  const abort = new AbortController();
  const log = entry => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://worker.internal').pathname;
    if (request.method !== 'GET' || !['/healthz', '/readyz'].includes(path)) { response.writeHead(404).end(); return; }
    const ready = Boolean(runtime) && Date.now() - lastSuccess < 120_000 && !stopping;
    response.writeHead(path === '/readyz' && !ready ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ service: 'control-worker', status: stopping ? 'draining' : ready ? 'ready' : 'awaiting_configuration', keeperExecution: config.executionEnabled }));
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
  let nextRefresh = 0, nextPlan = 0, nextAudit = 0;
  const loop = (async () => {
    while (!stopping) {
      try {
        await pool.query('SELECT 1');
        if (runtime) {
          if (Date.now() >= nextAudit) {
            const block = await runtime.chain.client.getBlock({ blockTag: 'latest' });
            await runtime.chain.verifyPins(block.number);
            await runtime.auditReceipts(); nextAudit = Date.now() + 60_000;
          }
          await runtime.worker.tick();
          if (Date.now() >= nextRefresh) { await runtime.refreshCapacity(); nextRefresh = Date.now() + 5000; }
          if (Date.now() >= nextPlan) { await runtime.plan(); nextPlan = Date.now() + 15_000; }
          lastSuccess = Date.now();
        }
      } catch (error) { lastSuccess = 0; log({ event: 'worker_cycle_failed', code: safeErrorCode(error) }); }
      try { await delay(1000, undefined, { signal: abort.signal }); } catch { /* graceful shutdown */ }
    }
  })();
  const close = async () => {
    if (stopping) return;
    stopping = true; abort.abort();
    await loop;
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
