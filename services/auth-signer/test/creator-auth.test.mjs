import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { challengeMessage, verifyCreatorSignature } from '../creator-auth.mjs';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const now = Date.parse('2026-09-09T12:00:00.000Z');
const challenge = {
  address: account.address,
  domain: 'telligence.example',
  origin: 'https://telligence.example',
  chainId: 8453,
  nonce: 'a1b2c3d4e5f60718a1b2c3d4e5f60718',
  issuedAt: new Date(now).toISOString(),
  expirationTime: new Date(now + 300_000).toISOString(),
};
const policy = { expectedDomain: challenge.domain, expectedOrigin: challenge.origin, now };

test('creator challenge clearly binds the requested wallet and Telligence session', async () => {
  const message = challengeMessage(challenge);
  assert.match(message, /Sign in to Telligence to manage your compute projects\./);
  assert.match(message, /Chain ID: 8453/);
  const signature = await account.signMessage({ message });
  assert.equal(await verifyCreatorSignature({ challenge, signature, ...policy }), true);
  assert.equal(await verifyCreatorSignature({ challenge: { ...challenge, nonce: `${challenge.nonce}1` }, signature, ...policy }), false);
});

test('creator authentication rejects replay across origin, wallet, chain and expiry', async () => {
  const signature = await account.signMessage({ message: challengeMessage(challenge) });
  for (const changed of [
    { domain: 'evil.example' }, { origin: 'https://evil.example' }, { chainId: 1 },
    { address: '0x2222222222222222222222222222222222222222' },
    { expirationTime: new Date(now).toISOString() },
    { issuedAt: new Date(now + 60_000).toISOString() },
    { nonce: 'abc\nResources:\n- transfer' }, { address: '' },
  ]) {
    assert.equal(await verifyCreatorSignature({ challenge: { ...challenge, ...changed }, signature, ...policy }), false);
  }
});

test('creator auth verifies contract wallets against Base, failing closed on RPC failures', async () => {
  const contractChallenge = { ...challenge, address: '0x2222222222222222222222222222222222222222' };
  let args;
  const publicClient = { chain: { id: 8453 }, verifyMessage: async (input) => { args = input; return true; } };
  assert.equal(await verifyCreatorSignature({ challenge: contractChallenge, signature: '0x1234', publicClient, ...policy }), true);
  assert.equal(args.address.toLowerCase(), contractChallenge.address);
  assert.equal(args.message, challengeMessage(contractChallenge));
  assert.equal(await verifyCreatorSignature({ challenge: contractChallenge, signature: '0x1234', publicClient: { ...publicClient, chain: { id: 1 } }, ...policy }), false);
  assert.equal(await verifyCreatorSignature({ challenge: contractChallenge, signature: '0x1234', publicClient: { ...publicClient, verifyMessage: async () => { throw new Error('unavailable'); } }, ...policy }), false);
});
