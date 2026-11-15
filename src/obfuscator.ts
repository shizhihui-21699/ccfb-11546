import * as babel from '@babel/core';
import _presetTS from '@babel/preset-typescript';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import { mulberry32 } from './utils/rng';
import { NameGen } from './utils/names';
import { collectBindingNames, renameIdentifiers } from './transforms/rename';
import { encryptStrings } from './transforms/strings';
import { injectDeadCode } from './transforms/deadcode';
import { flattenControlFlow } from './transforms/cff';
import { injectDebugGuard } from './transforms/debugGuard';
import { protectIntegrity } from './transforms/integrity';
import type { ObfuscateResult, ObfuscateStats, ObfuscatorOptions } from './types';

const presetTS: any = (_presetTS as any).default ?? _presetTS;
const generate: typeof _generate = (_generate as any).default ?? _generate;

/**
 * 混淆管线。变换顺序有讲究:
 *   控制流平坦化 → 死代码注入 → 字符串加密 → 标识符重命名 → 调试器检测 → 完整性校验
 *  - 平坦化最先做:死代码注入的 if 分支会破坏"直线型函数体"的前提,顺序反了 CFF 会被随机击败
 *  - 死代码在字符串加密之前注入,垃圾代码里的字符串/标识符才能被一起混淆,与真实代码不可区分
 *  - 重命名放在结构变换之后,把变换引入的中间变量一起抹掉
 *  - 完整性校验必须最后做,哈希覆盖的是接近最终形态的代码
 */
export function obfuscate(source: string, options: ObfuscatorOptions): ObfuscateResult {
  const rng = mulberry32(options.seed ?? 0x9e3779b9);
  const nameGen = new NameGen();

  // 1. 剥掉 TypeScript 类型,得到纯 JS AST
  const res = babel.transformSync(source, {
    filename: 'input.ts',
    presets: [[presetTS, {}]],
    ast: true,
    code: false,
    configFile: false,
    babelrc: false,
  });
  const ast = res!.ast as unknown as t.File;

  nameGen.reserve(collectBindingNames(ast));

  const stats: ObfuscateStats = {
    renamed: 0,
    stringsEncrypted: 0,
    functionsFlattened: 0,
    junkInjected: 0,
    exportsProtected: 0,
  };

  if (options.controlFlowFlattening.enabled) {
    stats.functionsFlattened = flattenControlFlow(
      ast,
      nameGen,
      rng,
      options.controlFlowFlattening.threshold,
    );
  }
  if (options.deadCode.enabled) {
    stats.junkInjected += injectDeadCode(ast, nameGen, rng, options.deadCode);
  }
  if (options.stringEncryption.enabled) {
    stats.stringsEncrypted = encryptStrings(ast, nameGen, rng, options.stringEncryption.minLength);
  }
  if (options.rename) {
    stats.renamed = renameIdentifiers(ast, () => nameGen.next());
  }

  // 降级标志:完整性校验与调试器检测共享
  if (options.integrity.enabled || options.debugGuard.enabled) {
    const flagName = nameGen.next();
    ast.program.body.unshift(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(flagName), t.booleanLiteral(false)),
      ]),
    );
    if (options.debugGuard.enabled) {
      injectDebugGuard(ast, nameGen, flagName, options.debugGuard);
    }
    if (options.integrity.enabled) {
      stats.exportsProtected = protectIntegrity(ast, nameGen, flagName, options.integrity, (n) =>
        generate(n, { compact: options.compact, comments: false }).code,
      );
    }
  }

  const out = generate(ast, { compact: options.compact, comments: false });
  return { code: out.code, stats };
}
