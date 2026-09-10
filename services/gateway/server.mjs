import { createServer } from "node:http";
import pg from "pg";
import { configFromEnv } from "./config.mjs";
import { loadManifest, ProjectRegistry } from "./registry.mjs";
import { GatewayStore } from "./store.mjs";
import { createHandler } from "./app.mjs";
import { ModelCatalog, startCatalogRefresh } from "./catalog.mjs";
const config = configFromEnv();
const log = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const modelCatalog = config.modelPolicy ? new ModelCatalog({ policy: config.modelPolicy }) : null;
if (modelCatalog) config.getCatalog = () => modelCatalog.current();
const stopCatalog = modelCatalog ? startCatalogRefresh(modelCatalog, () => process.stderr.write('{"event":"model_catalog_refresh_failed"}\n')) : () => {};
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 20000,
});
await pool.query("SELECT id FROM projects LIMIT 0");
const manifest = await loadManifest(config.manifestPath);
const registry = new ProjectRegistry({ rpcUrl: config.rpcUrl, manifest });
const store = new GatewayStore(pool, config);
// Request lifecycle: register this process, then recover orphans left by any
// stopped or silent instance before accepting traffic. Reservations proven
// undispatched are released; every other orphan is held as uncertain.
await store.heartbeat();
if (config.expectedLedgerCheckpoint) {
  const trusted = await store.verifyLedgerCheckpoint(config.expectedLedgerCheckpoint);
  log({ event: trusted ? "ledger.checkpoint_verified" : "ledger.untrusted", checkpoint: config.expectedLedgerCheckpoint });
}
const RECOVERY_STALE_MS = 60000;
const recover = async () => {
  try {
    const counts = await store.recoverOrphans({ staleAfterMs: RECOVERY_STALE_MS });
    if (counts.released || counts.uncertain) log({ event: "usage.orphans_recovered", ...counts });
  } catch {
    log({ event: "usage.recovery_failed" });
  }
};
await recover();
const heartbeatTimer = setInterval(() => store.heartbeat().catch(() => log({ event: "gateway.heartbeat_failed" })), 5000);
const recoveryTimer = setInterval(recover, 30000);
heartbeatTimer.unref();
recoveryTimer.unref();
const server = createServer(
  { requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 },
  createHandler({ store, config, registry }),
);
server.keepAliveTimeout = 5000;
server.listen(config.port, "::", () =>
  log({ event: "gateway.started", port: config.port, instance: store.instanceId }),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopCatalog();
  clearInterval(heartbeatTimer);
  clearInterval(recoveryTimer);
  server.close(async () => {
    // Drained: every reservation this process owned has settled, so the
    // instance can be marked stopped for the next process to trust.
    await store.stop().catch(() => {});
    await pool.end();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 130000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
