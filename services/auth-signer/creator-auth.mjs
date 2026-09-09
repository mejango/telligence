import { getAddress, isHex, verifyMessage } from 'viem';

const STATEMENT = 'Sign in to Telligence to manage your compute projects.';
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function timestamp(value) {
  if (typeof value !== 'string' || !DATE.test(value)) throw new Error('Invalid challenge date');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw new Error('Invalid challenge date');
  return milliseconds;
}

function validateChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) throw new Error('Invalid creator challenge');
  if (challenge.chainId !== 8453) throw new Error('Creator authentication requires Base');
  const address = getAddress(challenge.address);
  if (address === '0x0000000000000000000000000000000000000000') throw new Error('Creator address is required');
  const url = new URL(challenge.origin);
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.origin !== challenge.origin || url.host !== challenge.domain || (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:'))) {
    throw new Error('Invalid creator challenge origin');
  }
  if (typeof challenge.nonce !== 'string' || !/^[a-zA-Z0-9]{16,128}$/.test(challenge.nonce)) throw new Error('Invalid creator challenge nonce');
  const issuedAt = timestamp(challenge.issuedAt);
  const expirationTime = timestamp(challenge.expirationTime);
  if (expirationTime <= issuedAt || expirationTime - issuedAt > 300_000) throw new Error('Invalid creator challenge lifetime');
  return { address, issuedAt, expirationTime };
}

/** Render a server-stored one-time challenge. The gateway owns persistence and atomic consumption. */
export function challengeMessage(challenge) {
  const { address } = validateChallenge(challenge);
  return `${challenge.domain} wants you to sign in with your Ethereum account:\n${address}\n\n${STATEMENT}\n\nURI: ${challenge.origin}\nVersion: 1\nChain ID: 8453\nNonce: ${challenge.nonce}\nIssued At: ${challenge.issuedAt}\nExpiration Time: ${challenge.expirationTime}`;
}

/** EOA verification is local; smart-wallet verification uses a caller-supplied Base public client. */
export async function verifyCreatorSignature({ challenge, signature, expectedDomain, expectedOrigin, now = Date.now(), publicClient }) {
  try {
    const { address, issuedAt, expirationTime } = validateChallenge(challenge);
    if (!expectedDomain || !expectedOrigin || challenge.domain !== expectedDomain || challenge.origin !== expectedOrigin) return false;
    if (!Number.isFinite(now) || now < issuedAt || now >= expirationTime) return false;
    if (!isHex(signature) || signature.length > 16_386) return false;
    const message = challengeMessage(challenge);
    if (await verifyMessage({ address, message, signature }).catch(() => false)) return true;
    if (!publicClient || publicClient.chain?.id !== 8453) return false;
    return (await publicClient.verifyMessage({ address, message, signature })) === true;
  } catch {
    return false;
  }
}
