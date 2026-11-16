/**
 * Build-side crypto used by the string-encryption pass. The injected runtime
 * (src/runtime/decoder.ts) implements the inverse operations with the same
 * byte layout: each UTF-16 code unit is split into two big-endian bytes, the
 * byte stream is ciphered, then base64-encoded with a (possibly shuffled)
 * alphabet. Operating on code units keeps surrogate pairs round-tripping.
 */

const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function shuffleAlphabet(seed: number): string {
  // simple deterministic LCG so the runtime template can receive the exact
  // shuffled alphabet without importing the full Rng into generated code.
  let s = seed >>> 0;
  const chars = STANDARD_ALPHABET.split('');
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export function stringToBytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    bytes.push((code >>> 8) & 0xff, code & 0xff);
  }
  return bytes;
}

export function bytesToString(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    out += String.fromCharCode(((bytes[i]! << 8) | bytes[i + 1]!) & 0xffff);
  }
  return out;
}

function keyBytes(key: number): number[] {
  // expand a 32-bit integer key into 4 cyclic key bytes (never all zero)
  const k = (key >>> 0) || 0x9e3779b9;
  return [(k >>> 24) & 0xff, (k >>> 16) & 0xff, (k >>> 8) & 0xff, k & 0xff];
}

export function xorCipher(bytes: readonly number[], key: number): number[] {
  const kb = keyBytes(key);
  return bytes.map((b, i) => b ^ kb[i % kb.length]!);
}

/** RC4 (KSA + PRGA) over the byte stream. */
export function rc4Cipher(bytes: readonly number[], key: number): number[] {
  const kb = keyBytes(key);
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + kb[i % kb.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out: number[] = [];
  let i = 0;
  j = 0;
  for (const byte of bytes) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out.push(byte ^ s[(s[i]! + s[j]!) & 0xff]!);
  }
  return out;
}

export function b64encode(bytes: readonly number[], alphabet: string): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 0x3f];
  }
  return out;
}

export function b64decode(token: string, alphabet: string): number[] {
  const lookup = new Map<string, number>();
  for (let i = 0; i < alphabet.length; i++) lookup.set(alphabet[i]!, i);
  const clean = token.replace(/=+$/, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup.get(clean[i]!);
    const c1 = lookup.get(clean[i + 1]!);
    const c2 = lookup.get(clean[i + 2]!);
    const c3 = lookup.get(clean[i + 3]!);
    if (c0 === undefined || c1 === undefined) throw new Error('bad token');
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (c3 !== undefined) bytes.push(((c2! & 0x03) << 6) | c3);
  }
  return bytes;
}

export function encryptString(value: string, key: number, algorithm: 'base64xor' | 'rc4', alphabet: string): string {
  const bytes = stringToBytes(value);
  const ciphered = algorithm === 'rc4' ? rc4Cipher(bytes, key) : xorCipher(bytes, key);
  return b64encode(ciphered, alphabet);
}
