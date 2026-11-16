/**
 * FNV-1a (32 bit) — used both at build time (computing the expected hash) and
 * inside the injected runtime (recomputing it from Function.prototype.toString).
 * Keep the two implementations byte-for-byte equivalent in algorithm.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    // hashUTF16 code units directly; the runtime does exactly the same.
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
