import type { ObfuscatorOptions } from './types';

export type PresetName = 'light' | 'medium' | 'heavy';

/**
 * 强度档位设计:
 *
 * | 档位   | 重命名 | 字符串加密 | 死代码 | 控制流平坦化 | 完整性校验 | 调试器检测 | 适用场景           |
 * |--------|--------|-----------|--------|--------------|-----------|-----------|--------------------|
 * | light  | ✓      | ✓(≥4字符) | —      | —            | —         | —         | 性能敏感的边缘页面 |
 * | medium | ✓      | ✓(≥2字符) | ✓      | —            | —         | ✓         | 默认发版           |
 * | heavy  | ✓      | ✓(全部)   | ✓(更多)| ✓            | ✓         | ✓         | 计价/风控核心模块  |
 */
export const presets: Record<PresetName, ObfuscatorOptions> = {
  light: {
    rename: true,
    compact: true,
    stringEncryption: { enabled: true, minLength: 4 },
    deadCode: { enabled: false, junkFunctions: 0, perFunctionProbability: 0 },
    controlFlowFlattening: { enabled: false, threshold: 3 },
    integrity: { enabled: false, mode: 'throw' },
    debugGuard: { enabled: false, thresholdMs: 150, intervalMs: 3000 },
  },
  medium: {
    rename: true,
    compact: true,
    stringEncryption: { enabled: true, minLength: 2 },
    deadCode: { enabled: true, junkFunctions: 3, perFunctionProbability: 0.5 },
    controlFlowFlattening: { enabled: false, threshold: 3 },
    integrity: { enabled: false, mode: 'throw' },
    debugGuard: { enabled: true, thresholdMs: 150, intervalMs: 3000 },
  },
  heavy: {
    rename: true,
    compact: true,
    stringEncryption: { enabled: true, minLength: 1 },
    deadCode: { enabled: true, junkFunctions: 5, perFunctionProbability: 0.8 },
    controlFlowFlattening: { enabled: true, threshold: 3 },
    integrity: { enabled: true, mode: 'throw' },
    debugGuard: { enabled: true, thresholdMs: 150, intervalMs: 3000 },
  },
};

export function resolvePreset(name: PresetName, overrides?: Partial<ObfuscatorOptions>): ObfuscatorOptions {
  return { ...presets[name], ...overrides };
}
