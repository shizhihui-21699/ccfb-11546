import * as t from '@babel/types';
import { parse } from '@babel/parser';
import type { NameGen } from '../utils/names';
import type { DebugGuardOptions } from '../types';

/**
 * 调试器检测 → 降级:
 *  - `debugger` 语句计时:有调试器附着时该语句会中断,前后耗时异常
 *  - 浏览器端窗口尺寸差检测 DevTools 停靠
 * 检测到后把共享降级标志置位,由完整性包装器让导出函数失效(见 integrity.ts)。
 * 正常浏览器/Node 环境下开销可忽略,不会影响测试。
 */
export function injectDebugGuard(
  ast: t.File,
  nameGen: NameGen,
  flagName: string,
  opts: DebugGuardOptions,
): void {
  const guardName = nameGen.next();
  const src = `
function ${guardName}() {
  var t0 = Date.now();
  debugger;
  if (Date.now() - t0 > ${opts.thresholdMs}) { ${flagName} = true; }
  if (typeof window !== 'undefined') {
    var dw = window.outerWidth - window.innerWidth;
    var dh = window.outerHeight - window.innerHeight;
    if (dw > 160 || dh > 160) { ${flagName} = true; }
  }
}`;
  const guardAst = parse(src);
  ast.program.body.unshift(...(guardAst.program.body as t.Statement[]));

  const initSrc = `
${guardName}();
if (typeof window !== 'undefined' && typeof setInterval === 'function') {
  setInterval(${guardName}, ${opts.intervalMs});
}`;
  const initAst = parse(initSrc);
  ast.program.body.push(...(initAst.program.body as t.Statement[]));
}
