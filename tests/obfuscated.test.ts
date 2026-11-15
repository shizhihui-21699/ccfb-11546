import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate } from '../src/obfuscator';
import { presets, type PresetName } from '../src/presets';
import * as baseline from '../fixture/pricing';
import { expectSameBehavior, type PricingModule } from './suite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.obf');
const source = readFileSync(path.join(root, 'fixture/pricing.ts'), 'utf8');

const PRESETS: PresetName[] = ['light', 'medium', 'heavy'];
const modules = new Map<string, PricingModule>();
const outputs = new Map<string, string>();

beforeAll(async () => {
  mkdirSync(outDir, { recursive: true });
  for (const preset of PRESETS) {
    const { code } = obfuscate(source, { ...presets[preset], seed: 0xc0ffee });
    outputs.set(preset, code);
    const file = path.join(outDir, `pricing.${preset}.mjs`);
    writeFileSync(file, code);
    modules.set(preset, await import(pathToFileURL(file).href));
  }
}, 60_000);

describe.each(PRESETS)('obfuscated [%s] behaves identically to original', (preset) => {
  it('passes the full pricing & risk suite', () => {
    expectSameBehavior(modules.get(preset)!, baseline as unknown as PricingModule);
  });
});

describe('obfuscation actually happened', () => {
  it('exports are preserved', () => {
    for (const preset of PRESETS) {
      const mod = modules.get(preset)!;
      expect(typeof mod.quote).toBe('function');
      expect(typeof mod.riskScore).toBe('function');
      expect(typeof mod.decide).toBe('function');
    }
  });

  it('internal identifiers are renamed', () => {
    for (const preset of PRESETS) {
      const code = outputs.get(preset)!;
      expect(code).not.toContain('tierRate');
      expect(code).not.toContain('BLOCKED_COUNTRIES');
      expect(code).not.toContain('validateQuoteInput');
    }
  });

  it('string literals are encrypted', () => {
    for (const preset of PRESETS) {
      const code = outputs.get(preset)!;
      expect(code).not.toContain('quantity must be positive');
      expect(code).not.toContain('unitPrice must be non-negative');
    }
  });

  it('medium+ injects dead code and debug guard', () => {
    expect(outputs.get('medium')!).toContain('debugger');
    expect(outputs.get('heavy')!).toContain('debugger');
    expect(outputs.get('light')!).not.toContain('debugger');
  });

  it('heavy applies control-flow flattening', () => {
    const heavy = outputs.get('heavy')!;
    expect(heavy).toContain('switch');
    expect(heavy).toContain('while');
    expect(outputs.get('medium')!).not.toContain('switch');
  });

  it('heavy flattens deterministically regardless of seed', () => {
    // 回归:死代码注入曾先于 CFF 执行,注入的 if 会随机破坏平坦化前提
    for (const seed of [1, 42, 0xc0ffee, 0xdead]) {
      const { stats } = obfuscate(source, { ...presets.heavy, seed });
      expect(stats.functionsFlattened).toBeGreaterThanOrEqual(1);
    }
  });
});
