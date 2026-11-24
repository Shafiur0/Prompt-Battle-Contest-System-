import type { AllocationAnswer, AllocationEvaluation, AllocationProblem, CompetitionProblem, AnswerEvaluation, TestResult } from './types';
import { SAMPLE_PROBLEM } from './sample';
import { evaluateStructuredJsonAnswer, validateStructuredAnswer } from './structured';

export function exactKeys(value: unknown, keys: string[], context: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) throw new Error(`${context} has missing or unexpected fields`);
}
export function parseAllocationAnswer(raw: string | unknown, problem: AllocationProblem = SAMPLE_PROBLEM): AllocationAnswer {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  exactKeys(value, ['allocations', 'rationale'], 'Answer');
  if (!Array.isArray(value.allocations) || value.allocations.length > problem.data.routes.length) throw new Error('allocations must contain at most six route records');
  if (typeof value.rationale !== 'string' || value.rationale.trim().split(/\s+/u).filter(Boolean).length > 120) throw new Error('rationale must be a string of at most 120 words');
  const seen = new Set<string>();
  const allocations = value.allocations.map((record: unknown) => {
    exactKeys(record, ['depot', 'order', 'units'], 'Allocation');
    if (typeof record.depot !== 'string' || !Object.hasOwn(problem.data.depots, record.depot)) throw new Error('Unknown depot');
    if (typeof record.order !== 'string' || !Object.hasOwn(problem.data.orders, record.order)) throw new Error('Unknown order');
    if (typeof record.units !== 'number' || !Number.isSafeInteger(record.units) || record.units < 0 || record.units > 2_000_000) throw new Error('units must be a safe nonnegative integer');
    const key = `${record.depot}:${record.order}`;
    if (!problem.data.routes.some(r => r.depot === record.depot && r.order === record.order)) throw new Error('Unknown route');
    if (seen.has(key)) throw new Error('A route cannot be duplicated');
    seen.add(key);
    return { depot: record.depot, order: record.order, units: record.units };
  });
  return { allocations, rationale: value.rationale };
}

export function evaluateAllocationAnswer(raw: string | unknown, problem: AllocationProblem = SAMPLE_PROBLEM): AllocationEvaluation {
  let answer: AllocationAnswer;
  try { answer = parseAllocationAnswer(raw, problem); }
  catch (error) {
    const detail = error instanceof Error ? error.message : 'Invalid answer';
    const failed: TestResult = { id: 'public-schema', name: 'JSON output contract', passed: false, essential: true, weight: 10, group: 'C', visibility: 'public', detail };
    return { parsed: null, publicTests: [failed], finalTests: [failed], C: 0, K: 0, eligible: false, computedCost: null, summary: detail };
  }
  const shipped: Record<string, number> = Object.fromEntries(Object.keys(problem.data.depots).map(k => [k, 0]));
  const received: Record<string, number> = Object.fromEntries(Object.keys(problem.data.orders).map(k => [k, 0]));
  let computedCost = 0;
  let routeCaps = true;
  for (const allocation of answer.allocations) {
    const route = problem.data.routes.find(r => r.depot === allocation.depot && r.order === allocation.order)!;
    shipped[allocation.depot] += allocation.units;
    received[allocation.order] += allocation.units;
    computedCost += allocation.units * route.unitCost;
    if (allocation.units > route.capacity) routeCaps = false;
  }
  const demandPass = Object.entries(problem.data.orders).every(([key, order]) => received[key] === order.demand);
  const inventoryPass = Object.entries(problem.data.depots).every(([key, depot]) => shipped[key] <= depot.stock);
  const publicTests: TestResult[] = [
    { id: 'public-schema', name: 'JSON output contract', passed: true, essential: true, weight: 20, group: 'C', visibility: 'public', detail: 'Required JSON fields, legal unique routes and integer units are valid.' },
    { id: 'public-demand', name: 'Exact order fulfillment', passed: demandPass, essential: true, weight: 30, group: 'C', visibility: 'public', detail: demandPass ? 'Every order receives its exact required quantity.' : 'At least one order is underfilled or overfilled.' },
    { id: 'public-inventory', name: 'Inventory conservation', passed: inventoryPass, essential: true, weight: 20, group: 'C', visibility: 'public', detail: inventoryPass ? 'No depot ships more than its initial stock.' : 'At least one depot ships more than its stock.' }
  ];
  const criticalTests: TestResult[] = Object.entries(problem.data.depots).map(([key, depot]) => {
    const passed = depot.stock - shipped[key] >= depot.minimumReserve;
    return { id: `critical-reserve-${key.toLowerCase()}`, name: `${key} protected reserve`, passed, essential: true, weight: 0.25, group: 'K', visibility: 'private', detail: passed ? 'Reserve floor satisfied.' : 'Reserve floor violated.' };
  });
  criticalTests.push({ id: 'critical-route-capacity', name: 'Per-route capacity', passed: routeCaps, essential: true, weight: 0.5, group: 'K', visibility: 'private', detail: routeCaps ? 'All route capacities satisfied.' : 'A route capacity is exceeded.' });
  const optimal = demandPass && inventoryPass && criticalTests.every(t => t.passed) && computedCost === problem.data.optimalCost;
  const objective: TestResult = { id: 'final-minimum-cost', name: 'Minimum shipping cost', passed: optimal, essential: false, weight: 30, group: 'C', visibility: 'private', detail: optimal ? 'Optimal public objective achieved.' : 'A feasible lower-cost plan exists or a constraint fails.' };
  const finalTests = [...publicTests, objective, ...criticalTests];
  const correctness = finalTests.filter(t => t.group === 'C');
  const C = correctness.reduce((sum, t) => sum + (t.passed ? t.weight : 0), 0) / correctness.reduce((sum, t) => sum + t.weight, 0);
  const K = criticalTests.reduce((sum, t) => sum + (t.passed ? t.weight : 0), 0) / criticalTests.reduce((sum, t) => sum + t.weight, 0);
  const eligible = finalTests.filter(t => t.essential).every(t => t.passed);
  return { parsed: answer, publicTests, finalTests, C, K, eligible, computedCost, summary: eligible ? `Feasible allocation; computed shipping cost ${computedCost}.` : 'One or more indispensable requirements failed.' };
}
export function evaluateAnswer(raw: unknown, problem: CompetitionProblem = SAMPLE_PROBLEM): AnswerEvaluation {
  if (problem.kind === 'STRUCTURED_JSON') return evaluateStructuredJsonAnswer(raw, problem);
  if (problem.kind !== undefined && problem.kind !== 'ALLOCATION') throw new Error('Unsupported frozen problem kind');
  return evaluateAllocationAnswer(raw, problem);
}
export function validateAnswer(raw: unknown, problem: CompetitionProblem = SAMPLE_PROBLEM) {
  if (problem.kind === 'STRUCTURED_JSON') return validateStructuredAnswer(raw, problem);
  if (problem.kind !== undefined && problem.kind !== 'ALLOCATION') throw new Error('Unsupported frozen problem kind');
  return parseAllocationAnswer(raw, problem);
}