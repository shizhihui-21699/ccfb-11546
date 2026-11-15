import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import type { NameGen } from '../utils/names';
import { randInt } from '../utils/rng';
import type { DeadCodeOptions } from '../types';

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;

const JUNK_CHARS = 'abcdefghijklmnopqrstuvwxyz';

function randomString(rng: () => number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += JUNK_CHARS[randInt(rng, 0, JUNK_CHARS.length)];
  return s;
}

/** 恒为假但静态分析难以证明的谓词 */
function opaqueFalse(rng: () => number): t.Expression {
  const s = randomString(rng, randInt(rng, 3, 8));
  const variant = randInt(rng, 0, 3);
  if (variant === 0) {
    // "abc".length === 4
    return t.binaryExpression(
      '===',
      t.memberExpression(t.stringLiteral(s), t.identifier('length')),
      t.numericLiteral(s.length + 1),
    );
  }
  if (variant === 1) {
    // void 0 > 0  →  undefined > 0 → false
    return t.binaryExpression('>', t.unaryExpression('void', t.numericLiteral(0)), t.numericLiteral(0));
  }
  // "abc".length - 3 === 1
  return t.binaryExpression(
    '===',
    t.binaryExpression(
      '-',
      t.memberExpression(t.stringLiteral(s), t.identifier('length')),
      t.numericLiteral(s.length),
    ),
    t.numericLiteral(1),
  );
}

function junkStatements(nameGen: NameGen, rng: () => number): t.Statement[] {
  const v1 = nameGen.next();
  const v2 = nameGen.next();
  const s = randomString(rng, randInt(rng, 4, 10));
  return [
    t.variableDeclaration('var', [
      t.variableDeclarator(
        t.identifier(v1),
        t.callExpression(
          t.memberExpression(
            t.callExpression(
              t.memberExpression(t.stringLiteral(s), t.identifier('split')),
              [t.stringLiteral('')],
            ),
            t.identifier('reverse'),
          ),
          [],
        ),
      ),
    ]),
    t.variableDeclaration('var', [
      t.variableDeclarator(
        t.identifier(v2),
        t.binaryExpression(
          '%',
          t.binaryExpression(
            '*',
            t.memberExpression(t.identifier(v1), t.identifier('length')),
            t.numericLiteral(randInt(rng, 2, 9)),
          ),
          t.numericLiteral(randInt(rng, 2, 5)),
        ),
      ),
    ]),
  ];
}

function junkFunction(nameGen: NameGen, rng: () => number): t.FunctionDeclaration {
  const fn = nameGen.next();
  const arr = nameGen.next();
  const acc = nameGen.next();
  const i = nameGen.next();
  const nums = Array.from({ length: randInt(rng, 3, 6) }, () => randInt(rng, 1, 50));
  return t.functionDeclaration(
    t.identifier(fn),
    [],
    t.blockStatement([
      t.variableDeclaration('var', [
        t.variableDeclarator(
          t.identifier(arr),
          t.arrayExpression(nums.map((n) => t.numericLiteral(n))),
        ),
      ]),
      t.variableDeclaration('var', [t.variableDeclarator(t.identifier(acc), t.numericLiteral(0))]),
      t.forStatement(
        t.variableDeclaration('var', [t.variableDeclarator(t.identifier(i), t.numericLiteral(0))]),
        t.binaryExpression(
          '<',
          t.identifier(i),
          t.memberExpression(t.identifier(arr), t.identifier('length')),
        ),
        t.updateExpression('++', t.identifier(i)),
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.identifier(acc),
              t.binaryExpression(
                '%',
                t.binaryExpression(
                  '+',
                  t.identifier(acc),
                  t.binaryExpression(
                    '*',
                    t.memberExpression(t.identifier(arr), t.identifier(i), true),
                    t.identifier(i),
                  ),
                ),
                t.numericLiteral(97),
              ),
            ),
          ),
        ]),
      ),
      t.returnStatement(t.identifier(acc)),
    ]),
  );
}

/**
 * 死代码注入:
 *  - 在函数体内随机位置插入 `if (恒假谓词) { 垃圾语句 }` 死分支
 *  - 在模块顶层注入永不被调用的垃圾函数
 * 死代码里的标识符和字符串随后会照常参与重命名/加密,与真实代码无法区分。
 */
export function injectDeadCode(
  ast: t.File,
  nameGen: NameGen,
  rng: () => number,
  opts: DeadCodeOptions,
): number {
  let count = 0;

  traverse(ast, {
    Function: {
      exit(path) {
        const body = path.node.body;
        if (!t.isBlockStatement(body)) return;
        const stmts = body.body;
        if (stmts.length < 2) return;
        if (rng() > opts.perFunctionProbability) return;
        const insertAt = randInt(rng, 0, stmts.length);
        stmts.splice(
          insertAt,
          0,
          t.ifStatement(opaqueFalse(rng), t.blockStatement(junkStatements(nameGen, rng))),
        );
        count++;
      },
    },
  });

  for (let i = 0; i < opts.junkFunctions; i++) {
    ast.program.body.push(junkFunction(nameGen, rng));
    count++;
  }
  return count;
}
