import { encryptString, b64decode, rc4Cipher, xorCipher, stringToBytes, bytesToString, shuffleAlphabet } from '../src/util/crypto.js';
import { Rng } from '../src/util/rng.js';

// mirror of the runtime decoder body
function runtimeDecode(token: string, key: number, alphabet: string, useRc4: boolean): string {
  const lookup: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet[i]!] = i;
  const clean = token.replace(/=+$/, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charAt(i)]!;
    const c1 = lookup[clean.charAt(i + 1)]!;
    const c2 = lookup[clean.charAt(i + 2)];
    const c3 = lookup[clean.charAt(i + 3)];
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 !== undefined) bytes.push(((c2! & 3) << 6) | c3);
  }
  const kb = [key >>> 24 & 255, key >>> 16 & 255, key >>> 8 & 255, key & 255];
  const out: number[] = [];
  if (useRc4) {
    const s: number[] = [];
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i]! + kb[i % 4]!) & 255;
      [s[i], s[j]] = [s[j]!, s[i]!];
    }
    let i = 0; j = 0;
    for (let k = 0; k < bytes.length; k++) {
      i = (i + 1) & 255;
      j = (j + s[i]!) & 255;
      [s[i], s[j]] = [s[j]!, s[i]!];
      out.push(bytes[k]! ^ s[(s[i]! + s[j]!) & 255]!);
    }
  } else {
    for (let k = 0; k < bytes.length; k++) out.push(bytes[k]! ^ kb[k % 4]!);
  }
  return bytesToString(out);
}

const alphabet = shuffleAlphabet(0x5eed ^ 0x5eed);
const rng = new Rng(7);
const samples = ['invalid cart item', 'CNY', 'WELCOME10', 'Q-123', 'use strict', '中文测试😀'];
let ok = true;
for (const algo of ['base64xor', 'rc4'] as const) {
  for (const s of samples) {
    const key = (rng.int(0xffffffff) || 1) >>> 0;
    const token = encryptString(s, key, algo, alphabet);
    const back = runtimeDecode(token, key, alphabet, algo === 'rc4');
    const pass = back === s;
    if (!pass) ok = false;
    console.log(`${algo} ${JSON.stringify(s)} -> ${pass ? 'OK' : `FAIL got ${JSON.stringify(back)}`}`);
  }
}
process.exit(ok ? 0 : 1);
