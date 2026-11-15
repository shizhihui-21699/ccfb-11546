import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import type { NameGen } from '../utils/names';
import { randInt, shuffled } from '../utils/rng';

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;

/**
 * 判断一组语句是否为"可平坦化的直线代码":
 * 表达式语句、变量声明(自动提升为 var)、最后一条 return/throw。
 * 含 if/for/try 等控制流的函数整体跳过 —— 保守策略保证语义不变。
 */
function flattenable(stmts: t.Statement[]): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const last = i === stmts.length - 1;
    if (t.isExpressionStatement(s)) continue;
    if (t.isVariableDeclaration(s)) {
      if (s.declarations.every((d) => t.isIdentifier(d.id))) continue;
      return false;
    }
    if ((t.isReturnStatement(s) || t.isThrowStatement(s)) && last) continue;
    return false;
  }
  return true;
}

function flattenBody(body: t.BlockStatement, nameGen: NameGen, rng: () => number, threshold: number): boolean {
  const stmts = body.body;
  if (stmts.length < threshold) return false;
  if (!flattenable(stmts)) return false;

  // 变量声明提升为函数顶部 var,初始化降级为赋值语句
  const hoisted: t.VariableDeclarator[] = [];
  const linear: t.Statement[] = [];
  for (const s of stmts) {
    if (t.isVariableDeclaration(s)) {
      for (const d of s.declarations) {
        hoisted.push(t.variableDeclarator(t.identifier((d.id as t.Identifier).name)));
        if (d.init) {
          linear.push(
            t.expressionStatement(
              t.assignmentExpression('=', t.identifier((d.id as t.Identifier).name), d.init),
            ),
          );
        }
      }
    } else {
      linear.push(s);
    }
  }
  const n = linear.length;
  if (n < 2) return false;

  // 每条语句分配一个随机状态值;分发数组按原执行顺序排列,case 布局打乱
  const usedKeys = new Set<number>();
  const keys = linear.map(() => {
    let k: number;
    do {
      k = randInt(rng, 1, 0xffff);
    } while (usedKeys.has(k));
    usedKeys.add(k);
    return k;
  });
  const layout = shuffled(keys.slice(), rng);

  const orderName = nameGen.next();
  const idxName = nameGen.next();

  const cases = layout.map((k) => {
    const i = keys.indexOf(k);
    const stmt = linear[i];
    const caseBody: t.Statement[] = [stmt];
    if (!t.isReturnStatement(stmt) && !t.isThrowStatement(stmt)) {
      caseBody.push(t.continueStatement());
    }
    return t.switchCase(t.numericLiteral(k), caseBody);
  });

  const dispatcher = t.whileStatement(
    t.booleanLiteral(true),
    t.blockStatement([
      t.switchStatement(
        t.memberExpression(
          t.identifier(orderName),
          t.updateExpression('++', t.identifier(idxName)),
          true,
        ),
        cases,
      ),
      t.breakStatement(),
    ]),
  );

  const newBody: t.Statement[] = [];
  if (hoisted.length > 0) newBody.push(t.variableDeclaration('var', hoisted));
  newBody.push(
    t.variableDeclaration('var', [
      t.variableDeclarator(
        t.identifier(orderName),
        t.arrayExpression(keys.map((k) => t.numericLiteral(k))),
      ),
    ]),
    t.variableDeclaration('var', [t.variableDeclarator(t.identifier(idxName), t.numericLiteral(0))]),
    dispatcher,
  );
  body.body = newBody;
  return true;
}

/**
 * 控制流平坦化:把直线型函数体改写为
 *   var _0xO = [k1,k2,k3]; var _0xI = 0;
 *   while (true) { switch (_0xO[_0xI++]) { case k2: ...; continue; ... } break; }
 * 语句的真实执行顺序只编码在分发数组里,静态阅读无法还原执行流。
 */
export function flattenControlFlow(
  ast: t.File,
  nameGen: NameGen,
  rng: () => number,
  threshold: number,
): number {
  let count = 0;
  traverse(ast, {
    Function: {
      exit(path) {
        const body = path.node.body;
        if (!t.isBlockStatement(body)) return;
        if (flattenBody(body, nameGen, rng, threshold)) count++;
      },
    },
  });
  return count;
}
