/**
 * Shared assertion battery. The exact same checks run against:
 *   1. the original fixture modules
 *   2. every obfuscated build (low / medium / high presets, several seeds)
 * so "the obfuscated artifact passes the original test suite" is literally
 * the same code path as the baseline.
 */
import assert from 'node:assert/strict';
import type { PricingModule, RiskModule, CartItem, RiskContext } from './types.ts';

export function runPricingBattery(mod: PricingModule): void {
  const {
    round2, basePrice, discountRate, calcDiscount, calcTax, calcPrice, priceQuote, VAT_RATE,
  } = mod;

  assert.equal(round2(2.344), 2.34);
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(1716.525), 1716.53);

  const cart = [
    { qty: 2, unitPrice: 199.5 },
    { qty: 1, unitPrice: 1200 },
  ];
  assert.equal(basePrice(cart), 1599);

  // empty cart
  assert.equal(basePrice([]), 0);

  // invalid item throws
  assert.throws(() => basePrice([{ qty: 1 } as CartItem]), /invalid cart item/);

  // tiered discounts
  assert.equal(discountRate(100), 0);
  assert.equal(discountRate(600), 0.05);
  assert.equal(discountRate(2500), 0.1);
  assert.equal(discountRate(9000), 0.15);
  assert.equal(calcDiscount(2500), 250);

  // tax
  assert.equal(calcTax(1000), round2(1000 * VAT_RATE));

  // full quote without coupon
  const quote = calcPrice(cart);
  assert.equal(quote.subtotal, 1599);
  assert.equal(quote.discount, 79.95);
  assert.equal(quote.taxable, 1519.05);
  assert.equal(quote.tax, 197.48);
  assert.equal(quote.total, 1716.53);
  assert.equal(quote.currency, 'CNY');

  // coupon path
  const coupon = calcPrice(cart, 'WELCOME10');
  assert.equal(coupon.taxable, 1367.15);
  assert.equal(coupon.total, 1544.88);

  // high-tier cart for the 15% branch
  const big = [{ qty: 10, unitPrice: 800 }];
  const bigQuote = calcPrice(big);
  assert.equal(bigQuote.discount, 1200);

  // priceQuote adds an id and remains consistent
  const q = priceQuote(cart, 'WELCOME10');
  assert.match(q.quoteId ?? '', /^Q-\d+$/);
  assert.equal(q.total, coupon.total);

  // string literals survive encryption
  assert.equal(quote.currency, 'CNY');
}

export function runRiskBattery(mod: RiskModule): void {
  const { riskScore, riskLevel, fraudEngine, RuleEngine, RULES } = mod;

  assert.ok(Array.isArray(RULES) && RULES.length === 4);

  // clean context
  const clean = {
    amount: 100, accountAgeDays: 30, ipCountry: 'CN', retryCount: 0,
  };
  assert.deepEqual(riskScore(clean), { score: 0, hit: [] });
  assert.equal(riskLevel(clean).level, 'pass');

  // single rule
  const foreign = { ...clean, ipCountry: 'US' };
  const foreignScore = riskScore(foreign);
  assert.equal(foreignScore.score, 25);
  assert.deepEqual(foreignScore.hit, ['R3_FOREIGN_IP']);

  // stacked rules, capped at 100
  const fraud = {
    amount: 90000, accountAgeDays: 2, ipCountry: 'US', retryCount: 5,
  };
  const stacked = riskScore(fraud);
  assert.equal(stacked.score, 100);
  assert.equal(stacked.hit.length, 4);

  // decision bands (score 40 from the single amount rule -> manual review)
  assert.equal(riskLevel({ ...clean, amount: 90000 }).level, 'manual_review'); // 40
  assert.equal(riskLevel(fraud).level, 'reject');

  // fraudEngine adds timestamp (fixed epoch for determinism)
  const decision = fraudEngine(clean);
  assert.equal(decision.decisionAt, '1970-01-01T00:00:00.000Z');
  assert.equal(decision.level, 'pass');

  // class-based engine
  const engine = new RuleEngine();
  const result = engine.evaluate(foreign);
  assert.equal(result.level, 'pass'); // score 25 -> pass
  assert.equal(result.score, 25);

  const custom = new RuleEngine([
    { id: 'X1', weight: 80, test: (c: { amount: number }) => c.amount > 1 },
  ]);
  assert.equal(custom.evaluate({ amount: 2 } as RiskContext).level, 'reject');

  // invalid input
  assert.throws(() => riskScore(null as unknown as RiskContext), /invalid risk context/);
}
