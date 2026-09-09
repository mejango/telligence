import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function keyBytes(value) {
  if (typeof value !== 'string') throw new Error('Signer encryption key is required');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('Signer encryption key must be 32 bytes encoded as canonical base64');
  }
  return key;
}

function contextBytes(context) {
  if (typeof context !== 'string' || !context.length || context.length > 200) throw new Error('Signer encryption context is required');
  return Buffer.from(`telligence:inference-signer:v1:${context}`, 'utf8');
}

/** Encryption is bound to the signer address, so a preparation can become a project binding without exposing plaintext. */
export function encryptSignerKey(privateKey, encryptionKey, context) {
  if (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Invalid signer key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(encryptionKey), iv);
  cipher.setAAD(contextBytes(context));
  const plaintext = Buffer.from(privateKey.slice(2), 'hex');
  try {
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  } finally {
    plaintext.fill(0);
  }
}

export function decryptSignerKey(payload, encryptionKey, context) {
  if (typeof payload !== 'string' || payload.length > 1024) throw new Error('Invalid signer ciphertext');
  const parsed = JSON.parse(payload);
  if (!parsed || parsed.v !== 1 || Object.keys(parsed).sort().join() !== 'ciphertext,iv,tag,v') throw new Error('Unsupported signer ciphertext');
  const decode = (value, size) => {
    if (typeof value !== 'string') throw new Error('Invalid signer ciphertext');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== size || bytes.toString('base64') !== value) throw new Error('Invalid signer ciphertext');
    return bytes;
  };
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(encryptionKey), decode(parsed.iv, 12));
  decipher.setAAD(contextBytes(context));
  decipher.setAuthTag(decode(parsed.tag, 16));
  const plaintext = Buffer.concat([decipher.update(decode(parsed.ciphertext, 32)), decipher.final()]);
  try { return `0x${plaintext.toString('hex')}`; } finally { plaintext.fill(0); }
}

export function verifyServiceCredential(authorization, configuredSecret) {
  if (typeof configuredSecret !== 'string' || configuredSecret.length < 32 || /\s/.test(configuredSecret)) {
    throw new Error('A service secret of at least 32 characters is required');
  }
  if (typeof authorization !== 'string' || authorization.length > 1024) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${configuredSecret}`));
}
