import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStructuredProblem, validateStructuredProblemDraft, evaluateAnswer, validateAnswer,
  evaluateAllocationAnswer, SAMPLE_PROBLEM, SAMPLE_OPTIMAL_ANSWER, stableUuid,
  buildQualityJudgeRequest, validateSafeJsonSchema, parseSafeJsonPointer, resolveJsonPointer,
  type StructuredProblemDraft, type StructuredCheck
} from '../src';

function draft(): StructuredProblemDraft {
  return {
    kind: 'STRUCTURED_JSON', title: 'Custom total challenge',
    statement: 'Add twelve and eight and report the result. Explain your answer in a concise rationale.',
    objectives: ['Return the correct total.'], constraints: ['The result must be nonnegative.'],
    requirements: [
      { id: 'total', text: 'Report the correct total of the two given values.', group: 'C' },
      { id: 'nonnegative', text: 'Report a nonnegative result.', group: 'K' }
    ],
    outputSchema: { type: 'object', properties: { result: { type: 'integer' }, rationale: { type: 'string' } }, required: ['result', 'rationale'], additionalProperties: false },
    checks: [
      { id: 'total-value', name: 'PRIVATE_TOTAL_CHECK_LABEL', requirementId: 'total', path: '/result', operator: 'equals', expected: 20, weight: 2, essential: true, visibility: 'private' },
      { id: 'nonnegative-value', name: 'Nonnegative result', requirementId: 'nonnegative', path: '/result', operator: 'gte', expected: 0, weight: 1, essential: true, visibility: 'public' }
    ],
    referenceAnswer: { result: 20, rationale: 'PRIVATE_REFERENCE_PHRASE that is a configuration fixture, not the only correct wording.' }
  };
}
function build(value = draft()) {
  return buildStructuredProblem(value, { problemId: 'custom-problem', versionId: 'custom-version-1', registryId: stableUuid('custom-registry'), registryVersionId: stableUuid('custom-registry-version'), policyVersionId: stableUuid('custom-policy') });
}

test('custom problem builds its own public definition and fresh required registry', () => {
  const problem = build();
  assert.equal(problem.kind, 'STRUCTURED_JSON');
  assert.equal(problem.structured.baseStatement, draft().statement);
  assert.ok(problem.statement.includes('Report a nonnegative result.'));
  assert.ok(problem.statement.includes('rationale'));
  assert.ok(!problem.statement.includes('PRIVATE_REFERENCE_PHRASE'));
  assert.ok(!problem.statement.includes('PRIVATE_TOTAL_CHECK_LABEL'));
  assert.ok(!problem.statement.includes('referenceAnswer'));
  assert.equal(problem.registry.sourceText, problem.statement);
  assert.equal(problem.registry.items.filter(i => i.category === 'PROTECTED_CRITICAL_INFORMATION').length, 0);
  assert.equal(problem.registry.items.filter(i => i.category === 'REQUIRED_INFORMATION').length, 3);
});

test('multiple valid explanations pass without matching the private reference answer', () => {
  const problem = build();
  for (const rationale of ['Twelve plus eight equals twenty.', 'The sum is twenty.']) {
    const result = evaluateAnswer(JSON.stringify({ result: 20, rationale }), problem);
    assert.equal(result.C, 1); assert.equal(result.K, 1); assert.equal(result.eligible, true); assert.equal(result.computedCost, null);
    assert.ok(!result.finalTests.some(t => t.id.includes('demand') || t.id.includes('reserve') || t.id.includes('shipping')));
  }
});

test('public feedback omits private checks and their expected values', () => {
  const result = evaluateAnswer({ result: 21, rationale: 'A wrong sum.' }, build());
  assert.equal(result.K, 1); assert.equal(result.eligible, false);
  assert.ok(result.C > 0 && result.C < 1);
  assert.ok(result.publicTests.every(t => t.visibility === 'public'));
  assert.ok(!JSON.stringify(result.publicTests).includes('PRIVATE_TOTAL_CHECK_LABEL'));
  assert.ok(result.finalTests.some(t => t.id === 'total-value' && !t.passed));
});

