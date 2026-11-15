/**
 * FNV-1a 32 位哈希。构建期与运行期使用完全相同的算法,
 * 运行期实现见 transforms/integrity.ts 中注入的代码,两者必须保持逐位一致。
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5; // 2166136261
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0; // 16777619
  }
  return h >>> 0;
}
