/**
 * Re-encrypt every stored inference signer from the previous encryption key to
 * the current one. Run only on the signer host; nothing here leaves the process.
 *
 * node auth-signer/rotate-encryption-key.mjs --check     report only, no writes
 * node auth-signer/rotate-encryption-key.mjs --rotate    re-encrypt atomically
 *
 * Requires DATABASE_URL (a role that may update encrypted_signer), the new
 * SIGNER_ENCRYPTION_KEY and the old SIGNER_ENCRYPTION_KEY_PREVIOUS. Rows the
 * new key already decrypts are left alone. A row neither key decrypts aborts
 * the whole rotation: an undecryptable signer must be rotated onchain instead.
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { privateKeyToAccount } from 'viem/accounts';
import { decryptSignerKey, encryptSignerKey } from './crypto.mjs';

const TABLES = [
  { table: 'provider_bindings', key: 'project_id', where: '' },
  { table: 'signer_preparations', key: 'id', where: 'WHERE claimed_project_id IS NULL AND expires_at > clock_timestamp()' },
];

function classify(row, currentKey, previousKey) {
  const context = row.signer_address.toLowerCase();
  try {
    decryptSignerKey(row.encrypted_signer, currentKey, context);
    return { state: 'current' };
  } catch { /* try previous */ }
  try {
    const privateKey = decryptSignerKey(row.encrypted_signer, previousKey, context);
    if (privateKeyToAccount(privateKey).address.toLowerCase() !== context) return { state: 'mismatch' };
    return { state: 'previous', privateKey };
  } catch {
    return { state: 'undecryptable' };
  }
}

export async function rotateEncryptedSigners({ pool, currentKey, previousKey, write = false }) {
  encryptSignerKey(`0x${'01'.repeat(32)}`, currentKey, 'validation');
  encryptSignerKey(`0x${'01'.repeat(32)}`, previousKey, 'validation');
  if (currentKey === previousKey) throw new Error('Keys must differ');
  const client = await pool.connect();
  const report = { current: 0, rotated: 0, undecryptable: 0, mismatch: 0, written: write };
  try {
    await client.query('BEGIN');
    for (const { table, key, where } of TABLES) {
      const { rows } = await client.query(`SELECT ${key} AS id, signer_address, encrypted_signer FROM ${table} ${where} ORDER BY 1 FOR UPDATE`);
      for (const row of rows) {
        const result = classify(row, currentKey, previousKey);
        if (result.state === 'previous') {
          report.rotated++;
          if (write) {
            await client.query(`UPDATE ${table} SET encrypted_signer=$2 WHERE ${key}=$1`,
              [row.id, encryptSignerKey(result.privateKey, currentKey, row.signer_address.toLowerCase())]);
          }
        } else report[result.state]++;
      }
    }
    if (report.undecryptable || report.mismatch) throw Object.assign(new Error('Undecryptable signer rows; rotate those signers onchain'), { code: 'ROTATION_INCOMPLETE', report });
    await client.query(write ? 'COMMIT' : 'ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (!['--check', '--rotate'].includes(mode) || process.argv.length !== 3) {
    process.stderr.write('Usage: rotate-encryption-key.mjs --check | --rotate\n');
    process.exit(2);
  }
  const { DATABASE_URL, SIGNER_ENCRYPTION_KEY, SIGNER_ENCRYPTION_KEY_PREVIOUS } = process.env;
  if (!DATABASE_URL || !SIGNER_ENCRYPTION_KEY || !SIGNER_ENCRYPTION_KEY_PREVIOUS) throw new Error('DATABASE_URL, SIGNER_ENCRYPTION_KEY and SIGNER_ENCRYPTION_KEY_PREVIOUS are required');
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const report = await rotateEncryptedSigners({ pool, currentKey: SIGNER_ENCRYPTION_KEY, previousKey: SIGNER_ENCRYPTION_KEY_PREVIOUS, write: mode === '--rotate' });
    process.stdout.write(`${JSON.stringify({ event: 'signer.rotation', ...report })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: 'signer.rotation_failed', code: error.code ?? 'ROTATION_FAILED', report: error.report ?? null })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
