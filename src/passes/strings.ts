import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ObfuscationConfig } from '../types.js';
import { Rng } from '../util/rng.js';
import { traverse } from '../util/babel.js';
import { encryptString, shuffleAlphabet } from '../util/crypto.js';

/**
 * String-encryption pass.
 *
 * Eligible string literals are replaced with calls to the pooled decoder
 * injected in the runtime prelude. Only *value* strings are touched — property
 * keys, directives (e.g. "use strict"), import/export specifiers and JSX
 * attributes are left alone so object shapes and module semantics are intact.
 * Nodes belonging to the runtime prelude are skipped via a WeakSet.
 */

export interface StringEncryptionResult {
  encryptedCount: number;
  pool: string[];
  alphabet: string;
  rotation: number;
}

function isEligibleLiteral(path: NodePath<t.StringLiteral>): boolean {
  const parent = path.parent;
  if (!parent) return false;
  // directive prologue: "use strict" etc.
  if ((parent as t.Directive).type === 'Directive') return false;
  if (t.isDirectiveLiteral(parent)) return false;
  // object/property/member keys must keep their shape unless computed
  if (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed) return false;
  if (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed) return false;
  if (t.isMemberExpression(parent) && parent.property === path.node && !parent.computed) return false;
  if (t.isOptionalMemberExpression(parent) && parent.property === path.node && !parent.computed) return false;
  // module / JSX / class metadata
  if (t.isImportDeclaration(parent) || t.isExportNamedDeclaration(parent) ||
      t.isExportAllDeclaration(parent) || t.isImportAttribute(parent)) return false;
  if (t.isJSXAttribute(parent) || t.isJSXElement(parent)) return false;
  if (t.isClassProperty(parent) || t.isClassMethod(parent) || t.isClassPrivateProperty(parent)) return false;
  if (t.isTaggedTemplateExpression(parent)) return false;
  if (path.node.value.length === 0) return false;
  return true;
}

export function stringEncryptionPass(
  ast: t.Node,
  cfg: ObfuscationConfig,
  rng: Rng,
  decoderName: string,
  runtimeNodes: WeakSet<t.Node>,
  seed: number
): StringEncryptionResult {
  const empty: StringEncryptionResult = { encryptedCount: 0, pool: [], alphabet: '', rotation: 0 };
  if (!cfg.stringEncryption.enabled) return empty;

  const alphabet = shuffleAlphabet(seed ^ 0x5eed);
  const targets: NodePath<t.StringLiteral>[] = [];

  traverse(ast, {
    StringLiteral: {
      enter(path) {
        if (runtimeNodes.has(path.node)) return;
        let p: NodePath | null = path;
        while (p) {
          if (runtimeNodes.has(p.node)) return;
          p = p.parentPath;
        }
        if (isEligibleLiteral(path)) targets.push(path);
      },
    },
  });

  if (targets.length === 0) return empty;

  // pool maps each distinct string to an index; per-string RC4/XOR keys keep
  // identical plaintexts looking different when keys differ.
  const indexOf = new Map<string, number>();
  const plainPool: string[] = [];
  const keys: number[] = [];

  for (const path of targets) {
    const value = path.node.value;
    let idx = indexOf.get(value);
    if (idx === undefined) {
      idx = plainPool.length;
      indexOf.set(value, idx);
      plainPool.push(value);
      keys.push((rng.int(0xffffffff) || 1) >>> 0);
    }
  }

  // Build the emitted pool in shuffled (but NOT pre-rotated) layout, then
  // compensate call-site indices for the runtime's left rotation. The runtime
  // does `push(shift())` R times: emitted element at i ends at (i - R) mod n,
  // so runtime read of burned index b resolves to emitted[(b + R) mod n].
  // Therefore burn b = (emittedIndex - R) mod n to reach the wanted element.
  const order = plainPool.map((_, i) => i);
  rng.shuffle(order);
  const rotation = cfg.stringEncryption.rotatePool ? rng.int(plainPool.length) : 0;
  const n = plainPool.length;
  const pool: string[] = new Array(n);
  const poolKeys: number[] = new Array(n);
  // emitted index of each plaintext string
  const emittedIndexOf = new Map<string, number>();

  order.forEach((oldIdx, emittedIdx) => {
    pool[emittedIdx] = encryptString(
      plainPool[oldIdx]!,
      keys[oldIdx]!,
      cfg.stringEncryption.algorithm,
      alphabet
    );
    poolKeys[emittedIdx] = keys[oldIdx]!;
    emittedIndexOf.set(plainPool[oldIdx]!, emittedIdx);
  });

  let encryptedCount = 0;
  for (const path of targets) {
    const emittedIdx = emittedIndexOf.get(path.node.value)!;
    // adjust for the runtime left rotation so the right token is selected
    const burnedIdx = (((emittedIdx - rotation) % n) + n) % n;
    const key = poolKeys[emittedIdx]!;
    path.replaceWith(t.callExpression(t.identifier(decoderName), [
      t.numericLiteral(burnedIdx),
      t.numericLiteral(key),
    ]));
    encryptedCount++;
  }

  return { encryptedCount, pool, alphabet, rotation };
}
