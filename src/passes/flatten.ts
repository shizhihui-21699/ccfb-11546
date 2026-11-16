import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ObfuscationConfig } from '../types.js';
import type { Rng } from '../util/rng.js';
import { traverse } from '../util/babel.js';

/**
 * Control-flow flattening.
 *
 * Eligible function bodies are rewritten into a `while (true) { switch (state) {} }`
 * dispatcher. Each TOP-LEVEL statement becomes a case. Control statements keep
 * their inner structure intact inside their case (nested if/loop bodies are
 * never split), so semantics are preserved while the top-level linear flow is
 * fully dispatched through opaque state numbers. Top-level if/return/throw
 * drive the dispatcher; straight-line statements chain via state assignment.
 *
 * Functions containing patterns unsafe to flatten (top-level break/continue /
 * labels / try / with, class or inner function declarations, generators,
 * direct eval) are skipped rather than risk a semantic change.
 */

interface CaseBuild {
  state: number;
  statements: t.Statement[];
  terminator: t.Statement;
}

function hasDirectEvalOrWith(path: NodePath<t.Function>): boolean {
  let unsafe = false;
  path.traverse({
    WithStatement() {
      unsafe = true;
    },
    Identifier(p) {
      if (p.node.name === 'eval' && p.isReferencedIdentifier()) unsafe = true;
    },
  });
  return unsafe;
}

/** Top-level statements that prevent safe flattening of this body. */
function isUnsafeBodyStatement(stmt: t.Statement): boolean {
  if (t.isBreakStatement(stmt) && !stmt.label) return true;
  if (t.isContinueStatement(stmt) && !stmt.label) return true;
  if (t.isLabeledStatement(stmt) || t.isTryStatement(stmt) || t.isWithStatement(stmt)) return true;
  if (t.isClassDeclaration(stmt)) return true;
  // a hoisted inner function declaration would escape the switch block scope
  if (t.isFunctionDeclaration(stmt)) return true;
  return false;
}

type Transition = t.Statement;

function transitionTo(state: number): Transition {
  return t.expressionStatement(
    t.assignmentExpression('=', t.identifier('__state__'), t.numericLiteral(state))
  );
}

/** Branch exit: assign the next state then continue the dispatcher; null at end. */
function fallThroughContinue(next: number | null): t.Statement | null {
  if (next === null) return t.breakStatement();
  return t.blockStatement([transitionTo(next), t.continueStatement()]);
}

/** Wrap an if/loop branch block so it ends with the given dispatcher transition. */
function blockWithExit(block: t.Statement | null | undefined, exit: Transition | null): t.BlockStatement {
  const inner: t.Statement[] = [];
  if (block) {
    if (t.isBlockStatement(block)) inner.push(...block.body);
    else inner.push(block);
  }
  if (exit) inner.push(exit);
  return t.blockStatement(inner);
}

