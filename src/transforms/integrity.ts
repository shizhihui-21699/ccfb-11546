import * as t from '@babel/types';
import { parse } from '@babel/parser';
import type { NameGen } from '../utils/names';
import { fnv1a } from '../utils/hash';
import type { IntegrityOptions } from '../types';

/**
 * 代码完整性自校验:
 *  1. 每个导出的函数声明被拆成 实现(_0x…) + 同名包装器,
 *     包装器在调用前检查降级标志,被篡改时 throw 或静默返回 undefined。
 *  2. 构建期对模块顶层所有函数(含解码器、垃圾函数、helper)的生成代码
 *     计算 FNV-1a 哈希并嵌入产物;运行时用 Function.prototype.toString()
 *     取回源码文本重算哈希 —— 只要文件被重新格式化或改动过一个字符,
 *     哈希即不匹配,降级标志置位,所有导出函数停止工作。
 *
 * 注意:该校验依赖源码文本,因此混淆必须放在构建链最后一步
 * (后面不能再接 terser/prettier 等会改写的工具)。
 */
export function protectIntegrity(
  ast: t.File,
  nameGen: NameGen,
  flagName: string,
  opts: IntegrityOptions,
  genCode: (node: t.Node) => string,
): number {
  const program = ast.program;

  // 收集导出的本地名(直接导出 + export 列表)
  const exportedNames = new Set<string>();
  for (const node of program.body) {
    if (t.isExportNamedDeclaration(node)) {
      const d = node.declaration;
      if (d && t.isFunctionDeclaration(d) && d.id) exportedNames.add(d.id.name);
      for (const s of node.specifiers) if (t.isExportSpecifier(s)) exportedNames.add(s.local.name);
    }
  }

  const makeWrapper = (fn: t.FunctionDeclaration): [t.FunctionDeclaration, t.FunctionDeclaration] => {
    const implName = nameGen.next();
    const impl = t.functionDeclaration(
      t.identifier(implName),
      fn.params,
      fn.body,
      fn.generator,
      fn.async,
    );
    const fail: t.Statement =
      opts.mode === 'throw'
        ? t.throwStatement(
            t.newExpression(t.identifier('Error'), [t.stringLiteral('invalid state')]),
          )
        : t.returnStatement();
    const wrapper = t.functionDeclaration(
      t.identifier(fn.id!.name),
      [],
      t.blockStatement([
        t.ifStatement(t.identifier(flagName), t.blockStatement([fail])),
        t.returnStatement(
          t.callExpression(t.memberExpression(t.identifier(implName), t.identifier('apply')), [
            t.thisExpression(),
            t.identifier('arguments'),
          ]),
        ),
      ]),
    );
    return [impl, wrapper];
  };

  // 重写导出函数为 实现 + 包装器
  const newBody: t.Statement[] = [];
  let wrapped = 0;
  for (const node of program.body) {
    if (
      t.isExportNamedDeclaration(node) &&
      t.isFunctionDeclaration(node.declaration) &&
      node.declaration.id &&
      !node.declaration.async &&
      !node.declaration.generator
    ) {
      const fn = node.declaration;
      const exportedName = fn.id!.name;
      const [impl, wrapper] = makeWrapper(fn);
      newBody.push(
        impl,
        wrapper,
        t.exportNamedDeclaration(null, [
          t.exportSpecifier(t.identifier(exportedName), t.identifier(exportedName)),
        ]),
      );
      wrapped++;
    } else if (
      t.isFunctionDeclaration(node) &&
      node.id &&
      exportedNames.has(node.id.name) &&
      !node.async &&
      !node.generator
    ) {
      const [impl, wrapper] = makeWrapper(node);
      newBody.push(impl, wrapper);
      wrapped++;
    } else {
      newBody.push(node);
    }
  }
  program.body = newBody;

  // 对当前所有顶层函数计算哈希(包装之后、校验器注入之前)
  const targets = program.body.filter((n): n is t.FunctionDeclaration => t.isFunctionDeclaration(n));
  const names = targets.map((f) => f.id!.name);
  const hash = fnv1a(targets.map((f) => genCode(f)).join(''));

  const fnvName = nameGen.next();
  const ckName = nameGen.next();
  const checkerSrc = `
function ${fnvName}(s){var h=2166136261;for(var i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),16777619)>>>0}return h}
function ${ckName}(){var s='';var f=[${names.join(',')}];for(var i=0;i<f.length;i++){s+=f[i].toString()}return ${fnvName}(s)===${hash}}`;
  const checkerAst = parse(checkerSrc);
  program.body.push(...(checkerAst.program.body as t.Statement[]));

  // 初始化检查放在模块末尾:var 声明提升但赋值不提升,必须等 flag 初始化之后执行
  const initAst = parse(`if (!${ckName}()) { ${flagName} = true; }`);
  program.body.push(...(initAst.program.body as t.Statement[]));

  return wrapped;
}
