import { parse } from '@babel/parser';
import { transformSync } from '@babel/core';
import presetTypeScript from '@babel/preset-typescript';
import type { GeneratorOptions } from '@babel/generator';
import * as t from '@babel/types';
import type { ObfuscationConfig, RuntimeNames } from './types.js';
import { Rng } from './util/rng.js';
import { NameGenerator } from './util/names.js';
import { flattenPass } from './passes/flatten.js';
import { deadCodePass } from './passes/dead-code.js';
import { stringEncryptionPass } from './passes/strings.js';
import { renamePass } from './passes/rename.js';
import { integrityWrapPass, integrityHashPass } from './passes/integrity.js';
import { buildPrelude, buildOpaqueConstant } from './runtime/prelude.js';
import { generate } from './util/babel.js';

/** Generator options shared by final codegen AND hash codegen — hashes only match when identical. */
export const CODEGEN_OPTIONS: GeneratorOptions = {
  compact: true,
  comments: false,
  jsescOption: { minimal: true },
  retainLines: false,
};

export interface ObfuscateResult {
  code: string;
  stats: {
    preset: string;
    seed: number;
    flattenedFunctions: number;
    deadBlocks: number;
    junkFunctions: number;
    encryptedStrings: number;
    renamedBindings: number;
    skippedScopes: number;
    integrityWrapped: string[];
    integrityHashed: number;
    preludeStatements: number;
  };
}

export interface ObfuscateOptions {
  filename?: string;
  /** treat input as TypeScript (Babel strips types; output is JS) */
  typescript?: boolean;
}

function makeRuntimeNames(rng: Rng): RuntimeNames {
  const gen = new NameGenerator(rng);
  return {
    decoder: gen.helper('__sd'),
    pool: gen.helper('__sp'),
    opaque: gen.helper('__op'),
    guardGlobal: `__SENTRY_GUARD_${rng.int(0xffff).toString(16)}__`,
    guardLocal: gen.helper('__sg'),
    antiDebug: gen.helper('__ad'),
  };
}

export function obfuscate(source: string, cfg: ObfuscationConfig, options: ObfuscateOptions = {}): ObfuscateResult {
  const rng = new Rng(cfg.seed);

  // TypeScript input: strip type annotations to plain JS first, so every later
  // pass operates on a standard ECMAScript AST. Parsing with the TS plugin only
  // accepts the syntax; the transform is what actually removes the types.
  let jsSource = source;
  if (options.typescript) {
    const stripped = transformSync(source, {
      filename: options.filename,
      sourceType: 'module',
      babelrc: false,
      configFile: false,
      presets: [[presetTypeScript, { allowDeclareFields: true, onlyRemoveTypeImports: true }]],
      sourceMaps: false,
      comments: true,
    });
    if (!stripped?.code) throw new Error('TypeScript stripping produced no output');
    jsSource = stripped.code;
  }

  const ast = parse(jsSource, {
    sourceType: 'module',
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    errorRecovery: false,
    plugins: options.typescript ? ['typescript'] : [],
  });

  const names = makeRuntimeNames(rng);
  const reserved = [names.decoder, names.pool, names.opaque, names.guardLocal, names.antiDebug];
  const nameGenerator = new NameGenerator(rng, reserved);
  const runtimeNodes = new WeakSet<t.Node>();

  // Stage 1 — structural transforms on original, readable identifiers
  const flattenStats = flattenPass(ast, cfg, rng);

  // Stage 2 — integrity wrapping BEFORE dead code, so injected junk functions
  // (whose names may collide with target hints) are never selected or wrapped.
  const wrapResult = integrityWrapPass(ast, cfg, names);

  // opaque constant used by dead-code predicates
  if (cfg.deadCode.enabled) {
    const opaqueStmt = buildOpaqueConstant(names, 1 + rng.int(0x7fffffff));
    ast.program.body.unshift(opaqueStmt);
    runtimeNodes.add(opaqueStmt);
  }
  const deadStats = deadCodePass(ast, cfg, rng, names.opaque);

  // Stage 3 — string encryption (prelude decoder injected afterwards)
  const stringResult = stringEncryptionPass(ast, cfg, rng, names.decoder, runtimeNodes, cfg.seed);

  // Stage 4 — runtime prelude at the very top
  const prelude = buildPrelude(names, cfg, stringResult.pool, stringResult.alphabet, stringResult.rotation);
  for (const stmt of prelude) runtimeNodes.add(stmt);
  ast.program.body.unshift(...prelude);

  // Stage 5 — scope-safe renaming of user bindings (runtime prelude excluded)
  const renameStats = renamePass(ast, cfg, nameGenerator, names, runtimeNodes);

  // Stage 6 — burn integrity hashes over the final inner-function source
  const hashResult = integrityHashPass(ast, cfg, names, wrapResult.wrappedTargets, CODEGEN_OPTIONS);

  const output = generate(ast, CODEGEN_OPTIONS).code;

  return {
    code: output,
    stats: {
      preset: cfg.preset,
      seed: cfg.seed,
      flattenedFunctions: flattenStats.flattened,
      deadBlocks: deadStats.deadBlocks,
      junkFunctions: deadStats.junkFunctions,
      encryptedStrings: stringResult.encryptedCount,
      renamedBindings: renameStats.renamedBindings,
      skippedScopes: renameStats.skippedScopes,
      integrityWrapped: hashResult.targets,
      integrityHashed: hashResult.hashed,
      preludeStatements: prelude.length,
    },
  };
}
