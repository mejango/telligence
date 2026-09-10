import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { privateKeyToAccount } from 'viem/accounts';
import { createSignerServer } from '../server.mjs';
import { createSignerClient } from '../client.mjs';
import { encryptSignerKey } from '../crypto.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const preparationId = '22222222-2222-4222-8222-222222222222';
const secret = randomBytes(32).toString('base64url');
const workerSecret = randomBytes(32).toString('base64url');
const reservationId = '33333333-3333-4333-8333-333333333333';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const privateKey = `0x${'11'.repeat(32)}`;
const account = privateKeyToAccount(privateKey);
const now = Date.parse('2026-09-09T12:00:00.000Z');
const binding = {
  vault_address: `0x${'22'.repeat(20)}`, chain_id: 8453, signer_generation: 1,
  signer_address: account.address.toLowerCase(), status: 'ready',
  encrypted_signer: encryptSignerKey(privateKey, encryptionKey, account.address.toLowerCase()),
};

async function fixture(t, options = {}) {
  const state = { loads: 0, preparations: [] };
  const server = createSignerServer({ serviceSecrets: { gateway: secret, worker: workerSecret }, encryptionKey, now: () => now,
    loadSignerBinding: async (id) => { state.loads++; return id === projectId ? binding : undefined; },
    loadReservation: async (project, id) => (project === projectId && id === reservationId ? { state: 'reserved', dispatched_at: null } : undefined),
    saveSignerPreparation: async (record) => { state.preparations.push(record); return record; }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, authorization = `Bearer ${secret}`) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify(body) });
  return { server, state, url, post };
}

test('private signer authenticates before reading a binding or returning signatures', async (t) => {
  const { post, state } = await fixture(t);
  const unauthorized = await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0 }, 'Bearer wrong');
  assert.equal(unauthorized.status, 401);
  assert.equal(state.loads, 0);
  const valid = await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0, reservationId });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).headerName, 'SIGN-IN-WITH-X');
  assert.match(valid.headers.get('cache-control'), /no-store/);
});

test('private signer rejects generic signing, oversized input, extra fields and unknown projects', async (t) => {
  const { post } = await fixture(t);
  assert.equal((await post('/v1/sign', { hash: `0x${'11'.repeat(32)}` })).status, 404);
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { message: 'Sign a permit', reservationId })).status, 400);
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0, reservationId, privateKey })).status, 400);
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { message: 'a'.repeat(9000) })).status, 413);
  assert.equal((await post(`/v1/projects/${preparationId}/venice-signature`, { resource: 3 })).status, 404);
});

test('the worker credential can only request the free balance resource', async (t) => {
  const { post, state } = await fixture(t);
  const auth = `Bearer ${workerSecret}`;
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 3 }, auth)).status, 200);
  for (const resource of [0, 1, 2]) {
    assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource, reservationId }, auth)).status, 403);
  }
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { message: 'x' }, auth)).status, 403);
  assert.equal((await post('/v1/prepare-signer', { creatorAddress: account.address, preparationId }, auth)).status, 403);
  assert.equal(state.preparations.length, 0);
});

test('inference signatures require a durable undispatched reservation of the same project', async (t) => {
  const loads = [];
  const { post, state } = await fixture(t, { loadReservation: async (project, id) => { loads.push([project, id]); return id === reservationId ? { state: 'reserved', dispatched_at: null } : id === preparationId ? { state: 'reserved', dispatched_at: new Date() } : undefined; } });
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0 })).status, 409);
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0, reservationId: 'nope' })).status, 409);
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0, reservationId: preparationId })).status, 409);
  assert.equal(state.loads, 0, 'no key material is touched without a valid reservation');
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 3, reservationId })).status, 400);
  assert.equal((await post(`/v1/projects/${projectId}/venice-signature`, { resource: 0, reservationId })).status, 200);
  assert.deepEqual(loads.at(-1), [projectId, reservationId]);
});

test('identical or missing caller credentials are refused at startup', () => {
  const store = { loadSignerBinding: async () => binding, saveSignerPreparation: async (r) => r, loadReservation: async () => undefined };
  assert.throws(() => createSignerServer({ ...store, serviceSecrets: { gateway: secret, worker: secret }, encryptionKey }));
  assert.throws(() => createSignerServer({ ...store, serviceSecrets: { gateway: secret }, encryptionKey }));
  assert.throws(() => createSignerServer({ ...store, serviceSecret: secret, encryptionKey }));
});

test('preparing a dedicated signer returns only its public address and opaque preparation ID', async (t) => {
  const { url, state } = await fixture(t);
  const client = createSignerClient({ url, secret });
  const result = await client.prepareSigner({ creatorAddress: account.address, preparationId });
  assert.equal(result.preparationId, preparationId);
  assert.match(result.inferenceSigner, /^0x[0-9a-fA-F]{40}$/);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'inferenceSigner', 'preparationId']);
  assert.equal(result.expiresAt, new Date(now + 24 * 60 * 60 * 1000).toISOString());
  assert.equal(state.preparations.length, 1);
  assert.equal(state.preparations[0].creator_address, account.address.toLowerCase());
  assert.equal(state.preparations[0].encrypted_signer.includes(privateKey), false);
  assert.ok(new Date(state.preparations[0].expires_at).getTime() > now);
  assert.equal((await client.getHeader({ id: projectId }, 3)).headerName, 'SIGN-IN-WITH-X');
});

test('private client rejects public URLs, redirects and unexpected upstream responses', async () => {
  for (const url of ['https://evil.example', 'http://signer.railway.internal@evil.example', 'http://signer.railway.internal/path', 'http://signer.railway.internal?leak=1']) {
    assert.throws(() => createSignerClient({ url, secret }));
  }
  let request;
  const client = createSignerClient({ url: 'http://signer.railway.internal', secret, fetchImpl: async (url, options) => {
    request = options;
    return new Response(JSON.stringify({ headerName: 'Authorization', headerValue: 'Bearer secret' }), { status: 200 });
  } });
  await assert.rejects(client.getHeader(projectId, 0));
  assert.equal(request.redirect, 'error');
});
