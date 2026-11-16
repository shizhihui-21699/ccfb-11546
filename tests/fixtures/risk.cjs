'use strict';

// Risk-control rules — representative fraud/risk scoring logic.

const RULES = [
  { id: 'R1_HIGH_AMOUNT', weight: 40, test: (ctx) => ctx.amount > 50000 },
  { id: 'R2_NEW_ACCOUNT', weight: 20, test: (ctx) => ctx.accountAgeDays < 7 },
  { id: 'R3_FOREIGN_IP', weight: 25, test: (ctx) => ctx.ipCountry !== 'CN' },
  { id: 'R4_MANY_RETRIES', weight: 15, test: (ctx) => ctx.retryCount >= 3 },
];

function riskScore(ctx, ruleSet) {
  if (!ctx || typeof ctx !== 'object') throw new Error('invalid risk context');
  const activeRules = ruleSet || RULES;
  let score = 0;
  const hit = [];
  for (const rule of activeRules) {
    if (rule.test(ctx)) {
      score += rule.weight;
      hit.push(rule.id);
    }
  }
  return { score: Math.min(score, 100), hit };
}

function riskLevel(ctx, ruleSet) {
  const { score, hit } = riskScore(ctx, ruleSet);
  let level;
  if (score >= 70) level = 'reject';
  else if (score >= 40) level = 'manual_review';
  else level = 'pass';
  return { score, hit, level };
}

function fraudEngine(ctx) {
  const result = riskLevel(ctx);
  result.decisionAt = new Date(0).toISOString();
  return result;
}

class RuleEngine {
  constructor(rules) {
    this.rules = rules || RULES;
  }

  evaluate(ctx) {
    return riskLevel(Object.assign({}, ctx, { engineVersion: '1.0' }), this.rules);
  }
}

module.exports = { RULES, riskScore, riskLevel, fraudEngine, RuleEngine };
