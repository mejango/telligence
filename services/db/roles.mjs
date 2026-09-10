/**
 * Least-privilege database roles. The migration owner (DATABASE_URL used by
 * `db/migrate.mjs`) owns every table; each service connects as its own role.
 *
 *   telligence_gateway  creator sessions, keys, reservations, project registration
 *   telligence_signer   read encrypted signers and reservation state, write preparations
 *   telligence_worker   chain reconciliation, capacity observations, keeper jobs
 *
 * No service role may DELETE, and none may read another service's private data:
 * the worker never sees encrypted signer material or API key hashes, the signer
 * never sees key hashes or sessions, and the gateway never sees signed keeper
 * transactions.
 *
 *   node db/roles.mjs                creates or updates the roles from
 *     TELLIGENCE_GATEWAY_DB_PASSWORD, TELLIGENCE_SIGNER_DB_PASSWORD, TELLIGENCE_WORKER_DB_PASSWORD
 *     and applies the grant matrix
 *   node db/roles.mjs --grants-only  re-applies the matrix after a migration
 *     that added tables; needs only the owner DATABASE_URL
 *
 * A table the matrix does not cover is unreadable by every service role, so a
 * forgotten grant fails loudly with permission denied rather than silently.
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const ROLES = ['telligence_gateway', 'telligence_signer', 'telligence_worker'];

const GRANTS = `
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM telligence_gateway, telligence_signer, telligence_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM telligence_gateway, telligence_signer, telligence_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO telligence_gateway, telligence_signer, telligence_worker;

GRANT SELECT, INSERT, UPDATE ON projects, provider_bindings, api_keys, usage_reservations, auth_challenges,
  creator_sessions, request_rate_windows, canary_runs, gateway_instances TO telligence_gateway;
GRANT SELECT, INSERT ON audit_events, usage_reconciliations TO telligence_gateway;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO telligence_gateway;
GRANT SELECT, UPDATE (claimed_project_id) ON signer_preparations TO telligence_gateway;

GRANT SELECT (id, vault_address, chain_id) ON projects TO telligence_signer;
GRANT SELECT (project_id, encrypted_signer, signer_generation, signer_address, status) ON provider_bindings TO telligence_signer;
GRANT SELECT, INSERT ON signer_preparations TO telligence_signer;
GRANT SELECT (id, project_id, state, dispatched_at) ON usage_reservations TO telligence_signer;

GRANT SELECT, UPDATE (status) ON projects TO telligence_worker;
GRANT SELECT (project_id, status, signer_address, signer_generation, provider_epoch, daily_limit_microusd,
  remaining_microusd, observed_at, canary_verified_at) ON provider_bindings TO telligence_worker;
GRANT UPDATE (status, provider_epoch, daily_limit_microusd, remaining_microusd, observed_at) ON provider_bindings TO telligence_worker;
GRANT SELECT, INSERT, UPDATE ON worker_project_leases, worker_jobs, worker_tx_intents, worker_chain_blocks,
  worker_capacity_evidence, worker_project_checks TO telligence_worker;
`;

/** Idempotent; a no-op until every role exists. */
export const ROLE_GRANTS_SQL = `
DO $grants$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('telligence_gateway','telligence_signer','telligence_worker')) = 3 THEN
    ${GRANTS.split(';').map(statement => statement.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .map(statement => `EXECUTE '${statement.replaceAll("'", "''")}';`).join('\n    ')}
  END IF;
END $grants$;
`;

export async function ensureRoles(pool, passwords) {
  for (const role of ROLES) {
    const password = passwords[role];
    if (typeof password !== 'string' || password.length < 32 || /[\s'\\]/.test(password)) throw new Error(`A password of at least 32 safe characters is required for ${role}`);
    // Role names are fixed constants; the password is passed as a literal through format().
    await pool.query(`DO $r$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        EXECUTE format('CREATE ROLE ${role} LOGIN PASSWORD %L NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER', $1);
      ELSE
        EXECUTE format('ALTER ROLE ${role} WITH LOGIN PASSWORD %L NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER', $1);
      END IF; END $r$;`.replaceAll('$1', `'${password}'`));
  }
  await pool.query(ROLE_GRANTS_SQL);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    if (process.argv[2] === '--grants-only') {
      await pool.query(ROLE_GRANTS_SQL);
      process.stdout.write('Database grants applied.\n');
    } else {
      await ensureRoles(pool, {
        telligence_gateway: process.env.TELLIGENCE_GATEWAY_DB_PASSWORD,
        telligence_signer: process.env.TELLIGENCE_SIGNER_DB_PASSWORD,
        telligence_worker: process.env.TELLIGENCE_WORKER_DB_PASSWORD,
      });
      process.stdout.write('Database roles and grants applied.\n');
    }
  } finally {
    await pool.end();
  }
}
