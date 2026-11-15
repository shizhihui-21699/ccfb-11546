import { describe, expect, it } from 'vitest';
import * as pricing from '../fixture/pricing';

describe('pricing fixture (original)', () => {
  it('standard tier, no coupon, CN tax', () => {
    expect(pricing.quote({ unitPrice: 100, quantity: 2, tier: 'standard', region: 'CN' })).toEqual({
      subtotal: 200,
      discount: 0,
      tax: 26,
      total: 226,
    });
  });

  it('gold tier + SAVE10 coupon, US tax', () => {
    const q = pricing.quote({ unitPrice: 49.99, quantity: 3, tier: 'gold', coupon: 'SAVE10', region: 'US' });
    expect(q.subtotal).toBe(149.97);
    expect(q.discount).toBe(28.49);
    expect(q.tax).toBe(9.72);
    expect(q.total).toBe(131.2);
  });

  it('platinum + VIP20, EU tax', () => {
    expect(
      pricing.quote({ unitPrice: 1000, quantity: 1, tier: 'platinum', coupon: 'VIP20', region: 'EU' }),
    ).toEqual({ subtotal: 1000, discount: 320, tax: 136, total: 816 });
  });

  it('unknown coupon is ignored; coupon matching is case/space insensitive', () => {
    const unknown = pricing.quote({ unitPrice: 25, quantity: 4, tier: 'silver', coupon: 'NOPE', region: 'CN' });
    expect(unknown.total).toBe(107.35);
    const padded = pricing.quote({ unitPrice: 25, quantity: 4, tier: 'silver', coupon: ' save10 ', region: 'CN' });
    const exact = pricing.quote({ unitPrice: 25, quantity: 4, tier: 'silver', coupon: 'SAVE10', region: 'CN' });
    expect(padded).toEqual(exact);
  });

  it('rejects invalid input', () => {
    expect(() => pricing.quote({ unitPrice: 10, quantity: 0, tier: 'standard', region: 'CN' })).toThrow(
      'quantity must be positive',
    );
    expect(() => pricing.quote({ unitPrice: -1, quantity: 1, tier: 'standard', region: 'CN' })).toThrow(
      'unitPrice must be non-negative',
    );
  });
});

describe('risk fixture (original)', () => {
  it('clean low-risk input is allowed with score 0', () => {
    const input = { amount: 500, attemptsLastHour: 1, ipCountry: 'CN', accountAgeDays: 365 };
    expect(pricing.riskScore(input)).toBe(0);
    expect(pricing.decide(input)).toBe('allow');
  });

  it('combined medium signals land on review', () => {
    const input = { amount: 20000, attemptsLastHour: 5, ipCountry: 'BR', accountAgeDays: 3 };
    expect(pricing.riskScore(input)).toBe(70);
    expect(pricing.decide(input)).toBe('review');
  });

  it('blocked country saturates score and blocks', () => {
    const input = { amount: 60000, attemptsLastHour: 20, ipCountry: 'KP', accountAgeDays: 1 };
    expect(pricing.riskScore(input)).toBe(100);
    expect(pricing.decide(input)).toBe('block');
  });
});
