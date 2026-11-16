import type { NodePath, Scope, Binding } from '@babel/traverse';
import * as t from '@babel/types';
import type { ObfuscationConfig, RuntimeNames } from '../types.js';
import { NameGenerator } from '../util/names.js';
import { traverse } from '../util/babel.js';

type ScopeWithEval = Scope & { hasEval: boolean };

/**
 * Scope-safe identifier renaming.
 *
 * Uses Babel's own Scope binding table, so every reference, declaration and
 * parameter is renamed consistently with proper shadowing. Names that must
 * survive (module exports, `arguments`/`eval`, undeclared globals, injected
 * runtime helpers, anything inside an `eval`/`with` scope) are skipped.
 * Property names are never renamed — they live on objects, not in scopes.
 */

const UNTOUCHABLE = new Set([
  'arguments', 'eval', 'this', 'super', 'new', 'return',
  // well-known globals that user code may rely on implicitly
  'globalThis', 'window', 'document', 'console', 'Math', 'JSON', 'Object',
  'Array', 'String', 'Number', 'Boolean', 'Function', 'Promise', 'Date',
  'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Reflect',
  'Proxy', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity',
  'undefined', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'performance', 'require', 'module', 'exports', 'process',
  'Buffer', 'fetch',
]);

interface RenameStats {
  renamedBindings: number;
  skippedScopes: number;
}

function scopeIsDangerous(scope: Scope): boolean {
  // direct eval / with make reference resolution unknowable to Babel
  let s: Scope | null = scope;
  while (s) {
    if ((s as ScopeWithEval).hasEval || (s.block as t.Node).type === 'WithStatement') return true;
    s = s.parent;
  }
  return false;
}

function collectExportedNames(ast: t.Node): Set<string> {
  const names = new Set<string>();
  traverse(ast, {
    ExportNamedDeclaration(path) {
      for (const spec of path.node.specifiers) {
        if (t.isExportSpecifier(spec)) names.add(spec.local.name);
      }
      if (path.node.declaration) {
        const decl = path.node.declaration;
        const ids: t.Identifier[] = [];
        if (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) {
          if (decl.id) ids.push(decl.id);
        } else if (t.isVariableDeclaration(decl)) {
          for (const d of decl.declarations) {
            if (t.isIdentifier(d.id)) ids.push(d.id);
          }
        }
        ids.forEach((id) => names.add(id.name));
      }
    },
    ExportDefaultDeclaration(path) {
      if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
        names.add(path.node.declaration.id.name);
      }
    },
  });
  return names;
}

/** Expand shorthand properties so renaming the local binding stays semantics-safe. */
function expandShorthand(ast: t.Node): number {
  let count = 0;
  traverse(ast, {
    ObjectProperty(path) {
      if (path.node.shorthand && t.isIdentifier(path.node.key) && t.isIdentifier(path.node.value)) {
        path.node.shorthand = false;
        path.node.value = t.identifier(path.node.key.name);
        count++;
      }
    },
  });
  return count;
}

export function renamePass(
  ast: t.Node,
  cfg: ObfuscationConfig,
  generator: NameGenerator,
  runtimeNames: RuntimeNames,
  runtimeNodes: WeakSet<t.Node>
): RenameStats {
  if (!cfg.rename.enabled) return { renamedBindings: 0, skippedScopes: 0 };

  expandShorthand(ast);
  const exported = collectExportedNames(ast);
  const reservedHelpers = new Set<string>([
    runtimeNames.decoder,
    runtimeNames.pool,
    runtimeNames.opaque,
    runtimeNames.guardLocal,
    runtimeNames.antiDebug,
    // internal identifiers hard-coded by the transform passes themselves
    '__fn',
    '__state__',
    '__cache',
  ]);

  const insideRuntime = (path: NodePath): boolean => {
    let p: NodePath | null = path;
    while (p) {
      if (runtimeNodes.has(p.node)) return true;
      p = p.parentPath;
    }
    return false;
  };

  const stats: RenameStats = { renamedBindings: 0, skippedScopes: 0 };
  const bindingsToRename: { binding: Binding; scope: Scope }[] = [];

  traverse(ast, {
    Scope(path) {
      const scope = path.scope;
      if (scopeIsDangerous(scope)) {
        stats.skippedScopes++;
        return;
      }
      for (const [name, binding] of Object.entries(scope.bindings)) {
        if (UNTOUCHABLE.has(name)) continue;
        if (exported.has(name)) continue;
        if (reservedHelpers.has(name)) continue;
        if (NameGenerator.looksObfuscated(name)) continue;
        if (binding.kind === 'module') continue;
        // keep integrity inner-function names stable (test tooling keys off them)
        if (name.startsWith('__sentryInner_')) continue;
        // never rename bindings declared inside the injected runtime prelude
        if (insideRuntime(binding.path)) continue;

        if (!cfg.rename.renameFunctions &&
            (binding.kind === 'local' &&
              (t.isFunctionDeclaration(binding.path.node) ||
               (t.isVariableDeclarator(binding.path.node) &&
                binding.path.node.init &&
                (t.isFunctionExpression(binding.path.node.init) || t.isArrowFunctionExpression(binding.path.node.init)))))) {
          continue;
        }
        if (!cfg.rename.renameParameters && binding.kind === 'param') continue;
        bindingsToRename.push({ binding, scope });
      }
    },
  });

  for (const { binding } of bindingsToRename) {
    const fresh = generator.next();
    try {
      binding.scope.rename(binding.identifier.name, fresh);
      stats.renamedBindings++;
    } catch {
      // collision edge cases: leave the original name rather than break the build
      stats.skippedScopes++;
    }
  }

  return stats;
}
