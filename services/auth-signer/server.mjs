import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import pg from 'pg';
import { encryptSignerKey, verifyServiceCredential } from './crypto.mjs';
import { signVeniceAuthentication } from './venice-auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_LIMIT = 8192;

function respond(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw Object.assign(new Error('Content type must be application/json'), { status: 415 });
  if (Number(request.headers['content-length']) > BODY_LIMIT) { request.resume(); throw Object.assign(new Error('Request body is too large'), { status: 413 }); }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
    return value;
  } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

export function createPostgresSignerStore(pool) {
  return {
    async loadReservation(projectId, reservationId) {
      const result = await pool.query('SELECT state, dispatched_at FROM usage_reservations WHERE id = $1 AND project_id = $2', [reservationId, projectId]);
      return result.rows[0];
    },
    async loadSignerBinding(projectId) {
      const result = await pool.query(`SELECT p.vault_address, p.chain_id, b.encrypted_signer, b.signer_generation,
          b.signer_address, b.status
        FROM provider_bindings b JOIN projects p ON p.id = b.project_id
        WHERE p.id = $1`, [projectId]);
      return result.rows[0];
    },
    async saveSignerPreparation(record) {
      await pool.query(`INSERT INTO signer_preparations
          (id, creator_address, encrypted_signer, signer_address, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [record.id, record.creator_address, record.encrypted_signer, record.signer_address, record.created_at, record.expires_at]);
      const result = await pool.query(`SELECT id, signer_address, expires_at FROM signer_preparations
        WHERE id = $1 AND creator_address = $2 AND claimed_project_id IS NULL AND expires_at > now()`, [record.id, record.creator_address]);
      if (!result.rows[0]) throw Object.assign(new Error('Signer preparation is unavailable'), { status: 409 });
      return result.rows[0];
    },
  };
}

/**
 * Only expose on Railway private networking. Every signing operation authenticates
 * with a caller-scoped credential: the worker may only request the free balance
 * resource, and the gateway may only request an inference signature for a
 * reservation that is durably reserved and not yet dispatched. Key material
 * protection (the encryption key) is separate from this request authorization.
 */
export function createSignerServer({ loadSignerBinding, saveSignerPreparation, loadReservation, serviceSecrets, encryptionKey, previousEncryptionKey, now = Date.now, maxConcurrency = 16 }) {
  if (previousEncryptionKey !== undefined) {
    encryptSignerKey(`0x${'01'.repeat(32)}`, previousEncryptionKey, 'startup-validation');
    if (previousEncryptionKey === encryptionKey) throw new Error('The previous encryption key must differ from the current key');
  }
  const roles = ['gateway', 'worker'];
  if (!serviceSecrets || Object.keys(serviceSecrets).sort().join() !== roles.join()) throw new Error('Gateway and worker signer credentials are required');
  for (const role of roles) verifyServiceCredential('', serviceSecrets[role]);
  if (serviceSecrets.gateway === serviceSecrets.worker) throw new Error('Gateway and worker signer credentials must differ');
  // Validate the key before accepting traffic, using nonsecret test material which is never persisted.
  encryptSignerKey(`0x${'01'.repeat(32)}`, encryptionKey, 'startup-validation');
  if (typeof loadSignerBinding !== 'function' || typeof saveSignerPreparation !== 'function' || typeof loadReservation !== 'function') throw new Error('Signer storage is required');
  let active = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') return respond(response, 200, { status: 'ok' });
    const role = roles.find((candidate) => verifyServiceCredential(request.headers.authorization, serviceSecrets[candidate]));
    if (!role) return respond(response, 401, { error: 'unauthorized' });
    if (active >= maxConcurrency) return respond(response, 503, { error: 'signer_busy' });
    active++;
    try {
      if (request.method !== 'POST') return respond(response, 404, { error: 'not_found' });
      if (request.url === '/v1/prepare-signer') {
        if (role !== 'gateway') return respond(response, 403, { error: 'scope_forbidden' });
        const body = await jsonBody(request);
        if (Object.keys(body).sort().join() !== 'creatorAddress,preparationId' || !UUID.test(body.preparationId)) return respond(response, 400, { error: 'invalid_preparation' });
        let creatorAddress;
        try { creatorAddress = getAddress(body.creatorAddress); } catch { return respond(response, 400, { error: 'invalid_preparation' }); }
        if (creatorAddress === '0x0000000000000000000000000000000000000000') return respond(response, 400, { error: 'invalid_preparation' });
        const privateKey = generatePrivateKey();
        const signer = privateKeyToAccount(privateKey);
        const time = now();
        const record = await saveSignerPreparation({ id: body.preparationId, creator_address: creatorAddress.toLowerCase(),
          signer_address: signer.address.toLowerCase(), encrypted_signer: encryptSignerKey(privateKey, encryptionKey, signer.address.toLowerCase()),
          created_at: new Date(time).toISOString(), expires_at: new Date(time + 24 * 60 * 60 * 1000).toISOString() });
        return respond(response, 200, { preparationId: record.id, inferenceSigner: getAddress(record.signer_address), expiresAt: new Date(record.expires_at).toISOString() });
      }
      const matched = /^\/v1\/projects\/([^/]+)\/venice-signature$/.exec(request.url);
      if (!matched || !UUID.test(matched[1])) return respond(response, 404, { error: 'not_found' });
      const body = await jsonBody(request);
      const { reservationId, ...input } = body;
      if (Object.keys(input).length !== 1 || !['resource', 'challenge', 'message'].includes(Object.keys(input)[0])) return respond(response, 400, { error: 'invalid_authentication_request' });
      const balanceOnly = input.resource === 3;
      if (role === 'worker' && !balanceOnly) return respond(response, 403, { error: 'scope_forbidden' });
      if (!balanceOnly) {
        // Inference signatures exist only for a durable, not yet dispatched reservation of this project.
        if (!UUID.test(reservationId ?? '')) return respond(response, 409, { error: 'reservation_required' });
        const reservation = await loadReservation(matched[1], reservationId);
        if (!reservation || reservation.state !== 'reserved' || reservation.dispatched_at) return respond(response, 409, { error: 'reservation_required' });
      } else if (reservationId !== undefined) return respond(response, 400, { error: 'invalid_authentication_request' });
      const binding = await loadSignerBinding(matched[1]);
      if (!binding || binding.status === 'disabled') return respond(response, 404, { error: 'binding_unavailable' });
      let result;
      try { result = await signVeniceAuthentication({ binding, ...input, encryptionKey, previousEncryptionKey, now: now() }); }
      catch { return respond(response, 400, { error: 'authentication_policy_rejected' }); }
      return respond(response, 200, result);
    } catch (error) {
      return respond(response, error.status ?? 503, { error: error.status ? 'request_rejected' : 'signer_unavailable' });
    } finally { active--; }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  const server = createSignerServer({ ...createPostgresSignerStore(pool),
    serviceSecrets: { gateway: process.env.AUTH_SIGNER_GATEWAY_SECRET, worker: process.env.AUTH_SIGNER_WORKER_SECRET },
    encryptionKey: process.env.SIGNER_ENCRYPTION_KEY,
    previousEncryptionKey: process.env.SIGNER_ENCRYPTION_KEY_PREVIOUS || undefined });
  server.listen(Number(process.env.PORT ?? 3001), '::');
  const shutdown = () => {
    server.close(() => { void pool.end(); });
    setTimeout(() => { server.closeAllConnections(); void pool.end(); }, 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
