export { obfuscate, CODEGEN_OPTIONS } from './obfuscator.js';
export type { ObfuscateResult, ObfuscateOptions } from './obfuscator.js';
export { buildConfig, PRESETS, NONE_PRESET } from './types.js';
export type { ObfuscationConfig, PresetName, RuntimeNames } from './types.js';
export { fnv1a32 } from './util/hash.js';
export { encryptString, b64decode } from './util/crypto.js';
