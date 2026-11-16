import type { Rng } from './rng.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$';

// JS reserved words plus common globals that must never be produced as names.
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'enum', 'await', 'arguments', 'eval',
]);

/**
 * Produces hex-style obfuscated identifiers (e.g. _0x4f2a) guaranteed unique
 * within the whole program, and never colliding with a set of reserved names
 * (injected runtime helpers are reserved up front).
 */
export class NameGenerator {
  private used = new Set<string>();
  private counter = 0;

  constructor(private rng: Rng, reserved: readonly string[] = []) {
    for (const name of reserved) this.used.add(name);
  }

  private raw(): string {
    // deterministic pseudo-random suffix plus monotonic counter ensures uniqueness
    const hex = (this.rng.int(0xffff) * 0x10000 + this.counter).toString(16).padStart(5, '0');
    this.counter++;
    return `_0x${hex}`;
  }

  next(): string {
    let name = this.raw();
    while (RESERVED.has(name) || this.used.has(name)) {
      name = this.raw();
    }
    this.used.add(name);
    return name;
  }

  isUsed(name: string): boolean {
    return this.used.has(name);
  }

  /** A legal JS identifier built from letters, used for runtime helpers. */
  helper(prefix: string): string {
    let name = `${prefix}${this.rng.int(0xffff).toString(16)}`;
    while (RESERVED.has(name) || this.used.has(name)) {
      name = `${prefix}${this.rng.int(0xffff).toString(16)}${this.counter++}`;
    }
    this.used.add(name);
    return name;
  }

  static looksObfuscated(name: string): boolean {
    return /^_0x[0-9a-f]+$/.test(name);
  }
}

export { LETTERS, ALNUM };
