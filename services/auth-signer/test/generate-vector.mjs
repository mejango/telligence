// Public test vector. This well-known key MUST NEVER hold funds or be used in a deployment.
import { writeFile } from 'node:fs/promises';
import { hashMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encryptSignerKey } from '../crypto.mjs';
import { signVeniceAuthentication } from '../venice-auth.mjs';

const privateKey = `0x${'a11ce'.padStart(64, '0')}`;
const account = privateKeyToAccount(privateKey);
const encryptionKey = Buffer.alloc(32, 1).toString('base64');
const vault = '0x1234567890123456789012345678901234567890';
const challenge = {
  domain: 'api.venice.ai', statement: 'Sign in to Venice AI', uri: 'https://api.venice.ai/api/v1/chat/completions',
  version: '1', nonce: 'W0Qbv46Qn9o5717ULywyE', issuedAt: '2026-09-09T14:48:27.529Z', expirationTime: '2026-09-09T14:53:27.529Z',
};
const result = await signVeniceAuthentication({
  binding: { vault_address: vault, chain_id: 8453, signer_generation: 1, signer_address: account.address, status: 'ready',
    encrypted_signer: encryptSignerKey(privateKey, encryptionKey, account.address.toLowerCase()) },
  challenge, encryptionKey, now: Date.parse('2026-09-09T14:48:30.000Z'),
});
const payload = JSON.parse(Buffer.from(result.headerValue, 'base64').toString('utf8'));
await writeFile(new URL('./venice-auth-vector.json', import.meta.url), `${JSON.stringify({
  warning: 'PUBLIC TEST KEY. Never use in production.', vault, signer: account.address, generation: 1,
  resource: 0, ...challenge, message: payload.message, messageHash: hashMessage(payload.message), signatureEnvelope: payload.signature,
}, null, 2)}\n`);
