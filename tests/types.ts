export interface CartItem {
  qty: number;
  unitPrice: number;
}

export interface PriceQuote {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  currency: string;
  quoteId?: string;
}

export interface PricingModule {
  VAT_RATE: number;
  DISCOUNT_TIERS: readonly { minAmount: number; rate: number }[];
  round2(v: number): number;
  basePrice(items: CartItem[]): number;
  discountRate(amount: number): number;
  calcDiscount(amount: number): number;
  calcTax(amount: number): number;
  calcPrice(items: CartItem[], couponCode?: string): PriceQuote;
  priceQuote(items: CartItem[], couponCode?: string): PriceQuote;
}

export interface RiskContext {
  amount: number;
  accountAgeDays: number;
  ipCountry: string;
  retryCount: number;
}

export interface RiskResult {
  score: number;
  hit: string[];
  level?: string;
  decisionAt?: string;
}

export interface RiskRule {
  id: string;
  weight: number;
  test: (ctx: RiskContext) => boolean;
}

export interface RiskModule {
  RULES: RiskRule[];
  riskScore(ctx: RiskContext): RiskResult;
  riskLevel(ctx: RiskContext): RiskResult;
  fraudEngine(ctx: RiskContext): RiskResult;
  RuleEngine: new (rules?: RiskRule[]) => { evaluate(ctx: RiskContext): RiskResult };
}
