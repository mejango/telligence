import { createServer } from "node:http";
import pg from "pg";
import { configFromEnv } from "./config.mjs";
import { loadManifest, ProjectRegistry } from "./registry.mjs";
import { GatewayStore } from "./store.mjs";
import { createHandler } from "./app.mjs";
import { ModelCatalog, startCatalogRefresh } from "./catalog.mjs";
const config = configFromEnv();
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
const server = createServer(
  { requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 },
  createHandler({ store, config, registry }),
);
server.keepAliveTimeout = 5000;
server.listen(config.port, "::", () =>
  process.stdout.write(
    JSON.stringify({ event: "gateway.started", port: config.port }) + "\n",
  ),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopCatalog();
  server.close(async () => {
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
