#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { obfuscate } from './obfuscator.js';
import { buildConfig } from './types.js';
import type { PresetName } from './types.js';

interface CliArgs {
  input?: string;
  output?: string;
  preset: PresetName;
  seed: number;
  typescript: boolean;
  stats: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { preset: 'medium', seed: 0x5eed, typescript: false, stats: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    switch (a) {
      case '-i': case '--input': args.input = next(); break;
      case '-o': case '--output': args.output = next(); break;
      case '-p': case '--preset': args.preset = next() as PresetName; break;
      case '--seed': args.seed = Number(next()); break;
      case '--ts': args.typescript = true; break;
      case '--stats': args.stats = true; break;
      case '-h': case '--help': args.help = true; break;
      default:
        if (a.startsWith('--seed=')) args.seed = Number(a.split('=')[1]);
        else throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

const HELP = `sentry-obfuscate — Babel-based JS/TS obfuscator

Usage:
  sentry-obfuscate -i input.js -o output.js [options]

Options:
  -i, --input <file>      source file (default: stdin)
  -o, --output <file>     output file (default: stdout)
  -p, --preset <level>    none | low | medium | high (default: medium)
      --seed <number>     deterministic PRNG seed (default: 24301)
      --ts                parse input as TypeScript
      --stats             print protection statistics to stderr
  -h, --help              show this help
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const source = args.input
    ? readFileSync(resolve(args.input), 'utf8')
    : readFileSync(0, 'utf8');

  const cfg = buildConfig(args.preset, args.seed);
  const result = obfuscate(source, cfg, { filename: args.input, typescript: args.typescript });

  if (args.output) {
    const outPath = resolve(args.output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.code, 'utf8');
  } else {
    process.stdout.write(result.code);
  }

  if (args.stats) {
    process.stderr.write(`${JSON.stringify(result.stats, null, 2)}\n`);
  }
}

main().catch((err: Error) => {
  process.stderr.write(`sentry-obfuscate: ${err.message}\n`);
  process.exit(1);
});
