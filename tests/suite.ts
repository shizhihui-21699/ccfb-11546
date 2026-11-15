import { expect } from 'vitest';
import type { QuoteInput, RiskInput } from '../fixture/pricing';
import { QUOTE_INPUTS, RISK_INPUTS } from './inputs';

export { QUOTE_INPUTS, RISK_INPUTS };

/** 共享行为用例:原始实现与所有档位混淆产物跑同一套,结果必须逐项全等 */

export interface PricingModule {
  quote(input: QuoteInput): unknown;
  riskScore(input: RiskInput): number;
  decide(input: RiskInput): string;
}

export function expectSameBehavior(mod: PricingModule, baseline: PricingModule): void {
  for (const input of QUOTE_INPUTS) {
    expect(mod.quote(input), `quote(${JSON.stringify(input)})`).toEqual(baseline.quote(input));
  }
  for (const input of RISK_INPUTS) {
    expect(mod.riskScore(input), `riskScore(${JSON.stringify(input)})`).toBe(
      baseline.riskScore(input),
    );
    expect(mod.decide(input), `decide(${JSON.stringify(input)})`).toBe(baseline.decide(input));
  }
  // 异常路径行为也要一致
  const badQty: QuoteInput = { unitPrice: 10, quantity: 0, tier: 'standard', region: 'CN' };
  const badPrice: QuoteInput = { unitPrice: -1, quantity: 1, tier: 'standard', region: 'CN' };
  expect(() => mod.quote(badQty)).toThrow('quantity must be positive');
  expect(() => mod.quote(badPrice)).toThrow('unitPrice must be non-negative');
}
