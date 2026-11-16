import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ObfuscationConfig } from '../types.js';
import type { Rng } from '../util/rng.js';
import { traverse } from '../util/babel.js';

/**
 * Dead-code injection.
 *
 * Inserts statements guarded by an opaque predicate that is *provably false at
 * runtime* — (x * x + 2) % 4 never equals 0 for any integer x, since a square
 * modulo 4 is 0 or 1. The predicate references a prelude-injected numeric
 * constant, so static analyzers cannot constant-fold it without dataflow work.
 * A pool of never-called junk function declarations is added at program scope.
 */

const JUNK_NAMES = ['calculate', 'validate', 'normalize', 'evaluate', 'transform', 'compile', 'resolve'];
const JUNK_WORDS = ['buffer', 'signal', 'channel', 'profile', 'session', 'payload', 'record', 'metric'];

function junkExpression(rng: Rng): t.Statement {
  const word = rng.pick(JUNK_WORDS);
  switch (rng.int(4)) {
    case 0:
      return t.expressionStatement(
        t.callExpression(t.memberExpression(t.identifier('console'), t.identifier('debug')), [
          t.stringLiteral(`[junk] ${word} dropped`),
        ])
      );
    case 1:
      return t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(`_${word}`), t.numericLiteral(rng.int(0xffff))),
      ]);
    case 2:
      // read-only arithmetic over a writable local — never touches frozen globals
      return t.expressionStatement(
        t.binaryExpression('+',
          t.memberExpression(t.identifier('Math'), t.identifier('PI')),
          t.numericLiteral(0))
      );
    default:
      return t.ifStatement(
        t.binaryExpression('===', t.unaryExpression('typeof', t.identifier(`_${word}`)), t.stringLiteral('symbol')),
        t.blockStatement([t.expressionStatement(t.numericLiteral(rng.int(9999)))]),
        null
      );
  }
}

function junkFunction(rng: Rng, name: string): t.Statement {
  const a = t.identifier('a');
  const b = t.identifier('b');
  return t.functionDeclaration(
    t.identifier(name),
    [a, b],
    t.blockStatement([
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier('acc'), t.numericLiteral(rng.int(100))),
      ]),
      t.expressionStatement(
        t.assignmentExpression('=', t.identifier('acc'),
          t.binaryExpression('+',
            t.binaryExpression('*', a, t.numericLiteral(1 + rng.int(7))),
            t.binaryExpression('-', b, t.numericLiteral(rng.int(5)))))
      ),
      t.ifStatement(
        t.binaryExpression('>', t.identifier('acc'), t.numericLiteral(0x7fffffff)),
        t.blockStatement([
          t.returnStatement(t.binaryExpression('-', t.identifier('acc'), t.numericLiteral(rng.int(9)))),
        ]),
        null
      ),
      t.returnStatement(t.identifier('acc')),
    ])
  );
}

export interface DeadCodeStats {
  deadBlocks: number;
  junkFunctions: number;
}

export function deadCodePass(
  ast: t.Node,
  cfg: ObfuscationConfig,
  rng: Rng,
  opaqueName: string
): DeadCodeStats {
  if (!cfg.deadCode.enabled) return { deadBlocks: 0, junkFunctions: 0 };

  const stats: DeadCodeStats = { deadBlocks: 0, junkFunctions: 0 };

  // collect first, mutate after traversal to keep path indices stable
  const insertionPoints: NodePath<t.Function | t.Program>[] = [];
  const programHolder: { path: NodePath<t.Program> | null } = { path: null };

  traverse(ast, {
    Program(p) {
      programHolder.path = p;
      insertionPoints.push(p);
    },
    Function(p) {
      if (t.isBlockStatement(p.node.body)) insertionPoints.push(p);
    },
  });

  const opaque = t.identifier(opaqueName);
  // Always-false opaque predicate using 32-bit integer math:
  // (Math.imul(x, x) + 2) % 4 is never 0 because a square mod 4 is only 0 or 1.
  // Math.imul is essential — a raw `x * x` overflows double precision and breaks it.
  const square = t.callExpression(
    t.memberExpression(t.identifier('Math'), t.identifier('imul')),
    [opaque, opaque]
  );
  const predicate = t.binaryExpression(
    '===',
    t.binaryExpression('%',
      t.binaryExpression('+', square, t.numericLiteral(2)),
      t.numericLiteral(4)),
    t.numericLiteral(0)
  );

  for (const point of insertionPoints) {
    const node = point.node;
    const body: t.Statement[] = t.isProgram(node)
      ? node.body
      : (node as t.FunctionDeclaration).body!.body;
    const originals = body.slice();
    for (const stmt of originals) {
      if (!rng.chance(0.35)) continue;
      const deadIf = t.ifStatement(
        predicate,
        t.blockStatement([junkExpression(rng), junkExpression(rng)]),
        null
      );
      const idx = body.indexOf(stmt);
      body.splice(idx, 0, deadIf);
      stats.deadBlocks++;
    }
  }

  if (programHolder.path) {
    const usedNames = new Set<string>();
    const count = 2 + rng.int(3);
    for (let i = 0; i < count; i++) {
      let name = `${rng.pick(JUNK_NAMES)}_${rng.pick(JUNK_WORDS)}_${rng.int(0xffff).toString(16)}`;
      while (usedNames.has(name)) name = `${name}_${rng.int(0xff)}`;
      usedNames.add(name);
      programHolder.path.node.body.unshift(junkFunction(rng, name));
      stats.junkFunctions++;
    }
  }

  return stats;
}
