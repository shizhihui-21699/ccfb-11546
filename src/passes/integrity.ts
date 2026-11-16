import type { NodePath } from '@babel/traverse';
import type { GeneratorOptions } from '@babel/generator';
import * as t from '@babel/types';
import type { ObfuscationConfig, RuntimeNames } from '../types.js';
import { fnv1a32 } from '../util/hash.js';
import { traverse, generate } from '../util/babel.js';

/**
 * Integrity self-check pass (two stages).
 *
 * Stage A (before identifier renaming): every protected function is turned
 * into an IIFE wrapper around a named inner function expression. Call sites
 * keep working through the wrapper. A marked placeholder statement is inserted
 * either once at wrapper setup or inside every invocation (checkEveryCall).
 *
 * Stage B (after renaming): the final source of each inner function is
 * generated with the exact same Babel options used for the whole program,
 * FNV-1a hashed, and burned into the check. At runtime the prelude recomputes
 * the hash from Function.prototype.toString. Reformatting or any edit changes
 * the text -> hash mismatch -> guard.fail (throw or degrade).
 */

const AUTO_TARGET_HINTS = /(price|pricing|quote|fee|risk|rule|engine|calc|premium|fraud|score|valuer|discount|tax)/i;

interface MarkedCheck extends t.ExpressionStatement {
  _sentryCheck?: string;
}

interface WrappedTarget {
  name: string;
  /** direct node reference — survives the rename pass (which mutates, not replaces, it) */
  innerNode: t.FunctionExpression;
  checkNode: MarkedCheck;
  checkMark: string;
  perCall: boolean;
}

export interface IntegrityResult {
  wrapped: number;
  hashed: number;
  targets: string[];
}

function shouldAutoTarget(name: string): boolean {
  return AUTO_TARGET_HINTS.test(name);
}

function makeCheckPlaceholder(mark: string): MarkedCheck {
  const node = t.expressionStatement(t.numericLiteral(0)) as MarkedCheck;
  node._sentryCheck = mark;
  return node;
}

function buildWrapperIIFE(
  name: string,
  names: RuntimeNames,
  checkEveryCall: boolean,
  check: MarkedCheck,
  fnExpr: t.FunctionExpression
): t.CallExpression {
  const guard = t.identifier(names.guardLocal);
  const returnedClosure = t.functionExpression(
    null,
    [],
    t.blockStatement([
      ...(checkEveryCall ? [check] : []),
      t.returnStatement(t.callExpression(
        t.memberExpression(guard, t.identifier('run')),
        [
          t.stringLiteral(name),
          t.identifier('__fn'),
          t.thisExpression(),
          t.identifier('arguments'),
        ]
      )),
    ])
  );

  return t.callExpression(
    t.functionExpression(null, [t.identifier('__fn')], t.blockStatement([
      ...(checkEveryCall ? [] : [check]),
      t.returnStatement(returnedClosure),
    ])),
    [fnExpr]
  );
}

