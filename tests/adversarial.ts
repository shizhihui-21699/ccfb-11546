/**
 * Adversarial checks proving the protective behavior rather than just the
 * happy-path semantics:
 *
 *  1. tampered protected function -> integrity guard throws or degrades
 *  2. reformatted/edited source     -> same hash failure path
 *  3. debugger timing trap          -> guard flips into degraded mode
 *  4. structural product assertions -> strings pooled, names hex-style,
 *                                      dispatcher present, dead blocks present
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate as babelGenerate } from '../src/util/babel.js';
import { parse } from '@babel/parser';
import type { buildConfig as BuildConfig } from '../src/types.js';
import type { ObfuscationConfig } from '../src/types.js';

interface AdversarialDeps {
  obfuscate: (src: string, cfg: ObfuscationConfig) => { code: string };
  buildConfig: typeof BuildConfig;
  readSource: (p: string) => Promise<string>;
  writeFile: (p: string, c: string) => void;
  OUT: string;
  check: (label: string, fn: () => void | Promise<void>) => Promise<void> | void;
}

async function importFresh(file: string): Promise<Record<string, unknown>> {
  const imported = await import(`${pathToFileURL(file).href}?t=${file.length}-${file.charCodeAt(file.length - 1)}`);
  return (imported.default ?? imported) as Record<string, unknown>;
}

export async function runAdversarial(deps: AdversarialDeps): Promise<void> {
  const { obfuscate, buildConfig, readSource, writeFile, OUT, check } = deps;
  const pricingPath = join(OUT, '..', 'pricing.cjs');
  const riskPath = join(OUT, '..', 'risk.cjs');
  const pricingSrc = await readSource(pricingPath);
  const riskSrc = await readSource(riskPath);

  // ---------- 1. structural product assertions (high preset) ----------
  {
    const cfg = buildConfig('high', 0xa11ce);
    const { code } = obfuscate(pricingSrc, cfg);
    writeFile(join(OUT, 'structural.high.cjs'), code);

    await check('high: no plaintext sensitive strings (string pool works)', () => {
      if (code.includes('WELCOME10')) throw new Error('coupon literal left in cleartext');
      if (/['"]CNY['"]/.test(code)) throw new Error('currency literal left in cleartext');
    });

    await check('high: identifiers renamed to hex style', () => {
      if (/function\s+calcPrice\b/.test(code)) throw new Error('calcPrice name survived renaming');
      if (!/_0x[0-9a-f]{4,}/.test(code)) throw new Error('no obfuscated identifiers found');
    });

    await check('high: control-flow dispatcher present', () => {
      if (!code.includes('while(true)') && !/while\s*\(\s*!?0?\s*\)/.test(code)) {
        if (!code.includes('__state__')) throw new Error('state machine not found');
      }
    });

    await check('high: opaque-predicate dead blocks present', () => {
      if (!code.includes('%4') && !code.includes('% 4')) {
        throw new Error('opaque predicate not found');
      }
    });
  }

  // ---------- 2. integrity: tamper -> throw (explicit throw preset) ----------
  {
    const cfg = buildConfig('high', 0xb0b, {
      integrity: {
        enabled: true, targets: ['calcPrice'], onViolation: 'throw', checkEveryCall: true,
      },
      antiDebug: { enabled: false, intervalMs: 0, timingThresholdMs: 100 },
    });
    const { code } = obfuscate(pricingSrc, cfg);
    const file = join(OUT, 'tamper.throw.cjs');
    writeFile(file, code);
    const clean = await importFresh(file);
    await check('integrity(throw): untouched build works', () => {
      const r = (clean.calcPrice as (i: unknown[], c?: string) => { total: number })(
        [{ qty: 1, unitPrice: 100 }]
      );
      if (typeof r.total !== 'number') throw new Error('unexpected result');
    });

    // inject a no-op statement into the protected inner function body
    const tampered = injectNoop(code);
    const tamperedFile = join(OUT, 'tamper.throw.edited.cjs');
    writeFile(tamperedFile, tampered);
    const mod = await importFresh(tamperedFile);
    await check('integrity(throw): edited source fails on call', () => {
      let threw = false;
      try {
        (mod.calcPrice as (...a: unknown[]) => unknown)([{ qty: 1, unitPrice: 100 }]);
      } catch (e) {
        threw = /integrity|violation/i.test((e as Error).message);
      }
      if (!threw) throw new Error('tampered call did not throw an integrity error');
    });
  }

  // ---------- 3. integrity: degrade mode ----------
  {
    const cfg = buildConfig('medium', 0xc0c, {
      integrity: {
        enabled: true, targets: ['riskScore'], onViolation: 'degrade', checkEveryCall: true,
      },
    });
    const { code } = obfuscate(riskSrc, cfg);
    const tampered = injectNoop(code);
    const file = join(OUT, 'tamper.degrade.cjs');
    writeFile(file, tampered);
    const mod = await importFresh(file);
    await check('integrity(degrade): edited source enters degraded mode', () => {
      let degraded = false;
      try {
        (mod.riskScore as (...a: unknown[]) => unknown)({
          amount: 1, accountAgeDays: 1, ipCountry: 'CN', retryCount: 0,
        });
      } catch (e) {
        degraded = /degraded/i.test((e as Error).message);
      }
      if (!degraded) throw new Error('expected degraded-mode error after tamper');
    });
  }

  // ---------- 4. reformatting changes Function.toString -> hash fails ----------
  {
    const cfg = buildConfig('medium', 0xd0d, {
      integrity: {
        enabled: true, targets: ['calcPrice'], onViolation: 'throw', checkEveryCall: false,
      },
      antiDebug: { enabled: false, intervalMs: 0, timingThresholdMs: 100 },
    });
    const { code } = obfuscate(pricingSrc, cfg);
    // parse + regenerate with different (non-compact) options = beautifier output
    const ast = parse(code);
    const beautified = babelGenerate(ast, { compact: false, comments: false, retainLines: false }).code;
    const file = join(OUT, 'tamper.reformatted.cjs');
    writeFile(file, beautified);
    await check('integrity: beautified/reformatted source is rejected', async () => {
      let threw = false;
      try {
        // with checkEveryCall:false the guard runs at module load, so the
        // dynamic import itself may reject; otherwise the first call throws.
        const mod = await importFresh(file);
        try {
          (mod.calcPrice as (...a: unknown[]) => unknown)([{ qty: 1, unitPrice: 100 }]);
        } catch (e) {
          threw = /integrity|violation/i.test((e as Error).message);
        }
      } catch (e) {
        threw = /integrity|violation/i.test((e as Error).message);
      }
      if (!threw) throw new Error('reformatted source was accepted');
    });
  }

  // ---------- 5. anti-debug timing trap flips the guard ----------
  // Simulate a debugger pause deterministically: the probe reads a clock before
  // and after `debugger;`, so make the second reading lag by a large delta.
  {
    const cfg = buildConfig('low', 0xe0e, {
      antiDebug: { enabled: true, intervalMs: 0, timingThresholdMs: 100 },
      integrity: { enabled: false, targets: [], onViolation: 'throw', checkEveryCall: false },
    });
    const { code } = obfuscate(riskSrc, cfg);
    const file = join(OUT, 'antidebug.cjs');
    writeFile(file, code);

    const g = globalThis as Record<string, unknown>;
    const realPerf = g.performance as { now: () => number };
    const realNow = realPerf.now.bind(realPerf);
    let reads = 0;
    g.performance = { now: () => realNow() + (++reads === 2 ? 5000 : 0) };
    let mod: Record<string, unknown> = {};
    try {
      mod = await importFresh(file);
    } finally {
      g.performance = realPerf;
    }
    const guardName = guardNameIn(code);
    await check('anti-debug: timing trap flips guard into degraded mode', () => {
      const guard = g[guardName] as { degraded?: boolean; tampered?: boolean } | undefined;
      if (!guard) throw new Error('guard global missing');
      if (!guard.degraded || !guard.tampered) {
        throw new Error('guard did not degrade after debugger-timing probe');
      }
      if (typeof mod.riskScore !== 'function') throw new Error('exports broken');
    });
  }

  // ---------- 6. anti-debug stays healthy with a generous threshold ----------
  {
    const cfg = buildConfig('low', 0xe0f, {
      antiDebug: { enabled: true, intervalMs: 0, timingThresholdMs: 60000 },
      integrity: { enabled: false, targets: [], onViolation: 'throw', checkEveryCall: false },
    });
    const { code } = obfuscate(riskSrc, cfg);
    const file = join(OUT, 'antidebug.healthy.cjs');
    writeFile(file, code);
    await importFresh(file);
    const guardName = guardNameIn(code);
    await check('anti-debug: generous threshold leaves guard healthy', () => {
      const guard = (globalThis as Record<string, unknown>)[guardName] as
        { degraded?: boolean } | undefined;
      if (!guard) throw new Error('guard global missing');
      if (guard.degraded) throw new Error('false positive: guard degraded without a debugger');
    });
  }
}

/** Insert a statement without renaming anything, so only the body text changes. */
function injectNoop(code: string): string {
  // target the first protected inner function and prepend a void expression
  const marker = 'function __sentryInner_';
  const idx = code.indexOf(marker);
  if (idx < 0) throw new Error('inner function marker not found; rename output changed?');
  const brace = code.indexOf('{', idx);
  if (brace < 0) throw new Error('inner function body not found');
  return `${code.slice(0, brace + 1)}void 0x73;${code.slice(brace + 1)}`;
}

function guardNameIn(code: string): string {
  const m = code.match(/globalThis\[("|')(__SENTRY_GUARD_[0-9a-f]+__)\1\]/);
  if (!m) throw new Error('guard global not found');
  return m[2]!;
}
