/**
 * 体积与性能损耗量化:
 *  - 对 fixture 按 light/medium/heavy 三档混淆
 *  - 报告原始/gzip 体积倍数
 *  - 同一工作负载下对比原始实现与各档产物的运行耗时
 * 运行: npm run bench
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import * as babel from '@babel/core';
import _presetTS from '@babel/preset-typescript';
import _generate from '@babel/generator';
import { obfuscate } from '../src/obfuscator';
import { presets, type PresetName } from '../src/presets';
import { QUOTE_INPUTS, RISK_INPUTS } from '../tests/inputs';

const presetTS: any = (_presetTS as any).default ?? _presetTS;
const generate: typeof _generate = (_generate as any).default ?? _generate;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.obf');
mkdirSync(outDir, { recursive: true });

const source = readFileSync(path.join(root, 'fixture/pricing.ts'), 'utf8');

// 基线:仅剥类型 + compact,不做任何保护
const stripped = babel.transformSync(source, {
  filename: 'input.ts',
  presets: [[presetTS, {}]],
  configFile: false,
  babelrc: false,
})!.code!;
const baselineCode = generate(
  (await import('@babel/parser')).parse(stripped, { sourceType: 'module' }),
  { compact: true, comments: false },
).code;
writeFileSync(path.join(outDir, 'pricing.baseline.mjs'), baselineCode);

const variants: { name: string; code: string }[] = [{ name: 'baseline', code: baselineCode }];
for (const preset of ['light', 'medium', 'heavy'] as PresetName[]) {
  const { code } = obfuscate(source, { ...presets[preset], seed: 0xc0ffee });
  writeFileSync(path.join(outDir, `pricing.${preset}.mjs`), code);
  variants.push({ name: preset, code });
}

// 加载所有变体
const loaded: { name: string; mod: any; code: string }[] = [];
for (const v of variants) {
  const file = path.join(outDir, `pricing.${v.name}.mjs`);
  loaded.push({ name: v.name, mod: await import(pathToFileURL(file).href), code: v.code });
}

// 正确性前置校验:所有变体输出必须与 baseline 完全一致
const base = loaded[0].mod;
for (const { name, mod } of loaded.slice(1)) {
  for (const q of QUOTE_INPUTS) {
    const a = JSON.stringify(mod.quote(q));
    const b = JSON.stringify(base.quote(q));
    if (a !== b) throw new Error(`[${name}] quote mismatch: ${a} != ${b}`);
  }
  for (const r of RISK_INPUTS) {
    if (mod.riskScore(r) !== base.riskScore(r) || mod.decide(r) !== base.decide(r)) {
      throw new Error(`[${name}] risk mismatch`);
    }
  }
}
console.log('correctness: all variants match baseline ✓\n');

// 性能测量
const ITER = 100_000;
const RUNS = 5;

function workload(mod: any, n: number): number {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const q = mod.quote(QUOTE_INPUTS[i % QUOTE_INPUTS.length]);
    acc += q.total;
    acc += mod.riskScore(RISK_INPUTS[i % RISK_INPUTS.length]);
    acc += mod.decide(RISK_INPUTS[i % RISK_INPUTS.length]).length;
  }
  return acc;
}

function measure(mod: any): number {
  workload(mod, 20_000); // JIT 预热
  let best = Infinity;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    workload(mod, ITER);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

const times = new Map<string, number>();
for (const { name, mod } of loaded) times.set(name, measure(mod));
const baseTime = times.get('baseline')!;

// 报告
console.log('| variant  | raw size | raw x | gzip | gzip x | time/100k ops | slowdown |');
console.log('|----------|----------|-------|------|--------|---------------|----------|');
for (const { name, code } of loaded) {
  const raw = Buffer.byteLength(code);
  const gz = gzipSync(code).length;
  const baseRaw = Buffer.byteLength(baselineCode);
  const baseGz = gzipSync(baselineCode).length;
  const t = times.get(name)!;
  console.log(
    `| ${name.padEnd(8)} | ${String(raw).padStart(8)} | ${(raw / baseRaw).toFixed(2)}x | ` +
      `${String(gz).padStart(4)} | ${(gz / baseGz).toFixed(2)}x | ${t.toFixed(1).padStart(12)}ms | ${(t / baseTime).toFixed(2)}x |`,
  );
}
