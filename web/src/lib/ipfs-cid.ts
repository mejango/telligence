// Keep these boundaries aligned with juicebox-money. CIDv0 is base58btc and
// CIDv1 is the lowercase base32 form emitted by our pinning providers.
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/u;
const CID_V1 = /^b[a-z2-7]{20,120}$/u;

export function isIpfsCid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    if (CID_V0.test(value)) return isCidV0Bytes(decodeBase58(value));
    if (CID_V1.test(value)) return isCidV1Bytes(decodeBase32(value.slice(1)));
    return false;
  } catch {
    return false;
  }
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function decodeBase58(value: string): Uint8Array {
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) throw new Error("Invalid base58 character");
    for (let index = 0; index < bytes.length; index += 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; value[index] === "1" && index < value.length - 1; index += 1) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function decodeBase32(value: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("Invalid base32 character");
    buffer = buffer * 32 + digit;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) throw new Error("Non-canonical base32 padding");
  if (value.length !== Math.ceil((bytes.length * 8) / 5)) {
    throw new Error("Non-canonical base32 length");
  }
  return Uint8Array.from(bytes);
}

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let multiplier = 1;
  for (let index = start; index < bytes.length && index - start < 8; index += 1) {
    const byte = bytes[index];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) return null;
    if ((byte & 0x80) === 0) {
      if (index > start && byte === 0) return null;
      return { value, next: index + 1 };
    }
    multiplier *= 128;
  }
  return null;
}

function isCidV0Bytes(bytes: Uint8Array): boolean {
  // CIDv0 is exactly a base58btc-encoded sha2-256 multihash.
  return bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20;
}

function isCidV1Bytes(bytes: Uint8Array): boolean {
  const version = readVarint(bytes, 0);
  if (!version || version.value !== 1) return false;
  const codec = readVarint(bytes, version.next);
  if (!codec || codec.value <= 0) return false;
  const hash = readVarint(bytes, codec.next);
  if (!hash || hash.value <= 0) return false;
  const digestLength = readVarint(bytes, hash.next);
  if (!digestLength || digestLength.value <= 0 || digestLength.value > 128) return false;
  return digestLength.next + digestLength.value === bytes.length;
}

export function isIpfsUri(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("ipfs://") &&
    isIpfsCid(value.slice("ipfs://".length))
  );
}
