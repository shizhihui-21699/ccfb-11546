export interface StringEncryptionOptions {
  enabled: boolean;
  /** 短于该长度的字符串不加密(性价比考虑) */
  minLength: number;
}

export interface DeadCodeOptions {
  enabled: boolean;
  /** 注入的永不调用垃圾函数数量 */
  junkFunctions: number;
  /** 每个函数体内注入不透明谓词死分支的概率 0~1 */
  perFunctionProbability: number;
}

export interface ControlFlowFlattenOptions {
  enabled: boolean;
  /** 函数体语句数 >= 该值才做平坦化 */
  threshold: number;
}

export interface IntegrityOptions {
  enabled: boolean;
  /** throw: 被篡改后调用直接抛错; corrupt: 静默返回 undefined */
  mode: 'throw' | 'corrupt';
}

export interface DebugGuardOptions {
  enabled: boolean;
  /** debugger 语句前后耗时超过该毫秒数即判定为调试中 */
  thresholdMs: number;
  /** 浏览器端定时巡检间隔 */
  intervalMs: number;
}

export interface ObfuscatorOptions {
  /** 固定 seed 可复现构建 */
  seed?: number;
  rename: boolean;
  stringEncryption: StringEncryptionOptions;
  deadCode: DeadCodeOptions;
  controlFlowFlattening: ControlFlowFlattenOptions;
  integrity: IntegrityOptions;
  debugGuard: DebugGuardOptions;
  compact: boolean;
}

export interface ObfuscateStats {
  renamed: number;
  stringsEncrypted: number;
  functionsFlattened: number;
  junkInjected: number;
  exportsProtected: number;
}

export interface ObfuscateResult {
  code: string;
  stats: ObfuscateStats;
}
