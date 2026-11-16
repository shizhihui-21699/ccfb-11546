/**
 * Central CJS/ESM interop shim for Babel packages.
 *
 * Depending on the loader (plain Node ESM, tsx, bundled CJS) these packages
 * expose their callable as the namespace itself, `ns.default`, or even
 * `ns.default.default` because the CJS module gets wrapped more than once.
 * `unwrapCallable` follows the `.default` chain to the first function, so
 * every consumer gets one stable callable while type imports stay untouched.
 */
import * as _traverse from '@babel/traverse';
import * as _generate from '@babel/generator';
import * as _template from '@babel/template';
import type { TraverseOptions, Node } from '@babel/traverse';
import type { GeneratorOptions } from '@babel/generator';

type TraverseFn = (parent: Node | { readonly type?: string }, opts: TraverseOptions) => void;
type GenerateFn = (node: Node, opts?: GeneratorOptions) => { code: string; map?: unknown };
type TemplateFn = {
  (code: string, opts?: Record<string, unknown>): (...args: unknown[]) => unknown;
  ast: (code: string, opts?: Record<string, unknown>) => unknown;
};

function unwrapCallable<T>(ns: unknown): T {
  let cur: unknown = ns;
  const seen = new Set<unknown>();
  while (cur !== undefined && cur !== null && !seen.has(cur)) {
    if (typeof cur === 'function') return cur as T;
    seen.add(cur);
    cur = (cur as Record<string, unknown>).default;
  }
  throw new Error('babel interop: callable export not found');
}

export const traverse: TraverseFn = unwrapCallable<TraverseFn>(_traverse);
export const generate: GenerateFn = unwrapCallable<GenerateFn>(_generate);
export const template: TemplateFn = unwrapCallable<TemplateFn>(_template);
