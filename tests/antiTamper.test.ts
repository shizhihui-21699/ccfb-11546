import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from '@babel/parser';
import _generate from '@babel/generator';
import { obfuscate } from '../src/obfuscator';
import { presets } from '../src/presets';
import { QUOTE_INPUTS, RISK_INPUTS } from './suite';

const generate: typeof _generate = (_generate as any).default ?? _generate;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.obf');
const source = readFileSync(path.join(root, 'fixture/pricing.ts'), 'utf8');

function heavyCode(): string {
  return obfuscate(source, { ...presets.heavy, seed: 0xbad }).code;
}

describe('integrity self-check (heavy preset)', () => {
  it('untampered build works normally', async () => {
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, 'pricing.heavy.clean.mjs');
    writeFileSync(file, heavyCode());
    const mod = await import(pathToFileURL(file).href);
    expect(mod.decide(RISK_INPUTS[2])).toBe('block');
  });

  it('stops working after reformatting (prettier/babel-style rewrite)', async () => {
    const code = heavyCode();
    // 模拟竞品把代码丢进格式化工具:重新 parse + 非 compact 生成
    const reformatted = generate(parse(code, { sourceType: 'module' }), {
      compact: false,
      comments: true,
    }).code;
    expect(reformatted).not.toBe(code);

    const file = path.join(outDir, 'pricing.heavy.reformatted.mjs');
    writeFileSync(file, reformatted);
    const mod = await import(pathToFileURL(file).href);
    expect(() => mod.quote(QUOTE_INPUTS[0])).toThrow('invalid state');
    expect(() => mod.decide(RISK_INPUTS[0])).toThrow('invalid state');
  });

  it('stops working after a one-character edit', async () => {
    const code = heavyCode();
    // 改一个数字字面量:把风控阈值 50000 改成 50001(若存在),否则翻转一个字符
    let tampered: string;
    if (code.includes('50000')) {
      tampered = code.replace('50000', '50001');
    } else {
      const i = code.indexOf('function');
      tampered = code.slice(0, i) + ' ' + code.slice(i);
    }
    expect(tampered).not.toBe(code);

    const file = path.join(outDir, 'pricing.heavy.edited.mjs');
    writeFileSync(file, tampered);
    const mod = await import(pathToFileURL(file).href);
    expect(() => mod.quote(QUOTE_INPUTS[0])).toThrow('invalid state');
  });

  it('corrupt mode returns undefined instead of throwing', async () => {
    const code = obfuscate(source, {
      ...presets.heavy,
      seed: 0xbad,
      integrity: { enabled: true, mode: 'corrupt' },
    }).code;
    // 在第一个函数体内插入一个空格 —— 改变源码文本即触发校验
    const at = code.indexOf('{') + 1;
    const tampered = code.slice(0, at) + ' ' + code.slice(at);
    expect(tampered).not.toBe(code);
    const file = path.join(outDir, 'pricing.heavy.corrupt.mjs');
    writeFileSync(file, tampered);
    const mod = await import(pathToFileURL(file).href);
    expect(mod.quote(QUOTE_INPUTS[0])).toBeUndefined();
  });
});
