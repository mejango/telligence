import { randomBytes } from 'node:crypto';
import { encodeAbiParameters, getAddress, hashMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decryptSignerKey } from './crypto.mjs';

export const AUTH_ENVELOPE = [
  { type: 'uint8', name: 'version' }, { type: 'uint64', name: 'generation' },
  { type: 'uint8', name: 'resource' }, { type: 'string', name: 'nonce' },
  { type: 'string', name: 'issuedAt' }, { type: 'string', name: 'expirationTime' },
  { type: 'bytes', name: 'innerSignature' },
];
const BASE = 8453;
const DOMAIN = 'api.venice.ai';
const STATEMENT = 'Sign in to Venice AI';
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CHALLENGE_KEYS = new Set(['domain', 'uri', 'version', 'nonce', 'issuedAt', 'expirationTime', 'statement', 'chainId']);

function vaultAddress(value) {
  const address = getAddress(value);
  if (address === '0x0000000000000000000000000000000000000000') throw new Error('A deployed vault address is required');
  return address;
}

function timestamp(value) {
  if (typeof value !== 'string' || !DATE.test(value)) throw new Error('Invalid Venice timestamp');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid Venice timestamp');
  return time;
}

export function veniceResourceUri(resource, vault) {
  const address = vaultAddress(vault);
  const paths = ['/chat/completions', '/responses', '/embeddings', `/x402/balance/${address}`];
  if (!Number.isInteger(resource) || resource < 0 || resource >= paths.length) throw new Error('Unsupported Venice resource');
  return `https://${DOMAIN}/api/v1${paths[resource]}`;
}

export function makeVeniceChallenge({ resource, vault, now = Date.now() }) {
  if (!Number.isFinite(now)) throw new Error('Invalid signer clock');
  // Base blocks have second precision; a short backdate avoids rejecting a fresh signature against the latest block.
  const issuedAt = Math.floor(now / 1000) * 1000 - 5000;
  return { domain: DOMAIN, uri: veniceResourceUri(resource, vault), version: '1',
    nonce: randomBytes(16).toString('hex'), issuedAt: new Date(issuedAt).toISOString(),
    expirationTime: new Date(issuedAt + 300_000).toISOString(), statement: STATEMENT };
}

function validateChallenge({ challenge, vault, now }) {
  const address = vaultAddress(vault);
  if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge) || Object.keys(challenge).some((key) => !CHALLENGE_KEYS.has(key))) throw new Error('Invalid Venice challenge');
  if (challenge.domain !== DOMAIN || challenge.statement !== STATEMENT || challenge.version !== '1' || (challenge.chainId !== undefined && challenge.chainId !== BASE)) throw new Error('Unsupported Venice authentication context');
  const resource = [0, 1, 2, 3].find((candidate) => veniceResourceUri(candidate, address) === challenge.uri);
  if (resource === undefined) throw new Error('Unsupported Venice resource');
  if (typeof challenge.nonce !== 'string' || !/^[a-zA-Z0-9]{8,64}$/.test(challenge.nonce)) throw new Error('Invalid Venice nonce');
  const issuedAtMs = timestamp(challenge.issuedAt);
  const expirationTimeMs = timestamp(challenge.expirationTime);
  if (!Number.isFinite(now) || issuedAtMs > now || expirationTimeMs <= now || expirationTimeMs <= issuedAtMs || expirationTimeMs - issuedAtMs > 300_000) throw new Error('Invalid Venice challenge lifetime');
  return { address, resource, issuedAtMs, expirationTimeMs };
}

export function veniceMessage({ challenge, vault, now = Date.now() }) {
  const { address } = validateChallenge({ challenge, vault, now });
  return `${DOMAIN} wants you to sign in with your Ethereum account:\n${address}\n\n${STATEMENT}\n\nURI: ${challenge.uri}\nVersion: 1\nChain ID: 8453\nNonce: ${challenge.nonce}\nIssued At: ${challenge.issuedAt}\nExpiration Time: ${challenge.expirationTime}`;
}

export function parseVeniceMessage({ message, vault, now = Date.now() }) {
  if (typeof message !== 'string' || message.length > 1024 || message.includes('\r')) throw new Error('Invalid Venice message');
  const lines = message.split('\n');
  if (lines.length !== 11) throw new Error('Invalid Venice message');
  const value = (index, prefix) => {
    if (!lines[index].startsWith(prefix)) throw new Error('Invalid Venice message');
    return lines[index].slice(prefix.length);
  };
  const challenge = { domain: DOMAIN, statement: STATEMENT, version: '1',
    uri: value(5, 'URI: '), nonce: value(8, 'Nonce: '),
    issuedAt: value(9, 'Issued At: '), expirationTime: value(10, 'Expiration Time: ') };
  if (veniceMessage({ challenge, vault, now }) !== message) throw new Error('Noncanonical Venice message');
  return { challenge, ...validateChallenge({ challenge, vault, now }) };
}

export function authenticationTypedData({ vault, generation, messageHash }) {
  return {
    domain: { name: 'TelligenceVeniceAuth', version: '1', chainId: BASE, verifyingContract: vaultAddress(vault) },
    primaryType: 'VeniceAuthentication',
    types: { VeniceAuthentication: [{ name: 'messageHash', type: 'bytes32' }, { name: 'generation', type: 'uint64' }] },
    message: { messageHash, generation: BigInt(generation) },
  };
}

/** The private key only signs the fixed EIP712 authentication type, never an arbitrary caller digest. */
export async function signVeniceAuthentication({ binding, challenge, message, resource, encryptionKey, now = Date.now() }) {
  if (!binding || Number(binding.chain_id) !== BASE || !['ready', 'pending'].includes(binding.status)) throw new Error('Signer binding is unavailable');
  const vault = vaultAddress(binding.vault_address);
  const generation = BigInt(binding.signer_generation);
  if (generation < 1n || generation >= 2n ** 64n) throw new Error('Invalid signer generation');
  if ([challenge, message, resource].filter((value) => value !== undefined).length !== 1) throw new Error('Specify exactly one authentication input');
  if (resource !== undefined) challenge = makeVeniceChallenge({ resource, vault, now });
  if (challenge !== undefined) message = veniceMessage({ challenge, vault, now });
  const parsed = parseVeniceMessage({ message, vault, now });
  if (binding.status === 'pending' && parsed.resource !== 3) throw new Error('Inference requires verified provider activation');
  const signerAddress = getAddress(binding.signer_address);
  const account = privateKeyToAccount(decryptSignerKey(binding.encrypted_signer, encryptionKey, signerAddress.toLowerCase()));
  if (account.address !== signerAddress) throw new Error('Signer binding does not match encrypted key');
  const innerSignature = await account.signTypedData(authenticationTypedData({ vault, generation, messageHash: hashMessage(message) }));
  const signature = encodeAbiParameters(AUTH_ENVELOPE, [1, generation, parsed.resource, parsed.challenge.nonce, parsed.challenge.issuedAt, parsed.challenge.expirationTime, innerSignature]);
  const payload = { address: vault, message, signature, timestamp: parsed.issuedAtMs, chainId: BASE, type: 'eip1271' };
  return { headerName: 'SIGN-IN-WITH-X', headerValue: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'), expiresAt: parsed.challenge.expirationTime };
}
