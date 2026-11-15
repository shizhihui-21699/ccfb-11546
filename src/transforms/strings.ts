import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { parse } from '@babel/parser';
import type { NameGen } from '../utils/names';

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;

/**
 * 字符串加密:
 *  1. 收集字符串字面量(跳过 import/export 来源、对象/类属性键、成员访问属性名)
 *  2. 每个字符串 UTF-8 编码后按字节 XOR,再 base64,集中放进模块顶部数组
 *  3. 原引用点替换为 `_0xdec(idx)` 调用,运行时解码(带缓存)
 *
 * XOR key 每次构建随机,产物之间不通用。
 */
export function encryptStrings(
  ast: t.File,
  nameGen: NameGen,
  rng: () => number,
  minLength: number,
): number {
  const entries: string[] = [];
  const index = new Map<string, number>();
  const decName = nameGen.next();
  const arrName = nameGen.next();

  traverse(ast, {
    StringLiteral(path) {
      const p = path.parentPath;
      const parent = path.parent as any;
      // 模块说明、导入导出来源不能动
      if (p.isImportDeclaration() || p.isExportNamedDeclaration() || p.isExportAllDeclaration()) return;
      // 非计算属性键: { "key": 1 } / obj["k"] 中的键位 —— 加密会破坏查找语义
      if ((p.isObjectProperty() || p.isClassProperty() || p.isObjectMethod() || p.isClassMethod())
        && parent.key === path.node && !parent.computed) return;
      if (p.isMemberExpression() && parent.property === path.node && !parent.computed) return;

      const v = path.node.value;
      if (v.length < minLength) return;

      let i = index.get(v);
      if (i === undefined) {
        i = entries.length;
        entries.push(v);
        index.set(v, i);
      }
      path.replaceWith(t.callExpression(t.identifier(decName), [t.numericLiteral(i)]));
      path.skip();
    },
  });

  if (entries.length === 0) return 0;

  const key = 1 + Math.floor(rng() * 254);
  const encoded = entries.map((s) => {
    const bytes = Buffer.from(s, 'utf8');
    const x = Buffer.allocUnsafe(bytes.length);
    for (let j = 0; j < bytes.length; j++) x[j] = bytes[j] ^ key;
    return x.toString('base64');
  });

  const decoderSrc = `
var ${arrName} = ${JSON.stringify(encoded)};
function ${decName}(i) {
  var c = ${decName}._c || (${decName}._c = {});
  if (c[i] !== undefined) return c[i];
  var bin = atob(${arrName}[i]);
  var bs = new Uint8Array(bin.length);
  for (var j = 0; j < bin.length; j++) bs[j] = bin.charCodeAt(j) ^ ${key};
  var r = new TextDecoder().decode(bs);
  c[i] = r;
  return r;
}`;
  const decoderAst = parse(decoderSrc);
  ast.program.body.unshift(...(decoderAst.program.body as t.Statement[]));
  return entries.length;
}
