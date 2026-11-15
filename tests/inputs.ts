import type { QuoteInput, RiskInput } from '../fixture/pricing';

/** 共享测试输入(不依赖 vitest,bench 也复用) */

export const QUOTE_INPUTS: QuoteInput[] = [
  { unitPrice: 100, quantity: 2, tier: 'standard', region: 'CN' },
  { unitPrice: 49.99, quantity: 3, tier: 'gold', coupon: 'SAVE10', region: 'US' },
  { unitPrice: 1000, quantity: 1, tier: 'platinum', coupon: 'VIP20', region: 'EU' },
  { unitPrice: 25, quantity: 4, tier: 'silver', coupon: 'NOPE', region: 'CN' },
  { unitPrice: 0.01, quantity: 999, tier: 'standard', coupon: 'welcome5', region: 'US' },
  { unitPrice: 199.5, quantity: 7, tier: 'gold', coupon: '  SAVE10  ', region: 'EU' },
  { unitPrice: 88.88, quantity: 13, tier: 'platinum', region: 'CN' },
];

export const RISK_INPUTS: RiskInput[] = [
  { amount: 500, attemptsLastHour: 1, ipCountry: 'CN', accountAgeDays: 365 },
  { amount: 20000, attemptsLastHour: 5, ipCountry: 'BR', accountAgeDays: 3 },
  { amount: 60000, attemptsLastHour: 20, ipCountry: 'KP', accountAgeDays: 1 },
  { amount: 1500, attemptsLastHour: 2, ipCountry: 'US', accountAgeDays: 10 },
  { amount: 99999, attemptsLastHour: 0, ipCountry: 'IR', accountAgeDays: 90 },
  { amount: 800, attemptsLastHour: 8, ipCountry: 'NG', accountAgeDays: 20 },
];