test('custom answers must satisfy exact output keys and the public rationale limit', () => {
  const problem = build();
  assert.deepEqual(validateAnswer({ result: 20, rationale: 'Valid.' }, problem), { result: 20, rationale: 'Valid.' });
  assert.throws(() => validateAnswer({ result: 20 }, problem));
  assert.throws(() => validateAnswer({ result: 20, rationale: 'Valid.', allocations: [] }, problem));
  assert.throws(() => validateAnswer({ result: 20, rationale: 'word '.repeat(121) }, problem));
  assert.equal(evaluateAnswer('```json\n{}\n```', problem).eligible, false);
});

test('legacy allocation with no kind keeps its original behavior', () => {
  assert.equal(SAMPLE_PROBLEM.kind, undefined);
  const raw = JSON.stringify(SAMPLE_OPTIMAL_ANSWER);
  assert.deepEqual(evaluateAnswer(raw, SAMPLE_PROBLEM), evaluateAllocationAnswer(raw, SAMPLE_PROBLEM));
  assert.equal(evaluateAnswer(raw, SAMPLE_PROBLEM).computedCost, 310);
});

test('an unrelated custom answer never runs legacy allocation checks', () => {
  const result = evaluateAnswer(JSON.stringify(SAMPLE_OPTIMAL_ANSWER), build());
  assert.equal(result.eligible, false); assert.equal(result.C, 0); assert.equal(result.K, 0);
  assert.deepEqual(result.finalTests.map(t => t.id), ['structured-output-contract']);
});

test('bad private references block publication before participants can enter', () => {
  const wrong = draft(); wrong.referenceAnswer = { result: 21, rationale: 'Wrong total.' };
  assert.throws(() => validateStructuredProblemDraft(wrong));
  const malformed = draft(); malformed.referenceAnswer = { result: 20 };
  assert.throws(() => build(malformed));
});

test('duplicate ids and unknown public requirement references are rejected', () => {
  const duplicate = draft(); duplicate.requirements[1].id = duplicate.requirements[0].id;
  assert.throws(() => build(duplicate));
  const unknown = draft(); unknown.checks[0].requirementId = 'not-defined';
  assert.throws(() => build(unknown));
  const checks = draft(); checks.checks[1].id = checks.checks[0].id;
  assert.throws(() => build(checks));
  const reserved = draft(); reserved.checks[0].id = 'structured-output-contract';
  assert.throws(() => build(reserved));
});

test('identical predicates cannot count in both correctness and critical criteria', () => {
  const value = draft(); value.checks[1] = { ...value.checks[0], id: 'duplicate-critical', requirementId: 'nonnegative' };
  assert.throws(() => build(value));
});

test('identical public requirement text cannot be assigned to C and K', () => {
  const value = draft(); value.requirements[1].text = value.requirements[0].text;
  assert.throws(() => build(value));
});

test('both groups require authored positive weights rather than just schema credit', () => {
  const emptyK = draft(); emptyK.requirements[1].group = 'C';
  assert.throws(() => build(emptyK));
  const zero = draft(); zero.checks[0].weight = 0;
  assert.throws(() => build(zero));
  const negative = draft(); negative.checks[0].weight = -1;
  assert.throws(() => build(negative));
});

test('scripts, regexes, remote references and unknown schema keywords are forbidden', () => {
  for (const field of ['pattern', '$ref', 'format', 'oneOf', 'script']) {
    const value = draft(); value.outputSchema[field] = field === '$ref' ? 'https://example.invalid/no-fetch' : 'unsupported';
    assert.throws(() => build(value));
  }
  const badOperator = draft(); (badOperator.checks[0] as any).operator = 'javascript';
  assert.throws(() => build(badOperator));
  const functionExpected = draft(); (functionExpected.checks[0] as any).expected = () => 20;
  assert.throws(() => build(functionExpected));
});

