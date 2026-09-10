import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
// Service-role grants live in db/roles.mjs and are applied by that command,
// not here: REVOKE/GRANT on every table inside a migration can deadlock
// against the live gateway's row-locking transactions during a pre-deploy.
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(845300071)");
    await client.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    try {
      const { WORKER_MIGRATION_SQL } =
        await import("../control-worker/schema.mjs");
      await client.query(WORKER_MIGRATION_SQL);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Services connect with restricted roles; migrations need the table owner.
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(pool);
    process.stdout.write("Database migrations applied.\n");
  } finally {
    await pool.end();
  }
}
