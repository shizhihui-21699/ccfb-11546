// TypeScript input smoke test — types are stripped by Babel, output is plain JS.
interface Tier {
  minAmount: number;
  rate: number;
}

const TIERS: Tier[] = [
  { minAmount: 1000, rate: 0.2 },
  { minAmount: 100, rate: 0.1 },
];

export function tsDiscount(amount: number): number {
  for (const tier of TIERS) {
    if (amount >= tier.minAmount) return Math.round(amount * tier.rate * 100) / 100;
  }
  return 0;
}

export const tsLabel = (amount: number): string =>
  amount >= 1000 ? 'high-value' : 'standard';
