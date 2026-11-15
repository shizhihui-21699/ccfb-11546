import * as t from '@babel/types';
import _traverse from '@babel/traverse';

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;

/** 收集模块中所有绑定名,用于给 NameGen 预留,避免重命名后撞名 */
export function collectBindingNames(ast: t.File): string[] {
  const names: string[] = [];
  traverse(ast, {
    Scopable(path) {
      names.push(...Object.keys(path.scope.bindings));
    },
  });
  return names;
}

function collectExportedNames(ast: t.File): Set<string> {
  const exported = new Set<string>();
  traverse(ast, {
    ExportNamedDeclaration(path) {
      const d = path.node.declaration;
      if (d) {
        if ((t.isFunctionDeclaration(d) || t.isClassDeclaration(d)) && d.id) exported.add(d.id.name);
        if (t.isVariableDeclaration(d)) {
          for (const decl of d.declarations) if (t.isIdentifier(decl.id)) exported.add(decl.id.name);
        }
      }
      for (const s of path.node.specifiers) if (t.isExportSpecifier(s)) exported.add(s.local.name);
    },
    ExportDefaultDeclaration(path) {
      const d = path.node.declaration;
      if ((t.isFunctionDeclaration(d) || t.isClassDeclaration(d)) && d.id) exported.add(d.id.name);
      if (t.isIdentifier(d)) exported.add(d.name);
    },
  });
  return exported;
}

/**
 * 标识符重命名:利用 babel 的 scope.rename 做作用域感知的重命名,
 * 所有引用点同步更新。跳过:导出的绑定(对外 API 必须保留)、
 * 已混淆过的 `_0x` 名字(工具自身注入的代码)。
 */
export function renameIdentifiers(ast: t.File, nextName: () => string): number {
  const exported = collectExportedNames(ast);
  let count = 0;
  traverse(ast, {
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings)) {
        if (exported.has(name)) continue;
        if (name.startsWith('_0x')) continue;
        path.scope.rename(name, nextName());
        count++;
      }
    },
  });
  return count;
}
