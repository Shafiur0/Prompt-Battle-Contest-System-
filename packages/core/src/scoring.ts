import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const TOKEN_ALLOWANCE = 2_000_000;
export const EFFICIENCY_REFERENCE_TOKENS = 10_000;
export const SCORING_VERSION = 'quality-55-critical-25-judge-20-efficiency-5-decimal-v1';

export interface ScoreInput {
  C: number; K: number; J: number; T: number; eligible: boolean;
  reviewedCopyingPenaltyPoints?: number;
}
export interface ScoreResult {
  Q: number; E: number; g: number; baseScore: number; finalScore: number;
  finalScoreExact: string; formulaVersion: string;
}
function unit(value: number, name: string): Decimal {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return new D(value);
}
export function calculateScore(input: ScoreInput): ScoreResult {
  const C = unit(input.C, 'C'), K = unit(input.K, 'K'), J = unit(input.J, 'J');
  if (!Number.isSafeInteger(input.T) || input.T < 0 || input.T > TOKEN_ALLOWANCE) throw new Error('T must be confirmed generation tokens within the fixed allowance');
  const P = input.reviewedCopyingPenaltyPoints ?? 0;
  if (![0, 1, 3].includes(P)) throw new Error('Only the published confirmed 0/1/3 copying points are valid');
  if (typeof input.eligible !== 'boolean') throw new Error('eligible must be a boolean');
  const Q = C.times('0.55').plus(K.times('0.25')).plus(J.times('0.20'));
  const E = new D(TOKEN_ALLOWANCE).div(Math.max(input.T, EFFICIENCY_REFERENCE_TOKENS)).ln()
    .div(new D(TOKEN_ALLOWANCE).div(EFFICIENCY_REFERENCE_TOKENS).ln());
  const g = input.eligible ? D.max(0, D.min(1, Q.minus('0.60').div('0.20'))) : new D(0);
  const base = Q.times(100).times(new D('0.95').plus(new D('0.05').times(g).times(E)));
  const final = D.max(0, base.minus(P)).toDecimalPlaces(12);
  return {
    Q: Q.toNumber(), E: E.toNumber(), g: g.toNumber(),
    baseScore: base.toDecimalPlaces(12).toNumber(), finalScore: final.toNumber(),
    finalScoreExact: final.toFixed(12), formulaVersion: SCORING_VERSION
  };
}
export const scoreSubmission = calculateScore;