export function integrityWrapPass(
  ast: t.Node,
  cfg: ObfuscationConfig,
  names: RuntimeNames
): IntegrityResult & { wrappedTargets: WrappedTarget[] } {
  const empty = { wrapped: 0, hashed: 0, targets: [], wrappedTargets: [] as WrappedTarget[] };
  if (!cfg.integrity.enabled) return empty;

  const explicit = new Set(cfg.integrity.targets);
  const wrappedTargets: WrappedTarget[] = [];
  let markCounter = 0;
  const isWanted = (name: string) => explicit.has(name) || (explicit.size === 0 && shouldAutoTarget(name));

  // --- declarations: function f() {} ---
  traverse(ast, {
    FunctionDeclaration(path) {
      const node = path.node;
      if (!node.id || node.generator) return;
      const name = node.id.name;
      if (!isWanted(name)) return;

      const innerName = `__sentryInner_${name}`;
      const fnExpr = t.functionExpression(
        t.identifier(innerName), node.params, node.body, node.generator, node.async
      );
      const mark = `check_${markCounter++}`;
      const check = makeCheckPlaceholder(mark);
      const iife = buildWrapperIIFE(name, names, cfg.integrity.checkEveryCall, check, fnExpr);

      if (path.parentPath && path.parentPath.isExportNamedDeclaration()) {
        // preserve the `export` — wrap the const declaration inside it
        path.parentPath.replaceWith(t.exportNamedDeclaration(
          t.variableDeclaration('const', [t.variableDeclarator(t.identifier(name), iife)]),
          []
        ));
      } else {
        path.replaceWith(t.variableDeclaration('var', [
          t.variableDeclarator(t.identifier(name), iife),
        ]));
      }
      wrappedTargets.push({
        name, innerNode: fnExpr, checkNode: check, checkMark: mark,
        perCall: cfg.integrity.checkEveryCall,
      });
    },
  });

  // --- const f = function(){} / const f = () => {} ---
  traverse(ast, {
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!t.isIdentifier(id) || !init) return;
      if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;
      const name = id.name;
      if (!isWanted(name) || wrappedTargets.some((w) => w.name === name)) return;

      const innerName = `__sentryInner_${name}`;
      let fnExpr: t.FunctionExpression;
      if (t.isArrowFunctionExpression(init)) {
        const body = t.isBlockStatement(init.body)
          ? init.body
          : t.blockStatement([t.returnStatement(init.body)]);
        fnExpr = t.functionExpression(t.identifier(innerName), init.params, body, false, init.async);
      } else {
        fnExpr = t.functionExpression(
          t.identifier(innerName), init.params, init.body, init.generator, init.async
        );
      }

      const mark = `check_${markCounter++}`;
      const check = makeCheckPlaceholder(mark);
      path.node.init = buildWrapperIIFE(name, names, cfg.integrity.checkEveryCall, check, fnExpr);
      wrappedTargets.push({
        name, innerNode: fnExpr, checkNode: check, checkMark: mark,
        perCall: cfg.integrity.checkEveryCall,
      });
    },
  });

  return {
    wrapped: wrappedTargets.length,
    hashed: 0,
    targets: wrappedTargets.map((w) => w.name),
    wrappedTargets,
  };
}

/**
 * Stage B: hash final inner-function source and swap placeholder checks for
 * real guard comparisons. Must run after the rename pass, using identical
 * generator options to the final codegen.
 */
export function integrityHashPass(
  ast: t.Node,
  cfg: ObfuscationConfig,
  names: RuntimeNames,
  wrappedTargets: WrappedTarget[],
  generateOptions: GeneratorOptions
): IntegrityResult {
  if (!cfg.integrity.enabled || wrappedTargets.length === 0) {
    return { wrapped: wrappedTargets.length, hashed: 0, targets: wrappedTargets.map((w) => w.name) };
  }

  // 1. compute each hash directly from the held (renamed) inner function node
  const hashByMark = new Map<string, number>();
  for (const target of wrappedTargets) {
    const source = generate(target.innerNode, generateOptions).code;
    hashByMark.set(target.checkMark, fnv1a32(source));
  }

  // 2. replace marked placeholders with the runtime check
  let hashed = 0;
  traverse(ast, {
    ExpressionStatement(path: NodePath<t.ExpressionStatement>) {
      const marked = path.node as MarkedCheck;
      if (!marked._sentryCheck) return;
      const hash = hashByMark.get(marked._sentryCheck);
      if (hash === undefined) return;
      const guard = t.identifier(names.guardLocal);
      path.replaceWith(t.ifStatement(
        t.binaryExpression('!==',
          t.callExpression(t.memberExpression(guard, t.identifier('hash')), [
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('__fn'), t.identifier('toString')),
                t.identifier('call')
              ),
              [t.identifier('__fn')]
            ),
          ]),
          t.numericLiteral(hash)
        ),
        t.blockStatement([
          t.expressionStatement(t.callExpression(
            t.memberExpression(guard, t.identifier('fail')),
            [t.stringLiteral(cfg.integrity.onViolation)]
          )),
        ])
      ));
      hashed++;
    },
  });

  return {
    wrapped: wrappedTargets.length,
    hashed,
    targets: wrappedTargets.map((w) => w.name),
  };
}
