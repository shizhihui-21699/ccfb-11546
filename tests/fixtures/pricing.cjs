'use strict';

// Pricing engine — representative front-end pricing logic (unit prices, tiered
// discounts, tax rounding). Names intentionally include the auto-target hints.

const VAT_RATE = 0.13;
const DISCOUNT_TIERS = [
  { minAmount: 5000, rate: 0.15 },
  { minAmount: 2000, rate: 0.1 },
  { minAmount: 500, rate: 0.05 },
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function basePrice(items) {
  let total = 0;
  for (const item of items) {
    if (!item || typeof item.qty !== 'number' || typeof item.unitPrice !== 'number') {
      throw new Error('invalid cart item');
    }
    total += item.qty * item.unitPrice;
  }
  return round2(total);
}

function discountRate(amount) {
  for (const tier of DISCOUNT_TIERS) {
    if (amount >= tier.minAmount) return tier.rate;
  }
  return 0;
}

function calcDiscount(amount) {
  const rate = discountRate(amount);
  return round2(amount * rate);
}

function calcTax(amountAfterDiscount) {
  return round2(amountAfterDiscount * VAT_RATE);
}

function calcPrice(items, couponCode) {
  const subtotal = basePrice(items);
  const discount = calcDiscount(subtotal);
  let taxable = subtotal - discount;
  if (couponCode === 'WELCOME10') {
    taxable = round2(taxable * 0.9);
  }
  const tax = calcTax(taxable);
  return {
    subtotal,
    discount,
    taxable: round2(taxable),
    tax,
    total: round2(taxable + tax),
    currency: 'CNY',
  };
}

function priceQuote(items, couponCode) {
  const quote = calcPrice(items, couponCode);
  quote.quoteId = 'Q-' + Math.round(subtotal0(items));
  return quote;
}

function subtotal0(items) {
  return basePrice(items) + 0;
}

module.exports = {
  VAT_RATE,
  DISCOUNT_TIERS,
  round2,
  basePrice,
  discountRate,
  calcDiscount,
  calcTax,
  calcPrice,
  priceQuote,
};
