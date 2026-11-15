/**
 * 示例业务模块:计价 + 风控。即被保护的对象,也是测试基准。
 * 注意:对外只导出 quote / riskScore / decide,内部 helper 会被重命名抹掉。
 */

export type Tier = 'standard' | 'silver' | 'gold' | 'platinum';
export type Region = 'CN' | 'US' | 'EU';

export interface QuoteInput {
  unitPrice: number;
  quantity: number;
  tier: Tier;
  coupon?: string;
  region: Region;
}

export interface Quote {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

const TIER_RATES: Record<Tier, number> = {
  standard: 0,
  silver: 0.05,
  gold: 0.1,
  platinum: 0.15,
};

const COUPON_RATES: Record<string, number> = {
  SAVE10: 0.1,
  VIP20: 0.2,
  WELCOME5: 0.05,
};

const TAX_RATES: Record<Region, number> = {
  CN: 0.13,
  US: 0.08,
  EU: 0.2,
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function tierRate(tier: Tier): number {
  const r = TIER_RATES[tier];
  return r === undefined ? 0 : r;
}

function couponRate(code?: string): number {
  if (!code) return 0;
  const r = COUPON_RATES[code.trim().toUpperCase()];
  return r === undefined ? 0 : r;
}

function taxRate(region: Region): number {
  const r = TAX_RATES[region];
  return r === undefined ? 0 : r;
}

function validateQuoteInput(input: QuoteInput): void {
  if (input.quantity <= 0) throw new Error('quantity must be positive');
  if (input.unitPrice < 0) throw new Error('unitPrice must be non-negative');
}

export function quote(input: QuoteInput): Quote {
  validateQuoteInput(input);
  const subtotal = round2(input.unitPrice * input.quantity);
  const tierCut = subtotal * tierRate(input.tier);
  const afterTier = subtotal - tierCut;
  const couponCut = afterTier * couponRate(input.coupon);
  const discounted = round2(afterTier - couponCut);
  const tax = round2(discounted * taxRate(input.region));
  const total = round2(discounted + tax);
  return { subtotal, discount: round2(subtotal - discounted), tax, total };
}

// ---------------- 风控 ----------------

export interface RiskInput {
  amount: number;
  attemptsLastHour: number;
  ipCountry: string;
  accountAgeDays: number;
}

export type Decision = 'allow' | 'review' | 'block';

const BLOCKED_COUNTRIES = ['KP', 'IR', 'CU'];
const HIGH_RISK_COUNTRIES = ['NG', 'RU', 'BR'];

export function riskScore(input: RiskInput): number {
  let score = 0;
  if (input.amount > 50000) score += 40;
  else if (input.amount > 10000) score += 20;
  else if (input.amount > 1000) score += 5;

  if (input.attemptsLastHour > 10) score += 30;
  else if (input.attemptsLastHour > 3) score += 10;

  if (BLOCKED_COUNTRIES.indexOf(input.ipCountry) >= 0) score += 100;
  if (HIGH_RISK_COUNTRIES.indexOf(input.ipCountry) >= 0) score += 25;

  if (input.accountAgeDays < 7) score += 15;
  else if (input.accountAgeDays < 30) score += 5;

  return score > 100 ? 100 : score;
}

export function decide(input: RiskInput): Decision {
  const s = riskScore(input);
  if (s >= 80) return 'block';
  if (s >= 40) return 'review';
  return 'allow';
}
