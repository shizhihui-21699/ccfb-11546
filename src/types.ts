/**
 * All protection toggles and knobs. Strength presets (PRESETS) fill these in;
 * callers can override any field for custom mixes.
 */
export interface ObfuscationConfig {
  /** preset label, informational */
  preset: 'none' | 'low' | 'medium' | 'high' | 'custom';
  /** deterministic seed for the PRNG — same input + seed => byte-identical output */
  seed: number;

  /** identifier renaming (scope-safe via Babel Scope) */
  rename: {
    enabled: boolean;
    /** also rename inner function declarations / expressions */
    renameFunctions: boolean;
    /** rename function parameters */
    renameParameters: boolean;
  };

  /** string literal encryption + pooled decoder */
  stringEncryption: {
    enabled: boolean;
    /** 'base64xor' (light) or 'rc4' (stronger) */
    algorithm: 'base64xor' | 'rc4';
    /** rotate/permute the string pool and add a runtime rotation loop */
    rotatePool: boolean;
    /** fraction of eligible string literals that get encrypted, 0..1 */
  };

  /** control-flow flattening with a state-machine dispatcher */
  flatten: {
    enabled: boolean;
    /** fraction of eligible functions that are flattened, 0..1 */
    ratio: number;
    /** add unreachable junk cases that jump back into the state machine */
    junkCases: boolean;
  };

  /** dead code behind opaque predicates + junk functions */
  deadCode: {
    enabled: boolean;
    /** probability a statement gets a dead sibling block, 0..1 */
  };

  /** runtime source-integrity self-check (FNV-1a over Function.toString) */
  integrity: {
    enabled: boolean;
    /** function names that must be wrapped; [] means auto-detect */
    targets: string[];
    /** 'throw' halts execution, 'degrade' switches the guard into degraded mode */
    onViolation: 'throw' | 'degrade';
    /** re-check on every call (true) or once at startup (false) */
    checkEveryCall: boolean;
  };

  /** debugger / devtools detection -> degraded mode */
  antiDebug: {
    enabled: boolean;
    /** periodic re-arming interval in ms; 0 disables the interval */
    intervalMs: number;
    /** timing threshold in ms above which a debugger is assumed attached */
    timingThresholdMs: number;
  };
}

export type PresetName = 'none' | 'low' | 'medium' | 'high';

export const PRESETS: Record<Exclude<PresetName, 'none'>, Omit<ObfuscationConfig, 'preset' | 'seed'>> = {
  low: {
    rename: { enabled: true, renameFunctions: true, renameParameters: true },
    stringEncryption: { enabled: true, algorithm: 'base64xor', rotatePool: false },
    flatten: { enabled: true, ratio: 0.25, junkCases: false },
    deadCode: { enabled: true },
    integrity: { enabled: true, targets: [], onViolation: 'throw', checkEveryCall: false },
    antiDebug: { enabled: true, intervalMs: 0, timingThresholdMs: 100 },
  },
  medium: {
    rename: { enabled: true, renameFunctions: true, renameParameters: true },
    stringEncryption: { enabled: true, algorithm: 'rc4', rotatePool: true },
    flatten: { enabled: true, ratio: 0.6, junkCases: true },
    deadCode: { enabled: true },
    integrity: { enabled: true, targets: [], onViolation: 'degrade', checkEveryCall: false },
    antiDebug: { enabled: true, intervalMs: 4000, timingThresholdMs: 100 },
  },
  high: {
    rename: { enabled: true, renameFunctions: true, renameParameters: true },
    stringEncryption: { enabled: true, algorithm: 'rc4', rotatePool: true },
    flatten: { enabled: true, ratio: 1, junkCases: true },
    deadCode: { enabled: true },
    integrity: { enabled: true, targets: [], onViolation: 'degrade', checkEveryCall: true },
    antiDebug: { enabled: true, intervalMs: 2000, timingThresholdMs: 50 },
  },
};

export const NONE_PRESET: Omit<ObfuscationConfig, 'preset' | 'seed'> = {
  rename: { enabled: false, renameFunctions: false, renameParameters: false },
  stringEncryption: { enabled: false, algorithm: 'base64xor', rotatePool: false },
  flatten: { enabled: false, ratio: 0, junkCases: false },
  deadCode: { enabled: false },
  integrity: { enabled: false, targets: [], onViolation: 'throw', checkEveryCall: false },
  antiDebug: { enabled: false, intervalMs: 0, timingThresholdMs: 100 },
};

export function buildConfig(preset: PresetName, seed: number, overrides: Partial<ObfuscationConfig> = {}): ObfuscationConfig {
  const base: Omit<ObfuscationConfig, 'preset' | 'seed'> =
    preset === 'none' ? structuredClone(NONE_PRESET) : structuredClone(PRESETS[preset]);
  return {
    ...structuredClone(base),
    ...overrides,
    preset,
    seed,
  } as ObfuscationConfig;
}

export interface RuntimeNames {
  /** string decoder helper */
  decoder: string;
  /** string pool variable */
  pool: string;
  /** opaque-predicate runtime constant */
  opaque: string;
  /** global guard object name (property of globalThis) */
  guardGlobal: string;
  /** local reference to the guard inside prelude */
  guardLocal: string;
  /** anti-debug prelude function */
  antiDebug: string;
}
