/**
 * Size and performance benchmark.
 *
 * For every preset it obfuscates both fixtures, measures emitted byte size
 * against the original, then times a fixed workload against original and
 * obfuscated modules. Timing uses many iterations after a warmup with
 * process.hrtime.bigint and reports the median, so the number is stable enough
 * to compare across runs on the same machine.
 */
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { obfuscate } from '../src/obfuscator.js';
import { buildConfig } from '../src/types.js';
import type { PresetName } from '../src/types.js';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const OUT = join(ROOT, 'benchmarks', '.build');
const ITERATIONS = 20_000;
const WARMUP = 2_000;

const PRESETS: PresetName[] = ['none', 'low', 'medium', 'high'];
const SEED = 24301;

const CART = [
  { qty: 2, unitPrice: 199.5 },
  { qty: 1, unitPrice: 1200 },
  { qty: 3, unitPrice: 49.9 },
];
const RISK_CTX = { amount: 90000, accountAgeDays: 2, ipCountry: 'US', retryCount: 5 };

async function load(file: string): Promise<Record<string, unknown>> {
  const imported = await import(`${pathToFileURL(file).href}?v=${file.length}-${file.charCodeAt(file.length - 1)}`);
  return (imported.default ?? imported) as Record<string, unknown>;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function timeWorkload(mod: Record<string, unknown>, fixture: string): number {
  const samples: number[] = [];
  let invoke: () => unknown;
  if (fixture === 'pricing.cjs') {
    const calcPrice = mod.calcPrice as (i: typeof CART, c?: string) => unknown;
    invoke = () => calcPrice(CART, 'WELCOME10');
  } else {
    const riskScore = mod.riskScore as (c: typeof RISK_CTX) => unknown;
    invoke = () => riskScore(RISK_CTX);
  }
  // warmup
  for (let i = 0; i < WARMUP; i++) invoke();
  const batches = 20;
  for (let b = 0; b < batches; b++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS / batches; i++) invoke();
    samples.push(Number(process.hrtime.bigint() - start));
  }
  // nanoseconds per workload invocation
  return median(samples) / (ITERATIONS / batches);
}

interface Row {
  preset: PresetName;
  fixture: string;
  originalBytes: number;
  obfBytes: number;
  sizeRatio: number;
  nsPerCall: number;
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const fixtures = ['pricing.cjs', 'risk.cjs'];
  const rows: Row[] = [];

  for (const fixture of fixtures) {
    const srcPath = join(FIXTURES, fixture);
    const source = readFileSync(srcPath, 'utf8');
    const originalBytes = Buffer.byteLength(source, 'utf8');

    // baseline timing from the untouched module
    const baselineMod = await load(srcPath);
    const baselineNs = timeWorkload(baselineMod, fixture);
    rows.push({
      preset: 'none', fixture, originalBytes,
      obfBytes: originalBytes, sizeRatio: 1, nsPerCall: baselineNs,
    });

    for (const preset of ['low', 'medium', 'high'] as Exclude<PresetName, 'none'>[]) {
      const cfg = buildConfig(preset, SEED);
      const { code, stats } = obfuscate(source, cfg);
      const outPath = join(OUT, `${fixture}.${preset}.cjs`);
      writeFileSync(outPath, code, 'utf8');
      const mod = await load(outPath);
      const ns = timeWorkload(mod, fixture);
      rows.push({
        preset, fixture, originalBytes,
        obfBytes: Buffer.byteLength(code, 'utf8'),
        sizeRatio: Buffer.byteLength(code, 'utf8') / originalBytes,
        nsPerCall: ns,
      });
      void stats;
    }
  }

  // report
  const lines: string[] = [];
  lines.push('Sentry obfuscator — size & performance benchmark');
  lines.push(`iterations per timing sample: ${ITERATIONS}, seed: ${SEED}`);
  lines.push('');
  lines.push('fixture      preset   original(B)  obfuscated(B)   size x    ns/call   perf x');
  lines.push('-'.repeat(86));
  for (const fixture of fixtures) {
    const base = rows.find((r) => r.fixture === fixture && r.preset === 'none')!;
    for (const preset of PRESETS) {
      const r = rows.find((x) => x.fixture === fixture && x.preset === preset)!;
      const perfX = r.nsPerCall / base.nsPerCall;
      lines.push(
        `${fixture.padEnd(12)} ${preset.padEnd(8)} ` +
        `${String(r.originalBytes).padStart(11)}  ${String(r.obfBytes).padStart(12)}  ` +
        `${r.sizeRatio.toFixed(2).padStart(6)}  ${Math.round(r.nsPerCall).toString().padStart(8)}  ` +
        `${perfX.toFixed(2).padStart(6)}`
      );
    }
    lines.push('');
  }
  const report = lines.join('\n');
  process.stdout.write(`${report}\n`);
  writeFileSync(join(ROOT, 'benchmarks', 'benchmark-report.txt'), `${report}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