test('all object properties must be required and extras forbidden', () => {
  const missingRequired = draft(); missingRequired.outputSchema.required = ['result'];
  assert.throws(() => build(missingRequired));
  const extras = draft(); extras.outputSchema.additionalProperties = true;
  assert.throws(() => build(extras));
  const rationaleType = draft(); (rationaleType.outputSchema.properties as any).rationale = { type: 'number' };
  assert.throws(() => build(rationaleType));
});

test('nested arrays need bounded length and every nested object is strict', () => {
  assert.throws(() => validateSafeJsonSchema({ type: 'array', items: { type: 'number' } }));
  assert.throws(() => validateSafeJsonSchema({ type: 'array', maxItems: 1001, items: { type: 'number' } }));
  assert.throws(() => validateSafeJsonSchema({ type: 'object', properties: { child: { type: 'object', properties: {}, required: [] } }, required: ['child'], additionalProperties: false }));
});

test('schema complexity limits stop excessively deep definitions', () => {
  let schema: any = { type: 'integer' };
  for (let n = 0; n < 10; n++) schema = { type: 'object', properties: { child: schema }, required: ['child'], additionalProperties: false };
  assert.throws(() => validateSafeJsonSchema(schema));
});

test('JSON Pointers use RFC 6901 escapes and reject prototype traversal', () => {
  assert.deepEqual(parseSafeJsonPointer('/a~1b/~0value'), ['a/b', '~value']);
  assert.throws(() => parseSafeJsonPointer('/constructor'));
  assert.throws(() => parseSafeJsonPointer('/__proto__'));
  assert.throws(() => parseSafeJsonPointer('/result~2'));
  assert.deepEqual(resolveJsonPointer({ 'a/b': { '~value': 7 } }, '/a~1b/~0value'), { found: true, value: 7 });
  const inherited = Object.create({ result: 20 });
  assert.deepEqual(resolveJsonPointer(inherited, '/result'), { found: false });
});

test('check paths must exist within the declared public schema', () => {
  const value = draft(); value.checks[0].path = '/missing';
  assert.throws(() => build(value));
  const prototype = draft(); prototype.checks[0].path = '/prototype';
  assert.throws(() => build(prototype));
});

test('escaped nested check paths evaluate the intended field', () => {
  const value = draft();
  value.outputSchema = { type: 'object', properties: { 'a/b': { type: 'object', properties: { '~value': { type: 'integer' } }, required: ['~value'], additionalProperties: false }, rationale: { type: 'string' } }, required: ['a/b', 'rationale'], additionalProperties: false };
  value.referenceAnswer = { 'a/b': { '~value': 20 }, rationale: 'Nested result.' };
  value.checks = value.checks.map(c => ({ ...c, path: '/a~1b/~0value' }));
  assert.equal(evaluateAnswer({ 'a/b': { '~value': 20 }, rationale: 'Alternative explanation.' }, build(value)).eligible, true);
});

test('operator expected-value contracts reject missing or nonsensical configuration', () => {
  const missing = draft(); delete missing.checks[0].expected; assert.throws(() => build(missing));
  const exists = draft(); exists.checks[0].operator = 'exists'; assert.throws(() => build(exists));
  const numeric = draft(); numeric.checks[1].expected = 'zero'; assert.throws(() => build(numeric));
  const alternatives = draft(); alternatives.checks[0].operator = 'one_of'; alternatives.checks[0].expected = []; assert.throws(() => build(alternatives));
});