function flattenBody(func: t.Function, rng: Rng, junkCases: boolean, hoistPath: NodePath<t.Function>): t.BlockStatement {
  const body = func.body as t.BlockStatement;
  if (!t.isBlockStatement(body) || body.body.length === 0) return body;

  // Hoist every let/const to var. The dispatcher shuffles statement order and
  // shares one block scope across cases, so block-scoped TDZ would make a
  // perfectly valid original program throw. var hoisting matches the intended
  // linear semantics once each statement runs in its original dispatch order.
  hoistPath.traverse({
    VariableDeclaration(path) {
      if (path.node.kind === 'let' || path.node.kind === 'const') {
        path.node.kind = 'var';
      }
    },
  });

  const statements = body.body;

  if (statements.some(isUnsafeBodyStatement)) return body;

  // assign each top-level statement a shuffled state number
  const stateOf = new Map<t.Statement, number>();
  const used = new Set<number>();
  const freshState = () => {
    let s = rng.int(0x7fffffff);
    while (used.has(s)) s = rng.int(0x7fffffff);
    used.add(s);
    return s;
  };
  for (const stmt of statements) stateOf.set(stmt, freshState());

  const stateOfNext = (idx: number): number | null =>
    idx + 1 < statements.length ? stateOf.get(statements[idx + 1]!)! : null;

  const cases: CaseBuild[] = [];
  statements.forEach((stmt, idx) => {
    const next = stateOfNext(idx);
    const state = stateOf.get(stmt)!;
    // a state transition must re-enter the dispatcher via `continue`, while a
    // real function exit (return/throw, or falling off the last statement)
    // uses `break` to leave the switch and then the trailing break exits while.
    const dispatchNext: Transition = next === null ? t.breakStatement() : transitionTo(next);

    let caseStatements: t.Statement[];
    let terminator: t.Statement;

    if (t.isIfStatement(stmt)) {
      // Keep the nested structure; each non-abrupt branch sets the next state
      // and continues the dispatcher loop.
      const conExit = endsWithAbrupt(stmt.consequent) ? null : fallThroughContinue(next);
      const altExit = stmt.alternate && endsWithAbrupt(stmt.alternate) ? null : fallThroughContinue(next);
      const ifNode = t.ifStatement(
        stmt.test,
        blockWithExit(stmt.consequent, conExit),
        stmt.alternate
          ? blockWithExit(stmt.alternate, altExit)
          : blockWithExit(null, fallThroughContinue(next))
      );
      caseStatements = [ifNode];
      // if every branch exits abruptly there is nothing to do; otherwise continue
      terminator = t.continueStatement();
    } else if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) {
      caseStatements = [stmt];
      terminator = t.breakStatement();
    } else {
      // loops, switches, declarations, expression statements keep their node;
      // then dispatch the next state (or break when this was the last one).
      caseStatements = [stmt, dispatchNext];
      terminator = next === null ? t.breakStatement() : t.continueStatement();
    }

    cases.push({ state, statements: caseStatements, terminator });
  });

  const switchCases = rng.shuffle(cases.slice()).map((c) =>
    t.switchCase(t.numericLiteral(c.state), [...c.statements, c.terminator])
  );

  if (junkCases) {
    // unreachable states whose only job is to look like real control flow
    for (let i = 0; i < 1 + rng.int(3); i++) {
      switchCases.push(t.switchCase(t.numericLiteral(freshState()), [
        transitionTo(rng.pick(cases).state),
        t.continueStatement(),
      ]));
    }
  }

  const dispatcher = t.whileStatement(
    t.booleanLiteral(true),
    t.blockStatement([
      t.switchStatement(t.identifier('__state__'), switchCases),
      t.breakStatement(),
    ])
  );

  const initState = stateOf.get(statements[0]!)!;
  return t.blockStatement([
    t.variableDeclaration('var', [t.variableDeclarator(t.identifier('__state__'), t.numericLiteral(initState))]),
    dispatcher,
  ]);
}

/** Whether a branch block always exits via return/throw on every path. */
function endsWithAbrupt(stmt: t.Statement | null | undefined): boolean {
  if (!stmt) return false;
  if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) return true;
  if (t.isBlockStatement(stmt)) {
    const last = stmt.body[stmt.body.length - 1];
    return !!last && endsWithAbrupt(last);
  }
  if (t.isIfStatement(stmt) && stmt.alternate) {
    return endsWithAbrupt(stmt.consequent) && endsWithAbrupt(stmt.alternate);
  }
  return false;
}

export function flattenPass(ast: t.Node, cfg: ObfuscationConfig, rng: Rng): { flattened: number } {
  if (!cfg.flatten.enabled) return { flattened: 0 };
  let flattened = 0;
  const ratio = Math.max(0, Math.min(1, cfg.flatten.ratio));

  traverse(ast, {
    Function(path: NodePath<t.Function>) {
      if (path.node.generator) return;
      if (hasDirectEvalOrWith(path)) return;
      // don't flatten tiny accessors or single-expression bodies
      if (!t.isBlockStatement(path.node.body) || path.node.body.body.length < 3) return;
      if (rng.chance(1 - ratio)) return;
      const rebuilt = flattenBody(path.node, rng, cfg.flatten.junkCases, path);
      if (rebuilt !== path.node.body) {
        path.node.body = rebuilt;
        flattened++;
      }
    },
  });
  return { flattened };
}
