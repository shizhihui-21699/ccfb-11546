# Sentry Obfuscator

基于 Babel 的 TypeScript 代码混淆保护工具，面向前端**计价 / 风控**等核心业务逻辑，
防止竞品直接扒取可读源码。所有保护都是 AST 级语义保持变换——混淆产物必须通过原测试集。

## 能力清单

| 保护 | 实现 | 触发/效果 |
| --- | --- | --- |
| 标识符重命名 | 基于 Babel Scope 绑定表，作用域安全 | 局部变量/函数/参数改名为 `_0x…`，保留导出、全局、属性名 |
| 字符串加密 | 字符串池 + 解码器，Base64+XOR 或 RC4，可加池旋转 | 字面量改为 `decoder(index, key)` 调用，支持解码结果记忆化 |
| 控制流平坦化 | `while(true){switch(state)}` 状态机分发 | 顶层线性流程打散为乱序 case，可注入不可达垃圾 case |
| 死代码注入 | 恒假不透明谓词 `(imul(x,x)+2)%4===0` + 垃圾函数 | 谓词静态不可折叠，死块永不执行 |
| 完整性自校验 | 构建期 FNV-1a 哈希烧入，运行期 `Function.toString` 复算 | 被格式化/篡改即哈希不符，抛错或进入降级模式 |
| 反调试 | `debugger;` 计时探针 + 可选定时复检 | 检测到调试器暂停超过阈值即降级 |

### 完整性自校验的工作方式

1. 构建期（重命名之后）对受保护函数的最终源码做 FNV-1a 哈希，烧进产物；
2. 运行期用 `Function.prototype.toString.call(fn)` 重新取源码文本并复算；
3. 任何重新格式化、增删语句都会改变文本 → 哈希不符。
   - `onViolation: 'throw'`：直接抛 `integrity violation`，停止工作；
   - `onViolation: 'degrade'`：全局 guard 置为降级，受保护函数经 `guard.run` 转兜底逻辑或抛错。

> 注意：`toString()` 反映的是函数源码文本，因此**仅格式化（不改语义）也会触发**——
> 这正是"被格式化就停止工作"的实现基础。

## 强度档位

`none / low / medium / high` 四档，差异是各保护的算法与激进度：

| 维度 | low | medium | high |
| --- | --- | --- | --- |
| 标识符重命名 | ✓ | ✓ | ✓ |
| 字符串算法 | Base64+XOR | RC4 + 池旋转 | RC4 + 池旋转 |
| 平坦化比例 | 25% | 60% + 垃圾 case | 100% + 垃圾 case |
| 死代码 | ✓ | ✓ | ✓ |
| 完整性校验 | 启动期一次 / throw | 启动期一次 / degrade | **每次调用** / degrade |
| 反调试 | 单次探针 | 4s 复检 | 2s 复检，50ms 阈值 |

设计意图：low 优先性能与"出事即停"；high 用每调用哈希换取最强防篡改，代价是运行时开销，
适合只在少量最敏感函数上启用。所有档位都可用 `overrides` 细调任意字段。

## 使用

### CLI

```bash
# 编译后
node dist/cli.js -i pricing.js -o pricing.obf.cjs -p high --seed 24301 --stats
# TypeScript 输入（类型会被剥离，输出为 JS）
node dist/cli.js -i core.ts --ts -p medium -o core.obf.mjs
# 开发期用 tsx
npx tsx src/cli.ts -i input.js -o out.js -p low
```

### 编程接口

```ts
import { obfuscate, buildConfig } from 'sentry-obfuscator';

const cfg = buildConfig('high', 24301, {
  integrity: { enabled: true, targets: ['calcPrice'], onViolation: 'throw', checkEveryCall: true },
});
const { code, stats } = obfuscate(source, cfg, { typescript: false });
```

固定 `seed` 可复现构建：相同输入 + 相同种子 ⇒ 字节级一致产物。

## 测试与测量

```bash
npm test     # 36 项：基线 + 4 档 × 3 种子 × 2 业务模块全量回归 + 对抗测试
npm run bench # 体积与性能基准，结果写入 benchmarks/benchmark-report.txt
```

- **回归**：同一套断言（`tests/battery.ts`）既跑原始 fixture，也跑每个混淆产物，
  因此"混淆后过原测试集"是字面上的同一条代码路径。
- **对抗测试**（`tests/adversarial.ts`）验证：
  篡改函数体 → throw/degrade；重新格式化 → 拒绝加载/调用；
  模拟调试器暂停 → guard 进入降级；字符串/标识符/状态机/不透明谓词结构断言。

### 实测基准（Node 26，20k 次调用取中位数）

体积膨胀约 **4.3–5.5 倍**；运行时开销经解码器记忆化后：

| fixture | 档位 | 体积 × | 性能 × |
| --- | --- | --- | --- |
| pricing | low | 4.56 | ~1.4 |
| pricing | medium | 4.70 | ~1.3 |
| pricing | high | 5.12 | ~140（每调用完整性哈希） |
| risk | low | 4.34 | ~1.9 |
| risk | medium | 4.97 | ~1.7 |
| risk | high | 5.50 | ~117（每调用完整性哈希） |

关键结论：字符串解码、平坦化等单项开销都很小；**high 档的主要成本来自每调用
`toString()` + 哈希的完整性校验**，这是安全/性能的显式权衡。解码器内置结果缓存，
使 low/medium 的字符串加密几乎不增加稳态开销。具体数值随机器变化，以 `npm run bench` 为准。

## 安全边界（诚实说明）

- 工具抬高静态分析和复制成本，但**无法阻止**决心足够的攻击者动态调试、hook 运行时或重建逻辑；
- 反调试依赖计时差，可被环境模拟；guard 挂在 `globalThis` 上，理论上可被预先 patch；
- 完整性哈希覆盖被包装函数自身文本，不含整个文件；如需更强保证可配合 SRI/CSP 与服务端校验。
