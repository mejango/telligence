import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { encryptSignerKey, decryptSignerKey, verifyServiceCredential } from '../crypto.mjs';

const privateKey = `0x${'11'.repeat(32)}`;
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

test('signer encryption uses randomized authenticated ciphertext bound to one project', () => {
  const first = encryptSignerKey(privateKey, encryptionKey, 'project-a');
  const second = encryptSignerKey(privateKey, encryptionKey, 'project-a');
  assert.notEqual(first, second);
  assert.equal(first.includes(privateKey), false);
  assert.equal(decryptSignerKey(first, encryptionKey, 'project-a'), privateKey);
  assert.throws(() => decryptSignerKey(first, encryptionKey, 'project-b'));
  assert.throws(() => decryptSignerKey(first, randomBytes(32).toString('base64'), 'project-a'));
});

test('tampered ciphertext, unsupported formats and unsafe encryption keys fail closed', () => {
  const payload = JSON.parse(encryptSignerKey(privateKey, encryptionKey, 'project-a'));
  payload.tag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decryptSignerKey(JSON.stringify(payload), encryptionKey, 'project-a'));
  assert.throws(() => encryptSignerKey(privateKey, 'password', 'project-a'));
  assert.throws(() => encryptSignerKey('not a key', encryptionKey, 'project-a'));
  assert.throws(() => decryptSignerKey('{"v":999}', encryptionKey, 'project-a'));
});

test('service credentials require an exact bearer secret and safe configured entropy', () => {
  const secret = randomBytes(32).toString('base64url');
  assert.equal(verifyServiceCredential(`Bearer ${secret}`, secret), true);
  for (const value of [undefined, secret, `bearer ${secret}`, `Bearer ${secret} `, 'Bearer wrong']) {
    assert.equal(verifyServiceCredential(value, secret), false);
  }
  assert.throws(() => verifyServiceCredential('Bearer short', 'short'));
});
