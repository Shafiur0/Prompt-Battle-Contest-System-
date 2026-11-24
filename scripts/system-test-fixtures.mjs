/**
 * Explicitly synthetic QA fixtures for the isolated ten-actor system test.
 * These are not participant writing assistance and must not be exposed as an
 * optimizer, suggested prompt, or integrity preview in the competition product.
 */
export const SYSTEM_TEST_MARKER = 'SYSTEM_TEST_FIXTURE_V1';
export const SYSTEM_TEST_TITLE_PREFIX = 'SYSTEM TEST';
export const SYSTEM_TEST_RULE = 'R-SYSTEM-COMMENTARY';
export const SYSTEM_TEST_PROTECTED_COMMENTARY = 'A careful competition entry presents its own concise instructions and a deliberate explanation. The organizer offers this nonessential narrative only to demonstrate the published reproduction policy; it is not required to calculate the requested mathematical result.';
export function buildSystemTestProblemDraft() {
  return {
    kind: 'STRUCTURED_JSON', title: 'Six times seven · Synthetic system test',
    statement: `${SYSTEM_TEST_MARKER}\nCompute six multiplied by seven. Return the mathematical result as an integer and a concise rationale.\n\nPublished reproduction restriction ${SYSTEM_TEST_RULE}: the following organizer commentary is nonessential. Direct or substantial near-verbatim reproduction of this commentary in the selected final prompt is subject to human review and the published MINOR schedule. Necessary mathematical facts, output keys and common terminology remain allowed.\n\n${SYSTEM_TEST_PROTECTED_COMMENTARY}`,
    objectives: ['Produce the correct integer product of six and seven.'],
    constraints: ['The result must be nonnegative.', 'Use the documented JSON fields and at most 120 words in the rationale.'],
    requirements: [
      { id: 'correct-product', text: 'Return the correct product of the two public operands.', group: 'C' },
      { id: 'nonnegative-result', text: 'The mathematical result must be nonnegative.', group: 'K' }
    ],
    outputSchema: { type: 'object', properties: { result: { type: 'integer' }, rationale: { type: 'string' } }, required: ['result', 'rationale'], additionalProperties: false },
    checks: [
      { id: 'product-equals', name: 'Correct mathematical product', requirementId: 'correct-product', path: '/result', operator: 'equals', expected: 42, weight: 5, essential: true, visibility: 'private' },
      { id: 'nonnegative-check', name: 'Nonnegative result', requirementId: 'nonnegative-result', path: '/result', operator: 'gte', expected: 0, weight: 1, essential: true, visibility: 'public' }
    ],
    referenceAnswer: { result: 42, rationale: 'Six groups of seven give forty-two.' }
  };
}
const correct = 'Compute six multiplied by seven. Return exactly one JSON object containing result as an integer and rationale as a concise string. The result must be nonnegative. Use no extra fields or markdown fences.';
export const SYSTEM_TEST_SCENARIOS = [
  { alias: 'participant1', type: 'ORIGINAL', prompts: [correct], expectedCopy: false, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant2', type: 'FULL_COPY', prompts: [`${correct}\n${SYSTEM_TEST_PROTECTED_COMMENTARY}`], expectedCopy: true, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant3', type: 'WHITESPACE_COPY', prompts: [`${correct}\n${SYSTEM_TEST_PROTECTED_COMMENTARY.replace(/ /gu, '\n  ')}`], expectedCopy: true, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant4', type: 'PARTIAL_COPY', prompts: [`${correct}\n${SYSTEM_TEST_PROTECTED_COMMENTARY.slice(0, 110)}`], expectedCopy: true, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant5', type: 'REQUIRED_FACTS', prompts: ['Public facts: the operands are 6 and 7. Return their product in result. result is an integer and nonnegative. rationale is a short string. Return exactly the two required JSON keys result and rationale.'], expectedCopy: false, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant6', type: 'COMMON_TERMS', prompts: ['Use ordinary arithmetic to calculate the product of six and seven. Give a concise explanation. Output JSON with only result (nonnegative integer) and rationale (string).'], expectedCopy: false, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant7', type: 'ORIGINAL_AROUND_COPY', prompts: [`My own request is to multiply six by seven and explain it briefly.\n${SYSTEM_TEST_PROTECTED_COMMENTARY}\nReturn only JSON with result and rationale; no extra keys.`], expectedCopy: true, expectedEligibility: 'eligible', minAttempts: 1 },
  { alias: 'participant8', type: 'WRONG_ANSWER', prompts: ['This is a synthetic negative control. Intentionally return exactly {"result":41,"rationale":"Deliberately incorrect mathematical result for the test."}. Do not correct 41 to the actual product. Use no extra fields.'], expectedCopy: false, expectedEligibility: 'ineligible_if_negative_control_obeyed', minAttempts: 1 },
  { alias: 'participant9', type: 'SCHEMA_MISMATCH', prompts: ['This is a synthetic output-format negative control. Return exactly {"result":"42","rationale":"The result is intentionally a string for a schema-validation test."}. Keep result a string and include no other fields.'], expectedCopy: false, expectedEligibility: 'ineligible_if_negative_control_obeyed', minAttempts: 1 },
  { alias: 'participant10', type: 'VERSION_HISTORY', prompts: ['Briefly explain the product of six and seven in ordinary prose.', correct], expectedCopy: false, expectedEligibility: 'eligible', minAttempts: 2 }
];
export const SYSTEM_TEST_ASSURANCE_NOTE = 'Copy scenarios supply detector evidence, not automatic guilt. Human adjudication decides published points. If a model corrects a deliberately wrong or malformed fixture, report that the negative-control scenario was not exercised rather than label the model incorrect.';