import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { decodeAbiParameters, getAddress, hashMessage, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encryptSignerKey } from '../crypto.mjs';
import { AUTH_ENVELOPE, authenticationTypedData, makeVeniceChallenge, parseVeniceMessage, signVeniceAuthentication, veniceMessage } from '../venice-auth.mjs';

const privateKey = `0x${'11'.repeat(32)}`;
const account = privateKeyToAccount(privateKey);
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const now = Date.parse('2026-09-09T12:00:00.000Z');
const vault = getAddress('0xf4d97f2da56e8c3098f3a8d538db630a2606a024');
const binding = {
  vault_address: vault.toLowerCase(), chain_id: 8453, signer_generation: 2,
  signer_address: account.address.toLowerCase(), status: 'ready',
  encrypted_signer: encryptSignerKey(privateKey, encryptionKey, account.address.toLowerCase()),
};

test('Venice envelope authenticates the vault and generation using the onchain EIP712 policy', async () => {
  const challenge = makeVeniceChallenge({ resource: 0, vault, now });
  const result = await signVeniceAuthentication({ binding, challenge, encryptionKey, now });
  const payload = JSON.parse(Buffer.from(result.headerValue, 'base64').toString());
  assert.equal(result.headerName, 'SIGN-IN-WITH-X');
  assert.equal(payload.address, vault);
  assert.equal(payload.type, 'eip1271');
  assert.equal(payload.chainId, 8453);
  assert.equal(payload.timestamp, Date.parse(challenge.issuedAt));
  const [version, generation, resource, nonce, issuedAt, expirationTime, signature] = decodeAbiParameters(AUTH_ENVELOPE, payload.signature);
  assert.equal(version, 1);
  assert.equal(generation, 2n);
  assert.equal(resource, 0);
  assert.equal(nonce, challenge.nonce);
  assert.equal(issuedAt, challenge.issuedAt);
  assert.equal(expirationTime, challenge.expirationTime);
  const typedData = authenticationTypedData({ vault, generation, messageHash: hashMessage(payload.message) });
  assert.equal(await recoverTypedDataAddress({ ...typedData, signature }), account.address);
  assert.notEqual(await recoverTypedDataAddress({ ...authenticationTypedData({ vault, generation: 3n, messageHash: hashMessage(payload.message) }), signature }), account.address);
});

test('signing permits only inference resources and the vault own balance endpoint', async () => {
  for (const resource of [0, 1, 2, 3]) {
    const challenge = makeVeniceChallenge({ resource, vault, now });
    const message = veniceMessage({ challenge, vault, now });
    assert.equal(parseVeniceMessage({ message, vault, now }).resource, resource);
    if (resource === 3) assert.equal(challenge.uri, `https://api.venice.ai/api/v1/x402/balance/${vault}`);
  }
  assert.throws(() => makeVeniceChallenge({ resource: 4, vault, now }));
});

test('signer rejects arbitrary messages, permissions and line injection before decrypting', async () => {
  const challenge = makeVeniceChallenge({ resource: 0, vault, now });
  for (const changed of [
    { domain: 'evil.example' }, { uri: 'https://api.venice.ai/api/v1/api_keys' },
    { uri: `https://api.venice.ai/api/v1/x402/balance/0x${'22'.repeat(20)}` },
    { uri: `${challenge.uri}?resource=transfer` }, { statement: 'Approve spending' },
    { nonce: 'nonce1234\nResources:\n- permit' }, { version: '2' },
    { expirationTime: new Date(now + 300_001).toISOString() },
    { issuedAt: new Date(now + 1_000).toISOString() },
    { issuedAt: '2026-02-30T12:00:00.000Z' }, { chainId: 1 },
    { resources: ['https://permit2.com'] },
  ]) {
    await assert.rejects(signVeniceAuthentication({ binding, challenge: { ...challenge, ...changed }, encryptionKey, now }));
  }
  for (const message of ['0x1234', 'Permit(address owner,address spender)', `${veniceMessage({ challenge, vault, now })}\nResources:\n- approval`]) {
    await assert.rejects(signVeniceAuthentication({ binding, message, encryptionKey, now }));
  }
});

test('disabled, wrong-chain and mismatched encrypted signer bindings fail closed', async () => {
  const challenge = makeVeniceChallenge({ resource: 0, vault, now });
  for (const changed of [{ status: 'disabled' }, { chain_id: 1 }, { signer_generation: -1 }, { signer_address: `0x${'22'.repeat(20)}` }, { vault_address: '' }]) {
    await assert.rejects(signVeniceAuthentication({ binding: { ...binding, ...changed }, challenge, encryptionKey, now }));
  }
  await assert.rejects(signVeniceAuthentication({ binding, challenge, encryptionKey, now: now + 300_000 }));
});

test('pending provider activation permits balance inspection while inference remains unavailable', async () => {
  const pending = { ...binding, status: 'pending' };
  const balance = await signVeniceAuthentication({ binding: pending, resource: 3, encryptionKey, now });
  assert.equal(balance.headerName, 'SIGN-IN-WITH-X');
  for (const resource of [0, 1, 2]) await assert.rejects(signVeniceAuthentication({ binding: pending, resource, encryptionKey, now }));
});

test('the shared Solidity vector is produced byte-for-byte by the deployed signer implementation', async () => {
  const vector = JSON.parse(await readFile(new URL('./venice-auth-vector.json', import.meta.url), 'utf8'));
  const vectorKey = `0x${'a11ce'.padStart(64, '0')}`;
  const vectorAccount = privateKeyToAccount(vectorKey);
  const result = await signVeniceAuthentication({
    binding: { ...binding, vault_address: vector.vault, signer_generation: vector.generation,
      signer_address: vectorAccount.address, encrypted_signer: encryptSignerKey(vectorKey, encryptionKey, vectorAccount.address.toLowerCase()) },
    challenge: Object.fromEntries(['domain', 'uri', 'version', 'nonce', 'issuedAt', 'expirationTime', 'statement'].map((field) => [field, vector[field]])),
    encryptionKey, now: Date.parse('2026-09-09T14:48:30.000Z'),
  });
  const payload = JSON.parse(Buffer.from(result.headerValue, 'base64').toString('utf8'));
  assert.equal(payload.message, vector.message);
  assert.equal(hashMessage(payload.message), vector.messageHash);
  assert.equal(payload.signature, vector.signatureEnvelope);
});
