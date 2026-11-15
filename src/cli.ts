#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { Command } from 'commander';
import { obfuscate } from './obfuscator';
import { presets, type PresetName } from './presets';

const program = new Command();

program
  .name('obfusk')
  .description('Babel-based JS/TS obfuscator: rename / string-encrypt / CFF / dead-code / integrity / anti-debug')
  .version('0.1.0');

program
  .command('build')
  .argument('<input>', 'source file (.ts/.js)')
  .option('-o, --output <file>', 'output file (default: <name>.obf.js)')
  .option('-p, --preset <name>', 'light | medium | heavy', 'heavy')
  .option('--seed <n>', 'fixed seed for reproducible builds', (v) => parseInt(v, 10))
  .action((input: string, opts: { output?: string; preset: string; seed?: number }) => {
    const preset = presets[opts.preset as PresetName];
    if (!preset) {
      console.error(`unknown preset "${opts.preset}", expected: ${Object.keys(presets).join(', ')}`);
      process.exit(1);
    }
    const source = readFileSync(input, 'utf8');
    const options = opts.seed !== undefined ? { ...preset, seed: opts.seed } : preset;
    const { code, stats } = obfuscate(source, options);

    const out =
      opts.output ?? input.replace(/\.(ts|js|mjs|tsx)$/, '') + '.obf.js';
    writeFileSync(out, code);

    const rawIn = Buffer.byteLength(source);
    const rawOut = Buffer.byteLength(code);
    const gzOut = gzipSync(code).length;
    console.log(`preset:            ${opts.preset}`);
    console.log(`output:            ${path.resolve(out)}`);
    console.log(`size:              ${rawIn} B -> ${rawOut} B (x${(rawOut / rawIn).toFixed(2)}), gzip ${gzOut} B`);
    console.log(`renamed:           ${stats.renamed}`);
    console.log(`strings encrypted: ${stats.stringsEncrypted}`);
    console.log(`functions CFF'd:   ${stats.functionsFlattened}`);
    console.log(`dead code blocks:  ${stats.junkInjected}`);
    console.log(`exports protected: ${stats.exportsProtected}`);
  });

program.parse();
