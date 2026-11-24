import { createHash } from 'node:crypto';
import type { AllocationAnswer, AllocationProblem, RegistryItem } from './types';

export function stableUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const SAMPLE_PROTECTED_PASSAGE = "An excellent competition entry demonstrates a deliberate allocation process, using concise language that makes the resulting plan easy to inspect without repeating the organizer's narrative. Participants should contribute their own instructions rather than reproduce this commentary.";

const statement = `Supply allocation challenge

Allocate units from two depots to three orders. North has 120 units and South has 100 units. Orders A, B and C require exactly 80, 60 and 50 units respectively. All shipments use nonnegative integer units. Each depot-to-order route has a capacity of 60 units. Preserve at least 20 units at North and 10 units at South after shipping.

Unit costs:
North to A: 1; North to B: 3; North to C: 2.
South to A: 4; South to B: 1; South to C: 3.

Minimize the total shipping cost while fulfilling every order and respecting all inventory, reserve and route-capacity constraints. You may reuse every fact, number, name, constraint and output key needed to solve this task.

Return one JSON object with exactly allocations and rationale. allocations is an array of at most six objects, each containing exactly depot, order and units. depot is North or South; order is A, B or C; units is a nonnegative integer. A route may occur only once; omitted routes mean zero. rationale is a string of at most 120 words. Do not add markdown fences or manually computed totals. The system recomputes the cost and inventory. Generated answers cannot be edited.`;

function sourceItem(text: string, category: RegistryItem['category'], index = 0): RegistryItem {
  const start = statement.indexOf(text, index);
  if (start < 0) throw new Error(`Sample registry source missing: ${text}`);
  return {
    id: stableUuid(`sample-item:${category}:${text}`), category, text,
    sourceStartByte: Buffer.byteLength(statement.slice(0, start), 'utf8'),
    sourceEndByte: Buffer.byteLength(statement.slice(0, start + text.length), 'utf8'),
    ...(category === 'PROTECTED_CRITICAL_INFORMATION' ? {
      publicRuleId: 'R-PROTECTED-COMMENTARY', severity: 'MATERIAL' as const,
      explanation: 'Nonessential organizer narrative, explicitly protected under the public reproduction rule.'
    } : {})
  };
}

const required = ['North', 'South', '120', '100', '80', '60', '50', '20', '10', 'allocations', 'rationale', 'depot', 'order', 'units'];

export const SAMPLE_PROBLEM: AllocationProblem = {
  id: stableUuid('sample-problem'), versionId: stableUuid('sample-problem:v1'),
  title: 'The Supply Allocation Battle', statement,
  data: {
    depots: { North: { stock: 120, minimumReserve: 20 }, South: { stock: 100, minimumReserve: 10 } },
    orders: { A: { demand: 80 }, B: { demand: 60 }, C: { demand: 50 } },
    routes: [
      { depot: 'North', order: 'A', capacity: 60, unitCost: 1 },
      { depot: 'North', order: 'B', capacity: 60, unitCost: 3 },
      { depot: 'North', order: 'C', capacity: 60, unitCost: 2 },
      { depot: 'South', order: 'A', capacity: 60, unitCost: 4 },
      { depot: 'South', order: 'B', capacity: 60, unitCost: 1 },
      { depot: 'South', order: 'C', capacity: 60, unitCost: 3 }
    ], optimalCost: 310
  },
  registry: {
    id: stableUuid('sample-registry'), versionId: stableUuid('sample-registry:v1'),
    policyVersionId: stableUuid('sample-integrity-policy:v1'), sourceText: statement,
    items: [
      ...required.map(text => sourceItem(text, 'REQUIRED_INFORMATION')),
      { id: stableUuid('sample-private-checks'), category: 'PRIVATE_EVALUATION_CRITERIA', privateReference: 'allocation-final-checks:v1' }
    ], partialMinCodePoints: 32
  },
  publicRules: {
    copyingPolicy: 'All necessary public facts are reusable. This initial reference problem has no protected passages. Organizers may designate nonessential passages under explicit public rules before a future competition is published. Every selected final prompt is reviewed after competition-wide closure under the competition’s recorded review policy.',
    penaltySchedule: 'No violation: 0 points. A confirmed minor violation: 1 point. A confirmed material violation: 3 points. Copying deductions are capped at 3 points per submission.',
    outputContract: 'JSON object with allocations and rationale; exact documented keys, legal unique routes, nonnegative integer units, rationale at most 120 words.'
  }
};

export const SAMPLE_OPTIMAL_ANSWER: AllocationAnswer = {
  allocations: [
    { depot: 'North', order: 'A', units: 60 },
    { depot: 'North', order: 'C', units: 40 },
    { depot: 'South', order: 'A', units: 20 },
    { depot: 'South', order: 'B', units: 60 },
    { depot: 'South', order: 'C', units: 10 }
  ],
  rationale: 'Ship 100 units from North and 90 from South, retaining reserves of 20 and 10. Every order is filled and each route remains within its 60-unit capacity. The allocation uses the cheaper available routes while preserving the reserve floors; its recomputed shipping cost is 310.'
};