function operatorsDraft(): StructuredProblemDraft {
  const value = draft();
  value.outputSchema = { type: 'object', properties: { result: { type: 'integer' }, text: { type: 'string' }, values: { type: 'array', items: { type: 'number' }, maxItems: 10 }, rationale: { type: 'string' } }, required: ['result', 'text', 'values', 'rationale'], additionalProperties: false };
  value.referenceAnswer = { result: 20, text: 'approved case', values: [0.1, 0.2], rationale: 'All declared checks passed.' };
  const c = (id: string, path: string, operator: StructuredCheck['operator'], expected?: any, group = 'total'): StructuredCheck => ({ id, name: id, requirementId: group, path, operator, ...(expected === undefined ? {} : { expected }), weight: 1, essential: true, visibility: 'private' });
  value.checks = [
    c('equals', '/result', 'equals', 20), c('not-equals', '/result', 'not_equals', 0),
    c('exists', '/text', 'exists'), c('one-of', '/result', 'one_of', [20, 21]),
    c('contains', '/text', 'contains', 'approved'), c('length', '/values', 'length_equals', 2),
    c('sum', '/values', 'sum_equals', 0.3), c('unique', '/values', 'unique', undefined, 'nonnegative'),
    c('gte', '/result', 'gte', 0, 'nonnegative'), c('lte', '/result', 'lte', 100, 'nonnegative')
  ];
  return value;
}
test('all supported operators run safely, including exact decimal array sums', () => {
  const value = operatorsDraft(), problem = build(value);
  const result = evaluateAnswer(value.referenceAnswer, problem);
  assert.equal(result.C, 1); assert.equal(result.K, 1); assert.equal(result.eligible, true);
});

test('array uniqueness and sum mismatches are ordinary deterministic failures', () => {
  const value = operatorsDraft(), problem = build(value);
  const answer = { ...(value.referenceAnswer as any), values: [0.1, 0.1] };
  const result = evaluateAnswer(answer, problem);
  assert.ok(result.finalTests.some(t => t.id === 'unique' && !t.passed));
  assert.ok(result.finalTests.some(t => t.id === 'sum' && !t.passed));
  assert.equal(result.eligible, false);
});

test('numeric public schema bounds and Unicode string lengths are enforced', () => {
  const value = draft(); (value.outputSchema.properties as any).result = { type: 'integer', minimum: 0, maximum: 100, enum: [20, 21] };
  (value.outputSchema.properties as any).rationale = { type: 'string', maxLength: 2 };
  value.referenceAnswer = { result: 20, rationale: '🧠🧠' };
  const problem = build(value);
  assert.doesNotThrow(() => validateAnswer({ result: 20, rationale: '🧠🧠' }, problem));
  assert.throws(() => validateAnswer({ result: 20, rationale: '🧠🧠🧠' }, problem));
  assert.throws(() => validateAnswer({ result: 22, rationale: 'OK' }, problem));
});

test('overlong composed public source is rejected in UTF-8 bytes', () => {
  const value = draft(); value.statement = '🧠'.repeat(16000);
  assert.throws(() => validateStructuredProblemDraft(value));
});

test('generic judging contains no private reference and allocation prompt stays unchanged', () => {
  const problem = build(), answer = JSON.stringify({ result: 20, rationale: 'Twelve plus eight.' });
  const request = buildQualityJudgeRequest(answer, undefined, problem);
  assert.ok(request.messages[0].content.includes('custom structured JSON'));
  assert.ok(!request.messages[1].content.includes('PRIVATE_REFERENCE_PHRASE'));
  assert.ok(!request.messages[1].content.includes('"expected"'));
  const allocation = buildQualityJudgeRequest(JSON.stringify(SAMPLE_OPTIMAL_ANSWER));
  assert.ok(allocation.messages[0].content.startsWith('You are an independent solution-quality judge. Assess only the explanation in the immutable generated allocation answer.'));
});

test('safe literal JSON does not execute strings and rejects non-JSON sparse data', () => {
  const sparse = draft(); sparse.checks[0].expected = new Array(1) as any;
  assert.throws(() => validateStructuredProblemDraft(sparse));
  const bad = draft(); (bad.outputSchema as any).properties.__proto__ = { type: 'integer' };
  assert.throws(() => validateStructuredProblemDraft(bad));
});