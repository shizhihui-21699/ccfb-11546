/**
 * Full acceptance suite.
 *
 *   baseline   : original fixtures run the shared battery
 *   regression : every preset (none/low/medium/high) x multiple seeds,
 *                obfuscated artifacts run the SAME battery
 *   adversarial: tamper / reformat / debugger-detection behavior
 *
 * Exit code is non-zero if any check fails.
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { obfuscate } from '../src/obfuscator.js';
import { buildConfig } from '../src/types.js';
import type { PresetName } from '../src/types.js';
import { runPricingBattery, runRiskBattery } from './battery.js';
import { runAdversarial } from './adversarial.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const OUT = join(ROOT, 'tests', 'fixtures', 'obfuscated');

interface Case {
  fixture: string;
  battery: (mod: Record<string, unknown>) => void;
}

const CASES: Case[] = [
  { fixture: 'pricing.cjs', battery: (m) => runPricingBattery(m as never) },
  { fixture: 'risk.cjs', battery: (m) => runRiskBattery(m as never) },
];

const PRESETS: PresetName[] = ['none', 'low', 'medium', 'high'];
const SEEDS = [1, 24301, 0xdeadbeef];

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function importFresh(file: string): Promise<Record<string, unknown>> {
  const url = `${pathToFileURL(file).href}?v=${encodeURIComponent(file)}`;
  return import(url);
}

async function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failed++;
    failures.push(`${label}: ${(err as Error).message}`);
    console.log(`  ✗ ${label} — ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  console.log('── baseline (original fixtures) ──');
  for (const c of CASES) {
    const imported = await importFresh(join(FIXTURES, c.fixture));
    const mod = (imported.default ?? imported) as Record<string, unknown>;
    await check(`baseline ${c.fixture}`, () => c.battery(mod));
  }

  console.log('\n── regression: obfuscated artifacts run the same battery ──');
  for (const preset of PRESETS) {
    for (const seed of SEEDS) {
      for (const c of CASES) {
        const source = await readSource(join(FIXTURES, c.fixture));
        const cfg = buildConfig(preset, seed);
        const result = obfuscate(source, cfg);
        const base = c.fixture.replace(/\.(c?js)$/, '');
        const outName = `${base}.${preset}.${seed}.cjs`;
        const outPath = join(OUT, outName);
        writeFileSync(outPath, result.code, 'utf8');
        const imported = await importFresh(outPath);
        const mod = (imported.default ?? imported) as Record<string, unknown>;
        await check(`${preset}/seed=${seed} ${c.fixture}`, () => c.battery(mod));
      }
    }
  }

  console.log('\n── adversarial protection checks ──');
  await runAdversarial({ obfuscate, buildConfig, readSource, writeFile: writeFileSync, OUT, check });

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

async function readSource(p: string): Promise<string> {
  const { readFileSync } = await import('node:fs');
  return readFileSync(p, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
